// The shared-module lists for this repository. The LOGIC that consumes them is
// scripts/check-shared-modules.js, which is byte-identical across the three
// extensions; these lists are the part that legitimately differs.
//
// FAMILIES   directories that must carry byte-identical copies of the named
//            modules. The first dir is canonical; every other dir's copy must
//            match it exactly.
// PROVENANCE modules copied from ANOTHER repository, which cannot be
//            byte-compared here and must instead carry a machine-checkable
//            provenance header naming their upstream and sync status.

const INSTALLER_SRC = 'Tasks/PackerInstaller/PackerInstallerV1/src';
const TASK_SRC = 'Tasks/PackerTask/PackerTaskV1/src';

// No module is duplicated WITHIN this repository: each of the modules below
// exists in exactly one task, so there is no second in-repo copy to diff
// against. The list is empty and stated rather than absent, so a future
// duplicate has an obvious place to be registered instead of arriving
// ungated.
const FAMILIES = [];

// The registry of modules copied from azure-pipelines-terraform. Adding a new
// copy means adding it here AND giving it the provenance header.
//
// A cross-repo byte diff is neither available in CI nor correct any more --
// http-client.ts has intentionally advanced ahead of the terraform copy (per-hop
// redirect host/scheme re-validation, MAX_REDIRECTS, typed HttpError + withRetry,
// fetchTextAllow404). So the invariant enforced is provenance, not identity:
// every copy declares its upstream, its sync policy, and whether it is still
// IN-SYNC or deliberately DIVERGED.
//
// Entries carry their own src dir: the registry used to assume a single
// directory (the installer's), which meant a copied module landing in the
// COMMAND task's src/ could not be registered at all and so was silently
// exempt from the provenance convention this gate exists to enforce.
const UPSTREAM = 'azure-pipelines-terraform';

const PROVENANCE = [
    { dir: INSTALLER_SRC, file: 'hashicorp-gpg-key.ts', upstream: UPSTREAM },
    { dir: INSTALLER_SRC, file: 'gpg-verifier.ts', upstream: UPSTREAM },
    { dir: INSTALLER_SRC, file: 'http-client.ts', upstream: UPSTREAM },
    // Egress authorization, the two URL-safety modules, and the verification pair
    // (verification-failure.ts, artifact-discard.ts) moved to
    // @4cloudguru/pipeline-task-core (src/egress/, src/url/, src/verification/) and
    // the local copies are deleted, so there is no longer a copy here to keep in
    // parity — the version pin is what enforces it now. The terraform copies stay
    // gated by THEIR OWN check until that repo takes the dependency too; until then
    // the two repos are deliberately no longer symmetrical.
    // The agent-proxy fetch options builder (#196). Body byte-identical to
    // TerraformTaskV5/src/proxy-config.ts, including both setSecret calls (raw
    // and percent-encoded proxy password); only the JSDoc names this repo's own
    // call site. scripts/check-proxy-parity.js enforces that every outbound call
    // actually uses it.
    { dir: TASK_SRC, file: 'proxy-config.ts', upstream: UPSTREAM },
];

module.exports = { FAMILIES, PROVENANCE };
