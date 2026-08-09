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

## Security-relevant toggles

Three inputs deliberately weaken integrity/transport verification and default to the safe setting — enable them only when you understand the tradeoff:

- **`vsphereInsecureConnection`** (`PipelinePacker@1`) disables vCenter TLS certificate verification for the `vsphere-iso`/`vsphere-clone` builders. With it enabled, the vCenter password is transmitted over a connection an on-path attacker could intercept. Use only against trusted networks with self-signed certificates you control — never in production. The task emits a pipeline warning whenever this is enabled.
- **`requireChecksum`** (`PipelinePackerInstaller@1`, mirror/registry sources) defaults to `true`: installation fails closed if the mirror or registry does not provide a SHA256 checksum. Disabling it means the downloaded Packer binary's integrity rests entirely on the mirror/registry host and the transport (HTTPS is still enforced). This matters most for the **registry** source, which has no independent signature chain at all — only disable it there for a registry you trust to have verified the binary server-side. The **mirror** source is different: it still honors `requireGpgSignature` (below) over the mirror's `SHA256SUMS` file, so disabling `requireChecksum` alone on a mirror does not necessarily drop GPG verification — you would need to disable both toggles to lose all integrity verification on that source.
- **`requireGpgSignature`** (`PipelinePackerInstaller@1`, `hashicorp` and `mirror` sources) defaults to `true`: installation fails closed if the source does not publish a GPG signature (`SHA256SUMS.sig`) for the checksums file. Disabling it drops the GPG chain and relies on SHA256 alone (still checked, unless `requireChecksum` is also disabled) — intended for mirrors that do not serve `.sig` files. The fail-open branch triggers whenever the `.sig` file is genuinely absent (HTTP 404), not just on that specific case — a mirror/registry you don't fully trust could still have its checksums tampered with if you disable this. The `registry` source never has a GPG signature step; this toggle only affects `hashicorp` and `mirror`.

Two further inputs **widen** where the installer is allowed to fetch from, rather than weakening verification. Both default to empty, which is the safe (default-deny) setting:

- **`mirrorAllowedHosts`** (`PipelinePackerInstaller@1`, `mirror` source) and **`registryAllowedHosts`** (`PipelinePackerInstaller@1`, `registry` source) are comma- or newline-separated host allowlists for the binary download. A `*.` prefix matches subdomains only (e.g. `*.s3.amazonaws.com`), mirroring TLS wildcard-SAN semantics.
  - **Empty (default) — baseline default-deny.** The download host is refused if it *is*, or *resolves to*, a loopback, link-local/metadata (`169.254.0.0/16`, including `169.254.169.254`), carrier-grade-NAT (`100.64.0.0/10`), RFC1918/ULA private, or otherwise non-public address. Addresses are classified numerically, so alternative spellings of the same address — `127.1`, `2130706433`, `0x7f000001`, `[::ffff:127.0.0.1]` — are covered too. The check is applied to the initial download URL **and re-applied to every redirect hop**.
  - **Non-empty — an explicit operator pin.** Only the listed hosts are accepted, again on the initial URL and on every redirect hop. This is how you point the installer at a legitimately private or air-gapped mirror/storage host: the baseline private-address refusal no longer applies, because you have named the host deliberately.
  - **Residual risk.** The default-deny check resolves the hostname at check time and does not pin the resulting IP into the connection, so an attacker controlling a host's authoritative DNS could still rebind it to a private address between the check and the connection. It is defense-in-depth against a host that statically points at a private address, not a complete DNS-rebinding defense. Use `mirrorAllowedHosts`/`registryAllowedHosts` plus `requireChecksum`/`requireGpgSignature` when the mirror is not fully trusted.

## Release pipeline residual risk: Entra token visible via process arguments

The `publish-marketplace` job in `release.yml` mints a Microsoft Entra access token, scoped only to the Azure DevOps resource app, and passes it to `tfx extension publish --token "$ENTRA_TOKEN"` to authenticate the Marketplace publish. The token is registered with `::add-mask::` so it never appears in the GitHub Actions log, but it is still visible in `/proc/<pid>/cmdline` for the lifetime of the `tfx` process — GitHub Actions runners do not hide process arguments from other processes in the same job.

This was not fixed in code because `tfx-cli` 0.23.2 (the current pinned version) has no non-argv way to supply `--token`: no token-file option and no interactive stdin prompt. Two mitigations are in place instead:

- **Token lifetime is capped at 10 minutes** via a Microsoft Graph `tokenLifetimePolicy` assigned to the publishing service principal (`tsm-azdo-marketplace-publisher`, shared with the `azure-pipelines-terraform` extension's identical publish flow), down from the platform default of ~60-90 minutes. The `tfx extension publish` step completes in seconds, so this costs nothing operationally while sharply narrowing the window in which an exfiltrated token would still be valid.
- **The realistic exposure is narrow to begin with**: the only thing that could read `/proc/<pid>/cmdline` is other code already running in that same job, on a runner that is torn down immediately after. `npm ci --ignore-scripts` denies that other code a foothold in the first place, stopping a compromised transitive dependency (e.g. one accepted via a routine version bump) from ever executing in this job.

If a future `tfx-cli` release adds a non-argv token option, this job should switch to it and the token-lifetime policy can be relaxed back toward the platform default if useful.

## Standing OSV residuals

Each task's job in `unit-test.yml` runs `npm audit --omit=dev --audit-level=high`, so a **moderate or low** severity advisory in a production dependency does not fail the PR/push build. That gap is covered by `weekly-security.yml`'s `osv-scan` job, which runs `google/osv-scanner-action` with no severity filter and files (or comments on) a tracked GitHub issue labeled `security, dependencies`. The advisories that scan currently reports, and their disposition:

- **`uuid` 3.4.0 (GHSA-w5hq-g745-h8pq, moderate) — accepted, no safe fix.** Reached transitively through `azure-pipelines-tool-lib`, a production dependency of `PipelinePackerInstaller@1`. tool-lib's latest release (`2.0.12`) still pins `uuid ^3.3.2` — there is no fixed SDK to move to — and the flaw is confined to the `v3()`/`v5()`/`v6()` API methods **when passed an external output buffer**; tool-lib only calls `v4()` (random, no buffer) for tool-cache directory names, so the vulnerable path is never exercised. Forcing a fixed `uuid` (`11.1.1+`) via `overrides` would break tool-lib's v3-era `require('uuid/v4')` import style, so it is deliberately **not** overridden. Because it re-filed on the weekly tracking issue indefinitely with no actionable next step, it is suppressed via a scoped `osv-scanner.toml` (`[[IgnoredVulns]]`) in `Tasks/PackerInstaller/PackerInstallerV1/` — bounded with `ignoreUntil = 2027-02-05` rather than left open-ended, so the weekly scan resumes reporting it, forcing a fresh look, if tool-lib still hasn't shipped a `uuid`-free release by then.

`brace-expansion` (GHSA-rgw5-rvv9-x895) and `diff` (GHSA-73rr-hh4g-fpgx) are **not** residuals: both are remediated through `overrides` entries in each task's `package.json`, since the packages that depend on them pin ranges that exclude the fixed versions. Remove those overrides if the direct dependents ever declare fixed ranges of their own.

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
