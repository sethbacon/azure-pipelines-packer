// @shared-module: copied from azure-pipelines-terraform (Tasks/TerraformInstaller/TerraformInstallerV1/src/http-client.ts)
// @shared-module-policy: This is a copy of the sibling extension's HTTP client. Until a
//   shared cross-extension package is extracted, apply fixes to both copies and keep the
//   provenance header current. Enforced by scripts/check-shared-modules.js.
// @shared-module-status: DIVERGED — this copy shares the redirect re-validation +
//   MAX_REDIRECTS shape, the typed HttpError, fetchTextAllow404/fetchBufferAllow404 and
//   proxy-password masking with azure-pipelines-terraform's copy, and as of 2026-08-08
//   also its ASYNC host-authorization contract (downloadToFile awaits isHostAllowed on
//   the initial URL and on every redirect hop, passing URL.host — #161/#191). It also
//   masks BOTH the raw and the URL-percent-encoded form of the proxy password in
//   buildFetchOptions; that registration was written for all four copies (this one plus
//   terraform's three) in the same change, so port it with any terraform sync. The
//   terraform copy has advanced further and this one has NOT yet taken:
//   MAX_RESPONSE_BYTES-bounded body reads, 429/Retry-After handling, delegation of
//   withRetry to a shared retry.ts, and the github.com -> *.githubusercontent.com
//   release-asset redirect exception. Apply future fixes to both.
import tasks = require('azure-pipelines-task-lib/task');
import fs = require('fs');
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { ProxyAgent } from 'undici';

/**
 * Per-request timeouts (ms). Without an AbortController a hung TCP connection
 * stalls the install until the agent job timeout. Metadata lookups are quick;
 * the GPG signature body needs a larger ceiling.
 */
export const METADATA_TIMEOUT_MS = 60_000;
export const DOWNLOAD_TIMEOUT_MS = 600_000;

const MAX_REDIRECTS = 5;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 200;

/** Error carrying whether the failure is worth retrying (transient) vs deterministic (4xx / insecure URL). */
class HttpError extends Error {
    constructor(message: string, readonly retryable: boolean) {
        super(message);
        this.name = 'HttpError';
    }
}

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
        // url.password is now the WHATWG URL setter's PERCENT-ENCODED form (e.g.
        // 'p@ss' -> 'p%40ss') — a byte-different string from the raw
        // proxyPassword already setSecret()'d above. ADO's log masker matches
        // literal registered strings, not derivations, so this encoded form
        // (which is what url.toString() below actually embeds in proxyUrl, and
        // therefore what an undici/ProxyAgent connection-failure message would
        // surface) needs its own registration too. Mirrors the same fix in
        // azure-pipelines-terraform's proxy-config.ts / https-client.ts.
        if (url.password) {
            tasks.setSecret(url.password);
        }
        proxyUrl = url.toString();
    }

    return {
        // @ts-expect-error Node.js fetch accepts undici dispatcher
        dispatcher: new ProxyAgent(proxyUrl)
    };
}

/**
 * Fetches an https:// URL under a wall-clock timeout that covers the connection,
 * every redirect hop, the response headers, AND body consumption — the consume
 * callback runs inside the timeout guard, so a stalled body stream is bounded
 * too. On timeout the request is aborted and a clear error is thrown rather
 * than hanging the job.
 *
 * Redirects are followed manually (not via fetch's automatic redirect:'follow')
 * so each hop's Location can be re-validated before following it: it must stay
 * https:// AND stay on the original host. These callers (checkpoint API, registry
 * version/info endpoints, SHA256SUMS, .sig) have no legitimate reason to redirect
 * to a different host, so an off-host redirect is refused rather than followed.
 */
export async function fetchWithTimeout<T>(
    url: string,
    timeoutMs: number,
    consume: (response: Response) => Promise<T>,
    isRedirectHostAllowed: (originHost: string, next: URL) => boolean | Promise<boolean> = (originHost, next) => next.host === originHost,
): Promise<T> {
    if (!url.startsWith('https://')) {
        throw new HttpError(tasks.loc("InsecureUrlRejected", url), false);
    }
    const originHost = new URL(url).host;

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
                throw new HttpError(`Too many redirects fetching ${url} (limit ${MAX_REDIRECTS}).`, false);
            }
            const next = new URL(location, currentUrl);
            if (next.protocol !== 'https:') {
                throw new HttpError(tasks.loc("InsecureUrlRejected", next.toString()), false);
            }
            if (!(await isRedirectHostAllowed(originHost, next))) {
                throw new HttpError(`Refusing to follow an off-host redirect (${originHost} -> ${next.host}) while fetching ${url}.`, false);
            }
            currentUrl = next.toString();
        }
    } catch (err) {
        if (controller.signal.aborted) {
            throw new HttpError(`Request to ${url} timed out after ${timeoutMs}ms.`, true);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Streams a download to disk while authorizing the initial host and every
 * redirect hop against the SAME `isHostAllowed` decision.
 *
 * `isHostAllowed` may be asynchronous (the installers' default-deny path also
 * resolves the hostname via DNS), so it is AWAITED at every call site here —
 * previously the initial call and the per-hop call were both invoked without
 * awaiting, which meant an async rejection surfaced as an unhandled rejection
 * while the download proceeded (#161/#191). It should THROW with a
 * caller-specific message rather than return a bare boolean, so the error text
 * can name the offending host and the applicable allowlist.
 *
 * The per-hop call is passed `next.host` (not `next.hostname`) so an explicit
 * port travels with the host, matching the sibling terraform extension's copy:
 * the address checks strip the port themselves, and an allowlist entry without
 * a port no longer silently matches a redirect to a different port.
 */
export async function downloadToFile(
    url: string,
    destPath: string,
    timeoutMs: number,
    isHostAllowed: (hostname: string) => void | Promise<void>,
): Promise<void> {
    await withRetry(() => attemptDownloadToFile(url, destPath, timeoutMs, isHostAllowed));
}

/**
 * A single downloadToFile attempt. Safe to retry: it clears any partial file a
 * PRIOR attempt left behind before opening its own write stream, and re-runs
 * `isHostAllowed` from scratch for the initial host and every redirect hop, so a
 * retry can neither resume into a truncated download nor reuse a stale
 * authorization decision.
 *
 * An `isHostAllowed` rejection is re-thrown as a NON-retryable HttpError.
 * withRetry treats any non-HttpError as transient, so without this an
 * egress-authorization refusal -- a deterministic security decision, never a
 * network condition -- would burn the retry budget and hand a DNS-rebinding host
 * repeated chances within one run to flip from rejected to allowed.
 */
async function attemptDownloadToFile(
    url: string,
    destPath: string,
    timeoutMs: number,
    isHostAllowed: (hostname: string) => void | Promise<void>,
): Promise<void> {
    const assertHostAllowed = async (hostname: string): Promise<void> => {
        try {
            await isHostAllowed(hostname);
        } catch (error) {
            throw new HttpError(error instanceof Error ? error.message : String(error), false);
        }
    };

    // Start each attempt from a clean destination. createWriteStream's default
    // 'w' truncates on open; this makes that guarantee explicit.
    try { fs.unlinkSync(destPath); } catch { /* nothing to remove -- the common case */ }

    await assertHostAllowed(new URL(url).hostname);
    try {
        await fetchWithTimeout(
            url,
            timeoutMs,
            async (response) => {
                if (!response.ok) {
                    throw new HttpError(`Download from ${url} failed with HTTP ${response.status}.`, response.status >= 500);
                }
                if (!response.body) {
                    throw new HttpError(`Download from ${url} returned an empty response body.`, false);
                }
                await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(destPath));
            },
            async (_originHost, next) => {
                await assertHostAllowed(next.host);
                return true;
            },
        );
    } catch (error) {
        try { fs.unlinkSync(destPath); } catch { /* best effort cleanup */ }
        throw error;
    }
}

/** Retries a fetch on transient failures (network error, timeout, 5xx) with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            // A non-HttpError is a network/DNS/TLS failure — treat as transient.
            const retryable = err instanceof HttpError ? err.retryable : true;
            if (!retryable || attempt === RETRY_ATTEMPTS) throw err;
            tasks.debug(`Fetch attempt ${attempt} failed (${err instanceof Error ? err.message : err}); retrying...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_BASE_MS * Math.pow(2, attempt - 1)));
        }
    }
    throw lastErr;
}

export function fetchJson<T>(url: string): Promise<T> {
    return withRetry(() => fetchWithTimeout(url, METADATA_TIMEOUT_MS, async (response) => {
        if (!response.ok) {
            throw new HttpError(tasks.loc("RegistryRequestFailed", url, response.status), response.status >= 500);
        }
        return (await response.json()) as T;
    }));
}

export function fetchText(url: string): Promise<string> {
    return withRetry(() => fetchWithTimeout(url, METADATA_TIMEOUT_MS, async (response) => {
        if (!response.ok) {
            throw new HttpError(`Failed to fetch ${url}: HTTP ${response.status}`, response.status >= 500);
        }
        // The returned promise is awaited inside fetchWithTimeout's guard, so the
        // body read stays bounded by the timeout without a redundant await here.
        return response.text();
    }));
}

/**
 * Like fetchText, but returns null on a 404 (resource genuinely absent) so
 * callers can distinguish "not published" from a transient/other failure
 * without substring-matching error text. Other non-2xx and network errors
 * still throw (5xx is retried).
 */
export function fetchTextAllow404(url: string): Promise<string | null> {
    return withRetry(() => fetchWithTimeout(url, METADATA_TIMEOUT_MS, async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) {
            throw new HttpError(`Failed to fetch ${url}: HTTP ${response.status}`, response.status >= 500);
        }
        return response.text();
    }));
}

export function fetchBuffer(url: string): Promise<Uint8Array> {
    return withRetry(() => fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS, async (response) => {
        if (!response.ok) {
            throw new HttpError(`Failed to fetch ${url}: HTTP ${response.status}`, response.status >= 500);
        }
        return new Uint8Array(await response.arrayBuffer());
    }));
}

/**
 * Like fetchBuffer, but returns null on a 404 (resource genuinely absent) so
 * callers can distinguish "not published" from a transient/other failure
 * without substring-matching error text. Other non-2xx and network errors
 * still throw (5xx is retried).
 */
export function fetchBufferAllow404(url: string): Promise<Uint8Array | null> {
    return withRetry(() => fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS, async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) {
            throw new HttpError(`Failed to fetch ${url}: HTTP ${response.status}`, response.status >= 500);
        }
        return new Uint8Array(await response.arrayBuffer());
    }));
}
