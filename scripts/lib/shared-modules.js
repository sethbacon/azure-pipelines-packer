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

const COMMAND_TESTS = 'Tasks/PackerTask/PackerTaskV1/Tests';
const INSTALLER_TESTS = 'Tasks/PackerInstaller/PackerInstallerV1/Tests';

// One module is duplicated WITHIN this repository, and it is duplicated because
// each task's Tests/ directory is its own compilation unit: `shared-gate.ts`,
// the resolver every class-gate L0 suite uses to find a gate this repository no
// longer carries. The four gates it resolves (check-proxy-parity,
// check-artifact-trust, auth-parity-matrix, check-enforced-disciplines) are
// composite actions in 4cloudguru/shared-workflows, pinned by full commit SHA;
// on a runner the composite exports its own github.action_path and this file
// reads it, so the bytes the suite spawns are the bytes the pin names. A fix to
// the resolution or to its error text must land in BOTH copies -- an L0 suite
// that could not find its gate but read like a clean run is the exact failure
// this estate keeps re-learning, so a drift here is a red required check.
const FAMILIES = [
    { dirs: [COMMAND_TESTS, INSTALLER_TESTS], modules: ['shared-gate.ts'] },
];

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
    // NOT HERE YET, DELIBERATELY: Tests/shared-gate.ts. Its header declares
    // azure-pipelines-terraform (TerraformTaskV5/Tests/shared-gate.ts) as its
    // upstream, and that is where it belongs -- but that file does not exist in
    // that repository yet; its own PR in this series creates it. The replay's
    // cross-repo-copy-parity signature reads this array and then reads the
    // upstream repository's LIVE main, so registering the entry one PR early
    // reports a site -- "upstream has no file at ..." -- on every pull request
    // in every replay host, for a file that is simply not there yet. Measured,
    // not predicted: it turned #1112 from 1 matched site to 2 and the replay
    // red. The entry belongs in the SAME pull request that lands the upstream
    // copy in azure-pipelines-terraform. Until then the two copies here are
    // still gated -- byte-identically, by the FAMILIES entry above, which is a
    // red required check in this repository's own CI.
    // Extracted from base-packer-command-handler.ts (#113), where it had been a
    // seventh copy of a module the sibling extensions gate as a byte-identical
    // family -- and invisible to every basename-keyed check because it was inline.
    { dir: COMMAND_SRC, file: 'path-containment.ts', upstream: UPSTREAM },
    // Secure var-file value extraction + masking. Registered on #1105: this file
    // was copied from terraform-ext and then drifted UNGATED -- it was governed by
    // neither this list nor terraform's byte-identical FAMILIES list, which is
    // exactly why an identical extractor defect (a string-unaware comment pre-pass
    // that truncated quoted values at ' #' / ' //', mis-paired the dangling quote
    // with a quote on a LATER line, and never extracted heredoc bodies at all)
    // survived in BOTH copies past every gate. Fixes to the extraction logic must
    // be applied to both repositories' copies.
    { dir: COMMAND_SRC, file: 'secure-var-file-masking.ts', upstream: UPSTREAM },
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
    // createAdoHttpClient() in @4cloudguru/pipeline-task-ado, confirmed by the
    // check-proxy-parity gate reporting all 4 sites PROXIED-BY-PACKAGE with zero
    // local proxy-config.ts callers left -- it was dead code, not a live gate.
];

module.exports = { FAMILIES, PROVENANCE };
