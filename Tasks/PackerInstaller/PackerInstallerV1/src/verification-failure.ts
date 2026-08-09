// @shared-module: copied from azure-pipelines-terraform (Tasks/TerraformInstaller/TerraformInstallerV1/src/verification-failure.ts)
// @shared-module-policy: This is a copy of the sibling extension's verification-failure
//   classifier. The cache-hit re-verification path in both extensions keys on it, so a
//   change to what counts as a deterministic policy failure MUST be applied to both
//   copies. Enforced by scripts/check-shared-modules.js.
// @shared-module-status: IN-SYNC — the body below is byte-identical to the terraform
//   copy (which is itself byte-identical across its three installer tasks); only the
//   provenance header differs.

/**
 * Error thrown when a REACHABLE source fails a REQUIRED verification policy. Two
 * cases fall under this:
 *
 *  1. Material (a SHA256SUMS/.sha256 file, a GPG/cosign signature, or a
 *     registry-provided sha256) was successfully OBTAINED but the artifact FAILED
 *     verification against it: a bad or wrong-key signature, a checksum mismatch,
 *     or a checksum file that does not list the requested asset.
 *  2. Material that a require-flag makes MANDATORY was deterministically WITHHELD by
 *     a reachable source: a registry that returns an empty sha256 under
 *     requireChecksum, or a reachable mirror/release that 404s the SHA256SUMS/.sha256
 *     (requireChecksum) or the GPG/cosign signature (requireGpgSignature /
 *     requireCosignVerification) it is required to serve.
 *
 * Both are deterministic, reproducible policy failures — retrying or falling back
 * to a never-verified cached copy is never the right response.
 *
 * Deliberately NOT used when material is unavailable for a NON-deterministic or
 * non-source reason: a transport outage (network/DNS/TLS failure, timeout, 5xx), a
 * 404 for material that is NOT required (the caller just warns and continues
 * unverified), or the local verifier tool being absent (cosign binary not
 * installed). The cache-hit re-verification path keys on this distinction: a
 * VerificationFailure fails closed, while "the material cannot be fetched because
 * the source is unreachable" degrades gracefully to the cached tool (preserving
 * offline/air-gapped cache reuse) with a warning.
 */
export class VerificationFailure extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'VerificationFailure';
        Object.setPrototypeOf(this, VerificationFailure.prototype);
    }
}

/**
 * instanceof with a name-based fallback: mockery-based tests (and any duplicated
 * module instance) can surface a structurally identical error whose class
 * identity differs, so classification also keys on the stable `name` marker.
 */
export function isVerificationFailure(err: unknown): boolean {
    return err instanceof VerificationFailure || (err instanceof Error && err.name === 'VerificationFailure');
}
