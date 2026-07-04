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
