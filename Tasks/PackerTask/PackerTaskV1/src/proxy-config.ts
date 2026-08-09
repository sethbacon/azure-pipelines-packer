// @shared-module: copied from azure-pipelines-terraform (Tasks/TerraformTask/TerraformTaskV5/src/proxy-config.ts)
// @shared-module-policy: This is a copy of the sibling extension's proxy helper. Until a
//   shared cross-extension package is extracted, apply fixes to both copies and keep the
//   provenance header current. Enforced by scripts/check-shared-modules.js.
// @shared-module-status: DIVERGED — the executable body (everything from `export function`
//   down) is BYTE-IDENTICAL to the terraform copy, including the two setSecret() calls that
//   register the raw AND the URL-percent-encoded proxy password. Only the JSDoc differs: the
//   terraform copy names its OCI Identity Domains token-exchange call site, which does not
//   exist in this extension. Port any behavioural change to both copies.
import tasks = require('azure-pipelines-task-lib/task');
import { ProxyAgent } from 'undici';

/**
 * Builds fetch() RequestInit options that route the request through the
 * agent's configured HTTP proxy (Agent.ProxyUrl / Agent.ProxyUsername /
 * Agent.ProxyPassword), if one is set. Mirrors the equivalent
 * buildFetchOptions() helper in PackerInstallerV1's http-client.ts —
 * self-hosted agents that require a proxy for outbound internet access
 * typically require it for ANY external HTTPS call, including the ADO OIDC
 * token request this task makes via fetch() for every WIF provider (#196).
 * Returns an empty object when no proxy is configured, so callers can always
 * spread the result into their own RequestInit unconditionally.
 */
export function buildProxyFetchOptions(): RequestInit {
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
    // 'p@ss' -> 'p%40ss') -- a byte-different string from the raw
    // proxyPassword already setSecret()'d above. ADO's log masker matches
    // literal registered strings, not derivations, so this encoded form
    // (which is what proxyUrl.toString() below actually embeds) needs its
    // own registration too, matching the derived-form masking the installer/
    // module-publish transport helpers already do for their own credential
    // URLs (#684).
    if (url.password) {
      tasks.setSecret(url.password);
    }
    proxyUrl = url.toString();
  }

  return {
    // @ts-expect-error Node.js fetch accepts undici dispatcher
    dispatcher: new ProxyAgent(proxyUrl),
  };
}
