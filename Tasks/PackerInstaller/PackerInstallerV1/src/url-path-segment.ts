// @shared-module: copied from azure-pipelines-terraform (Tasks/TerraformInstaller/TerraformInstallerV1/src/url-path-segment.ts)
// @shared-module-policy: This is a copy of the sibling extension's URL path-segment
//   validator. Until a shared cross-extension package is extracted, apply fixes to both
//   copies and keep the provenance header current. Enforced by scripts/check-shared-modules.js.
// @shared-module-status: IN-SYNC — the module body below is byte-identical to
//   azure-pipelines-terraform's copy as of 2026-08-08 (#200); only this header differs.

/**
 * A single URL path segment supplied by the pipeline author (currently
 * `registryMirrorName`, interpolated into `${registryUrl}/terraform/binaries/
 * ${name}/versions/...`). Must start with a letter or digit — which alone
 * rejects the dot-only names `.` and `..` — and may then contain only letters,
 * digits, `.`, `_` and `-`.
 */
const URL_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validates an operator-supplied value before it is interpolated into a URL
 * path, rejecting path separators and traversal shapes.
 *
 * The previous charset-only pattern (`/^[A-Za-z0-9._-]+$/`) matched the literal
 * string `..` even though its doc comment claimed traversal shapes were
 * rejected: `registryMirrorName: ".."` produced
 * `https://registry.example.com/terraform/binaries/../versions/latest`, which
 * the WHATWG URL parser normalizes to `/terraform/versions/latest` before the
 * request is issued — a one-segment escape from the intended API namespace
 * (#200). Both the leading-alphanumeric anchor and the explicit `..` rejection
 * are enforced here, so a value can never contain an embedded traversal pair
 * either.
 *
 * Returns the value unchanged so call sites can validate and assign in one step.
 */
export function validateUrlPathSegment(inputName: string, value: string): string {
    if (!URL_PATH_SEGMENT_PATTERN.test(value) || value.includes('..')) {
        throw new Error(
            `${inputName} '${value}' is not a valid URL path segment: it must start with a letter or digit, ` +
            `contain only letters, digits, '.', '_', '-', and must not contain '..'.`,
        );
    }
    return value;
}
