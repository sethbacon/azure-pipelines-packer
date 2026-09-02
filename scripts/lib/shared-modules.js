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

// No module is duplicated WITHIN this repository: each of the modules below
// exists in exactly one task, so there is no second in-repo copy to diff
// against. The list is empty and stated rather than absent, so a future
// duplicate has an obvious place to be registered instead of arriving
// ungated.
const FAMILIES = [];

// The registry of modules copied from azure-pipelines-terraform. Adding a new
// copy means adding it here AND giving it the provenance header.
//
// A cross-repo byte diff is neither available in CI nor meaningful any more. The
// transport these modules used to duplicate now lives in
// @4cloudguru/pipeline-task-core, with the Azure DevOps wiring around it in
// @4cloudguru/pipeline-task-ado, and both extensions delegate to them. What is
// left in each copy is the per-task wiring neither package can know: its
// localized message text and, for http-client.ts, a deliberately NARROWER
// redirect policy than terraform's, which opts into a GitHub release-asset
// exception this extension has no reason to widen to. So the invariant enforced
// is provenance, not identity: every copy declares its upstream, its sync
// policy, and whether it is still IN-SYNC or deliberately DIVERGED.
//
// Entries carry their own src dir: the registry used to assume a single
// directory (the installer's), which meant a copied module landing in the
// COMMAND task's src/ could not be registered at all and so was silently
// exempt from the provenance convention this gate exists to enforce.
const UPSTREAM = 'azure-pipelines-terraform';

const COMMAND_SRC = 'Tasks/PackerTask/PackerTaskV1/src';

const PROVENANCE = [
    // Extracted from base-packer-command-handler.ts (#113), where it had been a
    // seventh copy of a module the sibling extensions gate as a byte-identical
    // family -- and invisible to every basename-keyed check because it was inline.
    { dir: COMMAND_SRC, file: 'path-containment.ts', upstream: UPSTREAM },
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
    // proxy-config.ts (the agent-proxy fetch options builder, #196) is GONE too
    // (#337): every outbound call site now proxies via generateIdToken()/
    // createAdoHttpClient() in @4cloudguru/pipeline-task-ado, confirmed by
    // check-proxy-parity.js reporting all 4 sites PROXIED-BY-PACKAGE with zero
    // local proxy-config.ts callers left -- it was dead code, not a live gate.
];

module.exports = { FAMILIES, PROVENANCE };
