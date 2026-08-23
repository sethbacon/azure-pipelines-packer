// @shared-module: copied from azure-pipelines-terraform (Tasks/TerraformInstaller/TerraformInstallerV1/src/http-client.ts)
// @shared-module-policy: The transport is no longer copied — it comes from
//   @4cloudguru/pipeline-task-core, so a fix to it belongs in that package and reaches
//   both extensions by version bump rather than by editing two files. What is left here
//   is this task's own wiring, which is NOT expected to match terraform's; see the status
//   below. Enforced by scripts/check-shared-modules.js.
// @shared-module-status: DIVERGED — both extensions now delegate, so the wiring no longer
//   drifts: the transport comes from @4cloudguru/pipeline-task-core (which took the UNION
//   of this copy and terraform's three), and the Azure DevOps wiring around it — proxy
//   dispatch, secret registration, the debug channel — from @4cloudguru/pipeline-task-ado.
//   What remains is only what neither package can know: this task's localized message
//   text, and its redirect policy.
//
//   The remaining divergence is that redirect policy, and it is DELIBERATE. This copy
//   passes none, so the core client's same-host default applies. Terraform's copies opt
//   into the GitHub release-asset exception because they fetch OpenTofu/OPA/terraform-docs
//   material that 302s onto githubusercontent.com; Packer downloads only from
//   releases.hashicorp.com and must not widen its redirect surface to match. Do not
//   "reconcile" these by copying terraform's call here.
import tasks = require('azure-pipelines-task-lib/task');
import { createAdoHttpClient } from '@4cloudguru/pipeline-task-ado';
import {
    DOWNLOAD_TIMEOUT_MS as CORE_DOWNLOAD_TIMEOUT_MS,
    METADATA_TIMEOUT_MS as CORE_METADATA_TIMEOUT_MS,
} from '@4cloudguru/pipeline-task-core';

// Re-exported as values rather than `export { ... }`, which compiles to getter
// thunks that count as uncovered functions no test can meaningfully reach.
export const METADATA_TIMEOUT_MS = CORE_METADATA_TIMEOUT_MS;
export const DOWNLOAD_TIMEOUT_MS = CORE_DOWNLOAD_TIMEOUT_MS;

const insecureUrl = (url: string) => tasks.loc("InsecureUrlRejected", url);

// Each client gets its own factory so the proxy-parity signature can name which
// construction it is reporting; two bare module-level calls are indistinguishable
// to it, and an unnamed site is the one thing that gate exists to avoid.
function createDefaultClient() {
    return createAdoHttpClient({
        messages: { insecureUrl, requestFailed: (url, status) => `Failed to fetch ${url}: HTTP ${status}` },
    });
}

// Registry metadata gets its own message: "Registry request failed" is wrong on a
// releases.hashicorp.com SHA256SUMS fetch, which is not a registry request at all.
function createRegistryClient() {
    return createAdoHttpClient({
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
