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
import {
    createHttpClient,
    resolveProxy,
    DOWNLOAD_TIMEOUT_MS as CORE_DOWNLOAD_TIMEOUT_MS,
    METADATA_TIMEOUT_MS as CORE_METADATA_TIMEOUT_MS,
} from '@4cloudguru/pipeline-task-core';

// Re-exported as values rather than `export { ... }`, which compiles to getter
// thunks that count as uncovered functions no test can meaningfully reach.
export const METADATA_TIMEOUT_MS = CORE_METADATA_TIMEOUT_MS;
export const DOWNLOAD_TIMEOUT_MS = CORE_DOWNLOAD_TIMEOUT_MS;

function buildFetchOptions(): RequestInit {
    const resolved = resolveProxy(tasks.getHttpProxyConfiguration());
    if (!resolved) return {};

    // Every spelling of the credential the resolver found, including the
    // percent-encoded form the dispatcher URL actually embeds: the agent's
    // masker matches registered literals, never derivations of them.
    for (const secret of resolved.secrets) {
        tasks.setSecret(secret);
    }

    return {
        // @ts-expect-error Node.js fetch accepts undici dispatcher
        dispatcher: new ProxyAgent(resolved.proxyUrl)
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
