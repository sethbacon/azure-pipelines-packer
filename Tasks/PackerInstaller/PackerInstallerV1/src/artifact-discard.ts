// @shared-module: copied from azure-pipelines-terraform (Tasks/TerraformInstaller/TerraformInstallerV1/src/artifact-discard.ts)
// @shared-module-policy: This is a copy of the sibling extension's discard-on-failed-
//   verification wrapper. The rule it encodes — a failed COMPARISON deletes the
//   artifact, a merely UNAVAILABLE checksum the operator opted out of requiring does
//   not — must not drift between the extensions. Apply fixes to both copies.
//   Enforced by scripts/check-shared-modules.js.
// @shared-module-status: IN-SYNC — byte-identical to the terraform copy below the
//   provenance header.

import fs = require('fs');
import tasks = require('azure-pipelines-task-lib/task');

/**
 * Runs `verify` over a freshly downloaded artifact and, if any check inside it
 * throws, DELETES the artifact before rethrowing.
 *
 * http-client.ts's downloadToFile already unlinks its destination when the
 * TRANSFER fails, but verification is a separate, later step: an archive whose
 * SHA256 does not match — i.e. one that may have been tampered with — was
 * otherwise left in Agent.TempDirectory/os.tmpdir() indefinitely on a persistent
 * self-hosted agent. EVERY verification of a freshly downloaded artifact goes
 * through this wrapper, so a rejected artifact never outlives the check that
 * rejected it. The unlink is best-effort and never masks the verification error
 * that triggered it.
 *
 * Deliberately NOT used for the agent's CACHED executable: that file belongs to
 * the tool cache and other jobs may be using it, so a failed cache re-verification
 * fails the task without evicting it.
 *
 * Also deliberately NOT used for a checksum that is merely UNAVAILABLE (a source
 * that published no checksum file, or a checksum file that does not list the
 * requested asset) when the operator has opted out of requiring one: that install
 * legitimately proceeds, so the artifact must survive. Wrap the comparison, not
 * the lookup.
 */
export async function discardArtifactOnFailure<T>(artifactPath: string, verify: () => Promise<T>): Promise<T> {
    try {
        return await verify();
    } catch (error) {
        try {
            fs.unlinkSync(artifactPath);
            tasks.debug(`Discarded ${artifactPath}: it failed integrity verification.`);
        } catch { /* best effort — the verification error is what matters */ }
        throw error;
    }
}
