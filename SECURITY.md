# Security

This is an independent, community-built Azure DevOps extension. It is not affiliated with or supported by HashiCorp or Microsoft.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use [GitHub's private vulnerability reporting](https://github.com/sethbacon/azure-pipelines-packer/security/advisories/new) instead. This keeps the report confidential until a fix is available.

When reporting, please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce or proof-of-concept code if available
- The affected version(s) or commit range
- Any suggested mitigations you are aware of

You can expect an acknowledgement within a few business days. Fixes will be released as patch versions and documented in [CHANGELOG.md](CHANGELOG.md).

## Supported Versions

Only the latest published release receives security fixes. If you are running an older version, please upgrade before reporting.

## Credential handling

This extension injects cloud credentials as environment variables (never as CLI arguments) and clears every tracked variable in a `finally` block after each command. Secret values are registered with the agent's secret masker. Temporary credential files (OIDC tokens, GCP credential JSON, OCI/vSphere key material) are written with restrictive permissions and removed during cleanup. If you discover a case where a secret is logged, persisted, or leaked, please report it via the private advisory link above.

**Upstream residual: `secureVarsFile` download disables TLS certificate validation on a proxy-configured agent.** `secure-file-loader.ts` wraps `azure-pipelines-tasks-securefiles-common` (Microsoft's own library) to download a `secureVarsFile`. That library's `SecureFileHelpers` unconditionally sets `ignoreSslError: true` on its ADO WebApi connection whenever `tl.getHttpProxyConfiguration()` returns a proxy — this task's own code never opts into that, and cannot opt out of it. On an agent configured with an HTTP(S) proxy, the secure-file download — authenticated with the job's `SystemVssConnection` token and returning the user's secret var-file — runs over a TLS channel with certificate validation disabled, so a MITM positioned at or behind the proxy could capture the token/file content or substitute var-file contents (packer variable poisoning). This does not trigger on an agent with no proxy configured, which is the common case. Track the upstream `microsoft/azure-pipelines-tasks` repository for a fix; in the meantime, on a proxy-configured self-hosted agent, prefer a pipeline secret variable (`-var` / `packerVariables`) over `secureVarsFile` for values sensitive enough that this matters.

## Security-relevant toggles

Three inputs deliberately weaken integrity/transport verification and default to the safe setting — enable them only when you understand the tradeoff:

- **`vsphereInsecureConnection`** (`PipelinePacker@1`) disables vCenter TLS certificate verification for the `vsphere-iso`/`vsphere-clone` builders. With it enabled, the vCenter password is transmitted over a connection an on-path attacker could intercept. Use only against trusted networks with self-signed certificates you control — never in production. The task emits a pipeline warning whenever this is enabled.
- **`requireChecksum`** (`PipelinePackerInstaller@1`, mirror/registry sources) defaults to `true`: installation fails closed if the mirror or registry does not provide a SHA256 checksum. Disabling it means the downloaded Packer binary's integrity rests entirely on the mirror/registry host and the transport (HTTPS is still enforced). This matters most for the **registry** source, which has no independent signature chain at all — only disable it there for a registry you trust to have verified the binary server-side. The **mirror** source is different: it still honors `requireGpgSignature` (below) over the mirror's `SHA256SUMS` file, so disabling `requireChecksum` alone on a mirror does not drop GPG verification — you would need to disable both toggles to lose all integrity verification on that source. This holds on every mirror branch, including the two where the signature cannot cover the artifact at all: when the mirror publishes no `SHA256SUMS`, and when it publishes one that does not list the requested archive. In both, a signature verifies nothing about the download, so `requireGpgSignature` refuses rather than sitting enabled and inert.
- **`requireGpgSignature`** (`PipelinePackerInstaller@1`, `hashicorp` and `mirror` sources) defaults to `true`: installation fails closed if the source does not publish a GPG signature (`SHA256SUMS.sig`) for the checksums file. Disabling it drops the GPG chain and relies on SHA256 alone (still checked, unless `requireChecksum` is also disabled) — intended for mirrors that do not serve `.sig` files. The fail-open branch triggers whenever the `.sig` file is genuinely absent (HTTP 404), not just on that specific case — a mirror/registry you don't fully trust could still have its checksums tampered with if you disable this. The `registry` source never has a GPG signature step; this toggle only affects `hashicorp` and `mirror`.

Two further inputs **widen** where the installer is allowed to fetch from, rather than weakening verification. Both default to empty, which is the safe (default-deny) setting:

- **`mirrorAllowedHosts`** (`PipelinePackerInstaller@1`, `mirror` source) and **`registryAllowedHosts`** (`PipelinePackerInstaller@1`, `registry` source) are comma- or newline-separated host allowlists for the binary download. A `*.` prefix matches subdomains only (e.g. `*.s3.amazonaws.com`), mirroring TLS wildcard-SAN semantics.
  - **Empty (default) — baseline default-deny.** The download host is refused if it *is*, or *resolves to*, a loopback, link-local/metadata (`169.254.0.0/16`, including `169.254.169.254`), carrier-grade-NAT (`100.64.0.0/10`), RFC1918/ULA private, or otherwise non-public address. Addresses are classified numerically, so alternative spellings of the same address — `127.1`, `2130706433`, `0x7f000001`, `[::ffff:127.0.0.1]` — are covered too. The check is applied to the initial download URL **and re-applied to every redirect hop**.
  - **Non-empty — an explicit operator pin.** Only the listed hosts are accepted, again on the initial URL and on every redirect hop. This is how you point the installer at a legitimately private or air-gapped mirror/storage host: the baseline private-address refusal no longer applies, because you have named the host deliberately.
  - **Residual risk.** The default-deny check resolves the hostname at check time and does not pin the resulting IP into the connection, so an attacker controlling a host's authoritative DNS could still rebind it to a private address between the check and the connection. It is defense-in-depth against a host that statically points at a private address, not a complete DNS-rebinding defense. Use `mirrorAllowedHosts`/`registryAllowedHosts` plus `requireChecksum`/`requireGpgSignature` when the mirror is not fully trusted.

## Tool-cache integrity on persistent/self-hosted agents (`PipelinePackerInstaller@1`)

The tool cache persists across jobs on self-hosted agents, so a Packer binary cached by one job
is served to every later job that requests the same version. The installer closes this cross-job
trust gap in two layers:

1. **Local integrity hash.** After a checksum-verified download, the installer records the
   downloaded binary's SHA256 in a sidecar file (`<binary>.sha256`) beside it in the cached tool
   directory. Every later cache hit re-hashes the binary against the sidecar — a purely local,
   offline check — and **fails closed** on a mismatch (tampering or corruption since verification).
   A malformed record (empty, truncated, not 64 hex characters — e.g. an interrupted write) is
   treated as unverifiable, not as tampering, and escalates to layer 2 rather than bricking the
   cached version.
2. **Remote re-verification for an unmarked entry.** A cache hit with **no** usable sidecar (cached
   by an older installer version, or by a job that ran with verification disabled) is re-downloaded
   through the same source/verification path a fresh install would use, and the cached binary must
   byte-match the freshly verified release. A mismatch or a signature/checksum verification failure
   **fails closed**; if the source is merely unreachable (offline/air-gapped agents), the install
   degrades to the cached binary with a warning so air-gapped cache reuse keeps working —
   `requireOnlineReverification: true` overrides that degrade and fails closed instead, for shared
   persistent agents where you prefer an availability loss over trusting an entry an earlier job may
   have populated without verification. `requireChecksum: false` skips this re-verification entirely.

**Residual, and the control that addresses it.** The sidecar lives beside the binary it protects, so
an attacker with write access to the agent's tool cache can rewrite both the binary and the sidecar
consistently (and such an attacker can equally tamper with the agent itself). Layer 1 is
defense-in-depth against corruption and verification-policy mixing across jobs, not a defense
against a compromised agent account by default.

An operator who does not accept that co-located trust boundary on a given agent can set
`forceOnlineReverification: true`, which escalates **every** cache hit to layer 2's online
re-download-and-byte-compare — even when the local sidecar is present and valid. Default `false`, so
a pipeline that does not set it sees identical behavior to before this input existed; enabling it
trades the sidecar's no-network performance benefit for a control that does not depend on the
co-located sidecar at all. To force a full re-verification of one suspect cache entry (e.g. after a
mirror compromise is discovered) without enabling it fleet-wide, delete the tool's cached-version
directory (or just its `.sha256` sidecar) under the agent's `_work/_tool` cache and re-run.

## Plugin installation trust is delegated to Packer itself (`PipelinePackerTask@1`)

`init` (with `-upgrade`) and `plugins install`/`plugins remove` hand off entirely to Packer's own
plugin installer, which verifies each plugin's checksum against its published `SHA256SUMS` the same
way this extension's own `PipelinePackerInstaller@1` verifies the Packer binary itself. This task
layers no ADDITIONAL control on top: no task-level pinning of an explicit plugin version/checksum
manifest, no allow-list of plugin sources, and no post-install verification step of its own. The
`githubToken` input only raises the GitHub API rate limit for plugin downloads (`PACKER_GITHUB_API_TOKEN`)
— it plays no role in verification.

This mirrors how the Packer CLI is normally used outside of ADO: an operator who wants pinned plugin
versions declares a `required_plugins` block with explicit version constraints in the template
itself, and Packer enforces that constraint at `init` time on its own. There is no ADO-specific gap
here that a template-level `required_plugins` block does not already close.

**Deliberately not implemented: task-level enforcement that a template's `required_plugins` block
exists and is pinned before allowing `init`/`plugins install` to proceed.** That would be a genuine
value-add (catching an unpinned "install whatever's latest" template before Packer ever runs), but
it is also a real behavior change — it would fail `init` for any existing template that does not
already declare pinned plugin versions, silently, for every consumer of this task. Parsing a
`required_plugins` HCL block correctly (nested blocks, version-constraint operators, multiple
required_providers-style entries) is also nontrivial enough to warrant its own design pass rather
than folding into a documentation fix. If wanted, this should ship as an opt-in toggle (default off,
preserving today's behavior for every existing pipeline) — not a change to what `init`/`plugins
install` do by default.

## Release pipeline residual risk: Entra token visible via process arguments

The `publish-marketplace` job in `release.yml` mints a Microsoft Entra access token, scoped only to the Azure DevOps resource app, and passes it to `tfx extension publish --token "$ENTRA_TOKEN"` to authenticate the Marketplace publish. The token is registered with `::add-mask::` so it never appears in the GitHub Actions log, but it is still visible in `/proc/<pid>/cmdline` for the lifetime of the `tfx` process — GitHub Actions runners do not hide process arguments from other processes in the same job.

This was not fixed in code because `tfx-cli` 0.23.2 (the current pinned version) has no non-argv way to supply `--token`: no token-file option and no interactive stdin prompt. Two mitigations are in place instead:

- **Token lifetime is capped at 10 minutes** via a Microsoft Graph `tokenLifetimePolicy` assigned to the publishing service principal (`tsm-azdo-marketplace-publisher`, shared with the `azure-pipelines-terraform` extension's identical publish flow), down from the platform default of ~60-90 minutes. The `tfx extension publish` step completes in seconds, so this costs nothing operationally while sharply narrowing the window in which an exfiltrated token would still be valid.
- **The realistic exposure is narrow to begin with**: the only thing that could read `/proc/<pid>/cmdline` is other code already running in that same job, on a runner that is torn down immediately after. `npm ci --ignore-scripts` denies that other code a foothold in the first place, stopping a compromised transitive dependency (e.g. one accepted via a routine version bump) from ever executing in this job.

If a future `tfx-cli` release adds a non-argv token option, this job should switch to it and the token-lifetime policy can be relaxed back toward the platform default if useful.

## Standing OSV residuals

Each task's job in `unit-test.yml` runs `npm audit --omit=dev --audit-level=high`, so a **moderate or low** severity advisory in a production dependency does not fail the PR/push build. That gap is covered by `weekly-security.yml`'s `osv-scan` job, which runs the shared [`4cloudguru/shared-workflows`](https://github.com/4cloudguru/shared-workflows) `osv-scan` action with no severity filter and files (or comments on) a tracked GitHub issue labeled `security, dependencies`. That scan currently reports nothing and nothing is suppressed: this repository carries no `osv-scanner.toml`. What follows is how each advisory it has reported was disposed of.

`uuid` (GHSA-w5hq-g745-h8pq, moderate) is no longer a residual. It was accepted here while `azure-pipelines-tool-lib`'s latest release still pinned `uuid ^3.3.2`, and deliberately not overridden, because forcing a fixed `uuid` under tool-lib would have broken its v3-era `require('uuid/v4')` import. `PipelinePackerInstaller@1` took tool-lib `2.281.0` on 2026-09-28, which declares `uuid ^11.1.1` and imports it accordingly; the tree now resolves `uuid` `11.1.1`, the first fixed version, the weekly scan reports nothing for it, and the `osv-scanner.toml` entry that suppressed it has been removed.

`adm-zip` (GHSA-vwc7-r8mq-g2x9, moderate) is no longer a residual either. Symlink-following on extraction, it was reached transitively through `azure-pipelines-task-lib`, a production dependency of **both** tasks, and was accepted while there was nothing to bump to: `0.6.0` was the latest release and the advisory recorded `first_patched_version: none`. The exposure was **nil**, not merely unlikely: the Node `azure-pipelines-task-lib` package **never loads `adm-zip`**, because the dependency belongs to task-lib's **PowerShell** library, which these tasks do not ship ([`microsoft/azure-pipelines-task-lib#1202`](https://github.com/microsoft/azure-pipelines-task-lib/issues/1202)). `adm-zip` `0.6.1` shipped on 2026-09-11, outside the advisory's affected range (`>= 0.5.9, <= 0.6.0`) and with extraction through symlinks blocked; both tasks were moved to it on 2026-09-23 by an `"adm-zip": "^0.6.1"` override, and the `azure-pipelines-task-lib` both took on 2026-09-28 (`5.281.0`) no longer depends on it, so neither lockfile contains `adm-zip` at all. From that point the `osv-scanner.toml` in each of `Tasks/PackerInstaller/PackerInstallerV1/` and `Tasks/PackerTask/PackerTaskV1/` suppressed nothing, and both files have been deleted: the weekly scan reports nothing for the advisory unfiltered. The override stays as a floor, so that a dependency which brings `adm-zip` back brings a fixed version.

`brace-expansion` (GHSA-rgw5-rvv9-x895), `diff` (GHSA-73rr-hh4g-fpgx) and `qs` (GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx) are **not** residuals: each is remediated by moving to a fixed version, not accepted. `brace-expansion` and `diff` are pulled up through `overrides` entries in each task's `package.json`, since the packages that depend on them pin ranges that exclude the fixed versions — remove those overrides if the direct dependents ever declare fixed ranges of their own. `qs` is remediated one level up, by taking `typed-rest-client` `3.1.1`: `3.1.0` pins `qs 6.15.3` **exactly**, and `3.1.1`'s only dependency change is `qs ^6.16.0`, so it is the combination Microsoft published and tested — moving the SDK rather than forcing `qs` directly is what keeps the tree supported. The two tasks needed different mechanics for the same fix, because they reach `typed-rest-client` through different parents: `PackerInstaller` reaches it through `azure-pipelines-tool-lib`'s `^3.1.0`, a range that already admits `3.1.1`, so a plain `npm update typed-rest-client` resolved it with no override at all; `PackerTask` reaches it through `azure-devops-node-api@17.0.0`, which pins `3.1.0` exactly, so that task carries a `"typed-rest-client": "^3.1.1"` override.

`braces` (GHSA-vfj7-8cjw-p6xm, **high**) is not a residual either, but it is the one advisory here that could not be remediated by moving to a fixed version, because none exists: every published release (`<= 3.0.3`, which is also the latest) is vulnerable to a stack-exhaustion DoS on deeply nested patterns, the advisory records `first_patched_version: none`, and the upstream fix pull requests ([`micromatch/braces#72`](https://github.com/micromatch/braces/pull/72), [`#75`](https://github.com/micromatch/braces/pull/75)) were closed unmerged on 2026-10-05. Being high, it did not wait for the weekly scan: from the day GitHub reviewed it (2026-10-02) it failed the `npm audit` gate in all three lockfiles. It is remediated by taking it out of the tree. `braces` arrives through a single edge — `shelljs ^0.10.0` → `fast-glob` → `micromatch` → `braces` — and `shelljs` is declared by exactly two things: `azure-pipelines-task-lib` (both tasks) and the root `tfx-cli` devDependency. `shelljs` `0.8.5` is the last release before it adopted `fast-glob`, so the root `package.json` and both tasks' carry a `"shelljs": "0.8.5"` override, after which `fast-glob`, `micromatch` and `braces` are not installed at all. Forcing a version outside the range an SDK declares is what the `uuid` case above declined to do; it is supportable here for the reason the `adm-zip` exposure above was nil — the declared dependency is not what the shipped code runs. In task-lib `5.280.3` the **only** file that requires `shelljs` is the test harness `mock-test.js` (one `rm('-rf', …)` and one `mkdir('-p', …)` in its Node-download helper); the runtime entry point `task.js` never loads it, so nothing a pipeline executes changes. `tfx-cli` `0.23.2` calls it three times (`mkdir('-p', …)` twice and `cp()` once, in its task-scaffolding command and its disk cache). All of those behave identically in `0.8.5`: both tasks' suites pass on it — `PackerTask`'s through a fresh harness Node download, the path that makes those two calls — and `tfx extension create` still packages the extension. The same change raises the `brace-expansion` override floor from `^5.0.9` to `^5.0.12` for the three advisories reviewed on 2026-09-29 (GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p, GHSA-q2hr-2g5m-vwhr); that is the ordinary fixed-version case described above. Remove the `shelljs` overrides once `braces` ships a patched release, so that `shelljs` returns to the range its dependents declare.

## Supply-chain controls

This table is machine-checked. `4cloudguru/shared-workflows`' `check-docs-claims` composite action,
called by full commit SHA from the `Validate documented claims against the code` step of the
`Check Shared Module Provenance` job in `.github/workflows/unit-test.yml`, reads it on every pull
request and compares each row against `.github/workflows/`. The comparison runs in **both**
directions. A row marked `enforced` that no workflow implements fails the build — a security
document asserting an absent control is the defect the ledger exists for. A row marked `planned`
whose control has since appeared in a workflow fails it too: a claim becoming true by accident is
not the same as the document being correct. Adding a row the action has no detector for is also a
failure, because an unchecked claim is exactly the kind that drifts.

<!-- controls:begin -->

| Control | Status | What it means |
| --- | --- | --- |
| `marketplace-publish` | enforced | `.github/workflows/release.yml`'s `publish-marketplace` job (display name **Publish to VS Marketplace**) publishes the `.vsix` to the Visual Studio Marketplace, on a `v*` tag only, from the commit `guard` resolved on `main`. It authenticates with `azure/login` over GitHub OIDC against an Entra federated credential — there is no stored Marketplace PAT — mints a token scoped to the Azure DevOps resource app, and hands it to `4cloudguru/shared-workflows`' `publish-marketplace` action, which feeds `tfx` on stdin rather than argv. This replaces an unreviewed `tfx extension publish` on a maintainer's machine. |
| `publish-environment-approval` | enforced | That same `publish-marketplace` job declares `environment: marketplace`, so the publish stops at that environment's protection rules before it runs. `release.yml`'s `guard` job (**Verify tag is on main**) re-checks, before anything is built, that the environment still exists and still carries both a required-reviewer rule and a deployment-branch policy, and fails the release closed if it cannot verify that. `.github/workflows/weekly-security.yml`'s `verify-marketplace-environment-protection` job runs the same check every Monday as a detective canary, so a reviewer rule removed between releases surfaces without waiting for one. |
| `vsix-signature` | enforced | `release.yml`'s `sbom-and-sign` job (**Generate SBOM and sign VSIX**) installs cosign and runs `cosign sign-blob --yes` keyless over the packaged `.vsix`, emitting a `*.vsix.bundle`, then attaches GitHub build provenance with `actions/attest-build-provenance`. Both consumers re-verify before using the bytes: `draft-release`'s **Verify VSIX signature before release** step and `publish-marketplace`'s **Verify VSIX signature before publish** step each run `cosign verify-blob` with `--certificate-identity-regexp` pinned to this repository's own `release.yml` workflow identity, so a signature from any other workflow or issuer does not pass. |
| `workflow-hardening` | enforced | `.github/workflows/workflow-hardening.yml` calls `4cloudguru/shared-workflows`' `workflow-hardening.yml` reusable workflow on every pull request and push to `main`, pinned to a full commit SHA with its `script-ref` input set to that same SHA so the checker cannot drift from the workflow that calls it. It fails the build if any `uses:` is not pinned to a full commit SHA with a version comment, any npm install runs without `--ignore-scripts`, any job declares no `timeout-minutes`, or any job's egress policy is `audit` without a written reason on the step. There is no local copy of the checker to weaken, and its mutation self-test runs in that repository beside it. |
| `dependency-scan` | enforced | `.github/workflows/weekly-security.yml`'s `osv-scan` job (**OSV Vulnerability Scan**) runs OSV-Scanner `--recursive` over the whole tree every Monday and on demand, covering advisories the npm registry's own database does not carry — `unit-test.yml`'s per-task `npm audit --omit=dev --audit-level=high` is a different, narrower control. It calls `4cloudguru/shared-workflows`' `osv-scan` action rather than the scanner action directly: that action runs the scanner from a digest-pinned image and reports its real exit code, so a finding files or comments on a tracked issue while a scanner that failed to complete fails the job instead of passing for clean. Nothing it finds is currently suppressed: the repository carries no `osv-scanner.toml`. An advisory that has to be accepted gets a reasoned, date-bounded entry beside the lockfile it covers and a record under [Standing OSV residuals](#standing-osv-residuals). |
| `sbom-attestation` | enforced | `sbom-and-sign` generates a CycloneDX SBOM per task with `cyclonedx-npm --omit dev` (`sbom-packer-task-v1.cdx.json`, `sbom-packer-installer-v1.cdx.json`) and attests each one to the `.vsix` with `actions/attest-sbom`, so the SBOMs are bound to the artifact rather than merely published beside it. Both are uploaded with the cosign bundle and attached to the GitHub Release; `gh attestation verify` resolves them against this repository. |

<!-- controls:end -->

## Verifying a release artifact

Each GitHub Release attaches the `.vsix`, a cosign keyless signature bundle (`*.vsix.bundle`), and CycloneDX SBOMs. The `.vsix` is signed and attested by the release workflow using GitHub OIDC (no long-lived key), so you can verify it came from this repository's release pipeline and was not tampered with.

**cosign** (verifies the signature bundle):

```bash
cosign verify-blob "pipeline-tasks-packer-<version>.vsix" \
  --bundle "pipeline-tasks-packer-<version>.vsix.bundle" \
  --certificate-identity-regexp '^https://github\.com/sethbacon/azure-pipelines-packer/\.github/workflows/release\.yml@refs/tags/v.*$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

**GitHub attestations** (build provenance + SBOM, alternative to cosign):

```bash
gh attestation verify "pipeline-tasks-packer-<version>.vsix" --repo sethbacon/azure-pipelines-packer
```

Pinning `--certificate-identity-regexp` to the `release.yml` workflow ref and `--certificate-oidc-issuer` to the GitHub Actions issuer is what makes the signature meaningful — without those, a signature from any workflow or any issuer would pass.

## Preferred Languages

English preferred.

## Shared CI workflows

Part of this repository's CI is **defined in another repository** — [`4cloudguru/shared-workflows`](https://github.com/4cloudguru/shared-workflows) — and called from `.github/workflows/`. That is a real supply-chain relationship, and it is recorded here so an audit of this repository does not stop at this repository's own tree.

**What runs, and where it is pinned.** Each caller in `.github/workflows/` names the shared workflow on its `uses:` line, pinned to a full 40-hex commit SHA with a trailing comment naming the release that SHA is. The tag is a label; the SHA is what runs. An unlabelled SHA is rejected by the workflow-hardening gate, because a bare 40-hex ref cannot be reviewed or updated deliberately.

**Why the pins have to agree across repositories.** A shared definition drifts differently from a duplicated file: every repository looks like it is using "the shared one" while sitting on different commits, which is *harder* to see than divergent files, not easier. A signature in `security-orchestration` (`shared-workflow-pin-parity`) reports **disagreement** between callers of the same shared workflow — it reports disagreement rather than staleness, because a repository deliberately held back is a decision while N repositories disagreeing without anyone deciding is drift.

**What the shared repository is itself protected by.** Its `main` requires its own zizmor and actionlint checks with `enforce_admins` enabled, restricts which third-party actions may run to an explicit allowlist, issues a read-only default `GITHUB_TOKEN`, and runs the workflow-hardening gate against itself.

**What this repository still controls.** Triggers, concurrency, and the secrets it passes. Secrets are passed **by name** — never `secrets: inherit`, which would forward every secret in this repository to a workflow owned by someone else. Any `vars.*` a shared workflow reads resolve against **this** repository, so credentials and their installation scope do not move.
