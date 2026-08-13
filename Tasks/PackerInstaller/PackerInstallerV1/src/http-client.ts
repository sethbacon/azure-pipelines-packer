// @shared-module: copied from azure-pipelines-terraform (Tasks/TerraformInstaller/TerraformInstallerV1/src/http-client.ts)
// @shared-module-policy: This is a copy of the sibling extension's HTTP client. Until a
//   shared cross-extension package is extracted, apply fixes to both copies and keep the
//   provenance header current. Enforced by scripts/check-shared-modules.js.
// @shared-module-status: DIVERGED — the client itself now comes from
//   @4cloudguru/pipeline-task-core (createHttpClient), which took the UNION of this copy
//   and terraform's three: this copy contributed the retry-safe download attempt, and in
//   return the task gains what it had never taken — MAX_RESPONSE_BYTES-bounded in-memory
//   bodies, 429/Retry-After handling, and deterministic (non-retried) classification of a
//   2xx that is not JSON. What stays here is what the package deliberately refuses to own:
//   it imports neither azure-pipelines-task-lib nor undici, so proxy dispatch, secret
//   masking and localized message text are injected from the task. Backport to
//   azure-pipelines-terraform is pending; do not "reconcile" by reverting either.
import tasks = require('azure-pipelines-task-lib/task');
import { ProxyAgent } from 'undici';
import { createHttpClient, DOWNLOAD_TIMEOUT_MS, METADATA_TIMEOUT_MS } from '@4cloudguru/pipeline-task-core';

export { METADATA_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS };

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

const injected = {
    // Re-evaluated per attempt, so a proxy change between retries is picked up.
    fetchOptions: buildFetchOptions,
    debug: (message: string) => tasks.debug(message),
};

const insecureUrl = (url: string) => tasks.loc("InsecureUrlRejected", url);

// Each client gets its own factory so the proxy-parity signature can name which
// construction it is reporting; two bare module-level calls are indistinguishable
// to it, and an unnamed site is the one thing that gate exists to avoid.
function createDefaultClient() {
    return createHttpClient({
        ...injected,
        messages: { insecureUrl, requestFailed: (url, status) => `Failed to fetch ${url}: HTTP ${status}` },
    });
}

// Registry metadata gets its own message: "Registry request failed" is wrong on a
// releases.hashicorp.com SHA256SUMS fetch, which is not a registry request at all.
function createRegistryClient() {
    return createHttpClient({
        ...injected,
        messages: { insecureUrl, requestFailed: (url, status) => tasks.loc("RegistryRequestFailed", url, status) },
    });
}

const client = createDefaultClient();
const registryClient = createRegistryClient();

export const fetchWithTimeout = client.fetchWithTimeout;
export const fetchText = client.fetchText;
export const fetchTextAllow404 = client.fetchTextAllow404;
export const fetchBuffer = client.fetchBuffer;
export const fetchBufferAllow404 = client.fetchBufferAllow404;
export const downloadToFile = client.downloadToFile;
export const fetchJson = registryClient.fetchJson;
