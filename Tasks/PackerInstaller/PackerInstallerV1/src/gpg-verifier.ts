// @shared-module: copied from azure-pipelines-terraform (Tasks/TerraformInstaller/TerraformInstallerV1/src/gpg-verifier.ts)
// @shared-module-policy: This is a copy of the sibling extension's SHA256SUMS.sig verifier.
//   Apply verification-logic fixes to both copies. Enforced by scripts/check-shared-modules.js.
// @shared-module-status: DIVERGED — this copy now distinguishes a genuine 404 (signature
//   not published) from a transient/network failure via fetchBufferAllow404, so a
//   requireGpgSignature=false opt-out only downgrades on real absence, not on a 5xx/network
//   blip an attacker could induce (#106). Backport to azure-pipelines-terraform is pending;
//   do not "reconcile" by reverting this.
import tasks = require('azure-pipelines-task-lib/task');
import * as openpgp from 'openpgp';

import { fetchBufferAllow404 } from './http-client';
import { HASHICORP_GPG_PUBLIC_KEY } from './hashicorp-gpg-key';

/**
 * Verifies the GPG signature of a SHA256SUMS file against HashiCorp's public key.
 * Fetches the `.sig` file from the same base URL as the SHA256SUMS file.
 *
 * - If verification succeeds, returns the SHA256SUMS content (already fetched).
 * - If the `.sig` file is genuinely absent (HTTP 404) and `required` is false, warns and
 *   returns unverified.
 * - If the `.sig` file is genuinely absent (HTTP 404) and `required` is true, throws.
 * - Any other fetch failure (5xx / network / timeout) is transient and always throws —
 *   even when `required` is false — so an attacker who can merely disrupt the .sig fetch
 *   cannot strip verification from a mirror that does publish signatures.
 * - If the signature is invalid, throws (hard fail).
 */
export async function verifyGpgSignature(sha256SumsContent: string, signatureUrl: string, required: boolean = false): Promise<void> {
    const signatureBytes = await fetchBufferAllow404(signatureUrl);
    if (signatureBytes === null) {
        if (required) {
            throw new Error(`GPG signature file unavailable (${signatureUrl}) and signature verification is required. Set 'requireGpgSignature' to false to skip.`);
        }
        tasks.warning(`GPG signature file unavailable (${signatureUrl}). SHA256SUMS will be trusted without signature verification.`);
        return;
    }

    tasks.debug(`Verifying GPG signature from ${signatureUrl}`);

    const publicKey = await openpgp.readKey({ armoredKey: HASHICORP_GPG_PUBLIC_KEY });
    const signature = await openpgp.readSignature({ binarySignature: signatureBytes });
    const message = await openpgp.createMessage({ text: sha256SumsContent });

    const result = await openpgp.verify({
        message,
        signature,
        verificationKeys: publicKey,
    });

    if (!result.signatures || result.signatures.length === 0) {
        throw new Error(`GPG signature verification failed: no signatures found in ${signatureUrl}`);
    }
    // A detached .sig file can carry more than one signature (e.g. during a signing-key
    // rotation window). Require at least one to verify successfully rather than only
    // checking signatures[0] -- a valid signature at any other index would otherwise be
    // silently ignored (#137).
    const outcomes = await Promise.allSettled(result.signatures.map((sig) => sig.verified));
    const anyVerified = outcomes.some((outcome) => outcome.status === 'fulfilled');
    if (!anyVerified) {
        const errors = outcomes
            .filter((o): o is PromiseRejectedResult => o.status === 'rejected')
            .map((o) => (o.reason instanceof Error ? o.reason.message : String(o.reason)));
        throw new Error(`GPG signature verification failed for SHA256SUMS: ${errors.join('; ') || 'no signature verified'}`);
    }

    tasks.debug('GPG signature verification passed');
}
