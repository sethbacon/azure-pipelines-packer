// @shared-module: copied from azure-pipelines-terraform (Tasks/TerraformTask/TerraformTaskV5/src/proxy-config.ts)
// @shared-module-policy: This is a copy of the sibling extension's proxy helper. Until a
//   shared cross-extension package is extracted, apply fixes to both copies and keep the
//   provenance header current. Enforced by scripts/check-shared-modules.js.
// @shared-module-status: DIVERGED — the resolution now comes from
//   @4cloudguru/pipeline-task-core (resolveProxy), which is a SUPERSET of what both copies
//   did: it also masks a credential embedded directly in Agent.ProxyUrl, a spelling both
//   copies missed entirely because they only masked when Agent.ProxyUsername was separately
//   set. What stays here is the dispatcher construction and the setSecret calls, because
//   the package imports neither undici nor the ADO task lib. Backport to
//   azure-pipelines-terraform is pending; do not "reconcile" by reverting either.
import tasks = require('azure-pipelines-task-lib/task');
import { ProxyAgent } from 'undici';
import { resolveProxy } from '@4cloudguru/pipeline-task-core';

/**
 * Builds fetch() RequestInit options that route the request through the
 * agent's configured HTTP proxy (Agent.ProxyUrl / Agent.ProxyUsername /
 * Agent.ProxyPassword), if one is set. Self-hosted agents that require a proxy
 * for outbound internet access typically require it for ANY external HTTPS
 * call, including the ADO OIDC token request this task makes via fetch() for
 * every WIF provider (#196). Returns an empty object when no proxy is
 * configured, so callers can always spread the result unconditionally.
 */
export function buildProxyFetchOptions(): RequestInit {
  const resolved = resolveProxy(tasks.getHttpProxyConfiguration());
  if (!resolved) return {};

  // Every spelling of the credential the resolver found, including the
  // percent-encoded form the dispatcher URL actually embeds: the agent's masker
  // matches registered literals, never derivations of them.
  for (const secret of resolved.secrets) {
    tasks.setSecret(secret);
  }

  return {
    // @ts-expect-error Node.js fetch accepts undici dispatcher
    dispatcher: new ProxyAgent(resolved.proxyUrl),
  };
}
