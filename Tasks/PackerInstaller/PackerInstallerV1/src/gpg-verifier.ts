// @shared-module: copied from azure-pipelines-terraform (Tasks/TerraformInstaller/TerraformInstallerV1/src/gpg-verifier.ts)
// @shared-module-policy: This is a copy of the sibling extension's SHA256SUMS.sig verifier.
//   Apply verification-logic fixes to both copies. Enforced by scripts/check-shared-modules.js.
// @shared-module-status: DIVERGED — the CRYPTOGRAPHIC decision now comes from
//   @4cloudguru/pipeline-task-core/gpg (verifyDetached), so the multi-signature handling
//   (#137) and the openpgp API surface live in ONE place instead of two copies; what stays
//   here is everything the package deliberately refuses to own. The trust root
//   (HASHICORP_GPG_PUBLIC_KEY) stays because vendoring a signing key through a package
//   means a compromise of that package silently replaces it. The 404-vs-transient
//   distinction (#106) stays because only the caller knows that a missing signature MAY be
//   downgraded on operator opt-out while a 5xx never may. The VerificationFailure typing
//   stays because it is what lets the cache-hit re-verification path fail closed on a bad
//   signature while degrading on a transport outage. Backport to azure-pipelines-terraform
//   is pending; do not "reconcile" by reverting either.
import tasks = require('azure-pipelines-task-lib/task');

import { verifyDetached } from '@4cloudguru/pipeline-task-core/gpg';

import { fetchBufferAllow404 } from './http-client';
import { HASHICORP_GPG_PUBLIC_KEY } from './hashicorp-gpg-key';
import { VerificationFailure } from '@4cloudguru/pipeline-task-core';

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
            throw new VerificationFailure(`GPG signature file unavailable (${signatureUrl}) and signature verification is required. Set 'requireGpgSignature' to false to skip.`);
        }
        tasks.warning(`GPG signature file unavailable (${signatureUrl}). SHA256SUMS will be trusted without signature verification.`);
        return;
    }

    tasks.debug(`Verifying GPG signature from ${signatureUrl}`);

    const result = await verifyDetached({
        message: new TextEncoder().encode(sha256SumsContent),
        signature: signatureBytes,
        armoredPublicKeys: [HASHICORP_GPG_PUBLIC_KEY],
    });

    if (!result.verified) {
        // The reasons are why an operator can tell a key-rotation miss from a tampered
        // file; without them this failure reads the same either way. The URL is kept
        // because the deleted "no signatures found in <url>" branch was the only place
        // a zero-signature .sig named which file was empty.
        const detail = result.reasons?.join('; ') || 'no signature verified';
        throw new VerificationFailure(`GPG signature verification failed for SHA256SUMS (${signatureUrl}): ${detail}`);
    }

    tasks.debug('GPG signature verification passed');
}
