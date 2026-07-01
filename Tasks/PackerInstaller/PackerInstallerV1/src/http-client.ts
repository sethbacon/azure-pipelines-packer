// Currently duplicated from the sibling azure-pipelines-terraform extension's
// http-client.ts (no CI parity check on this repo, unlike the terraform side).
// Extracting a shared cross-extension package is tracked as follow-up work; a
// fix or key rotation here should be mirrored there.
import tasks = require('azure-pipelines-task-lib/task');
import { ProxyAgent } from 'undici';

/**
 * Per-request timeouts (ms). Without an AbortController a hung TCP connection
 * stalls the install until the agent job timeout. Metadata lookups are quick;
 * the GPG signature body needs a larger ceiling.
 */
export const METADATA_TIMEOUT_MS = 60_000;
export const DOWNLOAD_TIMEOUT_MS = 600_000;

function buildFetchOptions(): RequestInit {
    const proxy = tasks.getHttpProxyConfiguration();
    if (!proxy) return {};

    let proxyUrl = proxy.proxyUrl;
    if (proxy.proxyUsername) {
        if (proxy.proxyPassword) {
            tasks.setSecret(proxy.proxyPassword);
        }
        let url: URL;
        try {
            url = new URL(proxy.proxyUrl);
        } catch (err) {
            throw new Error(`Invalid proxy URL configured on the agent: ${err instanceof Error ? err.message : err}`);
        }
        url.username = proxy.proxyUsername;
        url.password = proxy.proxyPassword ?? "";
        proxyUrl = url.toString();
    }

    return {
        // @ts-expect-error Node.js fetch accepts undici dispatcher
        dispatcher: new ProxyAgent(proxyUrl)
    };
}

const MAX_REDIRECTS = 5;

/**
 * Fetches an https:// URL under a wall-clock timeout that covers the connection,
 * every redirect hop, the response headers, AND body consumption — the consume
 * callback runs inside the timeout guard, so a stalled body stream is bounded
 * too. On timeout the request is aborted and a clear error is thrown rather
 * than hanging the job.
 *
 * Redirects are followed manually (not via fetch's automatic redirect:'follow')
 * so each hop's Location can be re-validated as https:// before following it —
 * otherwise an https:// URL that 30x's to plain http:// (or that a compromised
 * endpoint redirects off-host) would silently downgrade the request.
 */
export async function fetchWithTimeout<T>(
    url: string,
    timeoutMs: number,
    consume: (response: Response) => Promise<T>,
): Promise<T> {
    if (!url.startsWith('https://')) {
        throw new Error(tasks.loc("InsecureUrlRejected", url));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let currentUrl = url;
        for (let redirects = 0; ; redirects++) {
            const response = await fetch(currentUrl, { ...buildFetchOptions(), signal: controller.signal, redirect: 'manual' });
            const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
            if (!location) {
                return await consume(response);
            }
            if (redirects >= MAX_REDIRECTS) {
                throw new Error(`Too many redirects fetching ${url} (limit ${MAX_REDIRECTS}).`);
            }
            const nextUrl = new URL(location, currentUrl).toString();
            if (!nextUrl.startsWith('https://')) {
                throw new Error(tasks.loc("InsecureUrlRejected", nextUrl));
            }
            currentUrl = nextUrl;
        }
    } catch (err) {
        if (controller.signal.aborted) {
            throw new Error(`Request to ${url} timed out after ${timeoutMs}ms.`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

export function fetchJson<T>(url: string): Promise<T> {
    return fetchWithTimeout(url, METADATA_TIMEOUT_MS, async (response) => {
        if (!response.ok) {
            throw new Error(tasks.loc("RegistryRequestFailed", url, response.status));
        }
        return (await response.json()) as T;
    });
}

export function fetchText(url: string): Promise<string> {
    return fetchWithTimeout(url, METADATA_TIMEOUT_MS, async (response) => {
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
        }
        // The returned promise is awaited inside fetchWithTimeout's guard, so the
        // body read stays bounded by the timeout without a redundant await here.
        return response.text();
    });
}

export function fetchBuffer(url: string): Promise<Uint8Array> {
    return fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS, async (response) => {
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
    });
}
