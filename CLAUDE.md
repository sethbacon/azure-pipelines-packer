# Azure Pipelines Packer Extension - Project Instructions

## Overview

Azure DevOps extension providing HashiCorp Packer integration for Azure Pipelines. Modelled on the sibling `azure-pipelines-terraform` extension and sharing its architecture. Two tasks:

- **PackerInstallerV1** — install Packer from HashiCorp releases, a private `terraform-registry-backend` mirror, or a custom mirror, with GPG/SHA256 verification.
- **PackerTaskV1** — run any Packer CLI command with per-provider service-connection auth (Azure, AWS, GCP, OCI, vSphere, none).

**Repo:** `https://github.com/sethbacon/azure-pipelines-packer`
Local path: `C:\dev\gh\azure-pipelines-packer`

**VS Marketplace publisher:** `sethbacon`
**Extension ID:** `pipeline-tasks-packer`
**Extension name:** `Pipeline Tasks for Packer`

## Branch Strategy

- `main` — production-ready; tagged releases only; never force-pushed
- `feature/<description>`, `fix/<description>` — branched from `main`, deleted after merge

**Never commit directly to `main`.** Use PRs with conventional-commit titles (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`, `deps`, `security`, `perf`).

## Workflow Per Change

1. Branch from `main`.
2. Make changes.
3. Local quality gate: `npm run compile` and `npm test` in the affected task directory.
4. PR to `main` with a conventional-commit title; CI runs version check → build/test (Ubuntu + Windows) → actionlint.
5. Squash-merge when green.

Before tagging a release, bump the `Minor` field in `task.json` for every task whose code changed since the last release (ADO caches tasks by `Major.Minor`).

## Trademark

"Packer" is a HashiCorp trademark. The name "Pipeline Tasks for Packer" is nominative fair use describing compatibility. Never use "Packer" as a standalone product name. The `LICENSE` retains the upstream Microsoft copyright; the README notes the lineage.

## Repository Structure

```txt
azure-pipelines-packer/
├── Tasks/
│   ├── PackerInstaller/PackerInstallerV1/   # Installer task
│   └── PackerTask/PackerTaskV1/             # Command task (active development target)
├── configs/{dev,release,self}.json          # Manifest publisher overrides (self.json gitignored)
├── docs/initiatives/                        # Initiative plans
├── scripts/{check-versions,copy-build}.js   # CI version check + build copy
└── .github/workflows/unit-test.yml          # CI
```

## PackerInstallerV1

Source: `Tasks/PackerInstaller/PackerInstallerV1/src/`

| File | Role |
| --- | --- |
| `index.ts` | Entry point — installs Packer, prepends PATH, verifies |
| `packer-installer.ts` | Download strategies (hashicorp / registry / mirror), version resolution, SHA256 verify |
| `http-client.ts` | Proxy-aware fetch helpers with HTTPS enforcement |
| `gpg-verifier.ts` | Verifies SHA256SUMS.sig against HashiCorp's GPG key |
| `hashicorp-gpg-key.ts` | Embedded HashiCorp release-signing public key |

- Downloads `packer_{version}_{os}_{arch}.zip`. `latest` resolves via the HashiCorp checkpoint API (`v1/check/packer`) with a pinned fallback; registry source resolves via `/terraform/binaries/{name}/versions/latest`.
- The private registry path needs no backend changes — `terraform-registry-backend` already supports a `packer` binary-mirror tool type.
- Output variables: `packerLocation`, `packerDownloadedFrom`.

## PackerTaskV1

Source: `Tasks/PackerTask/PackerTaskV1/src/`. Same dispatch architecture as TerraformTaskV5:

`index.ts` → `ParentCommandHandler` (selects provider handler) → `BasePackerCommandHandler` (command implementations) → per-provider handlers inject auth env vars. Packer has no backend concept, so handlers implement only `handleProvider()`.

| File | Role |
| --- | --- |
| `index.ts` | Entry point — reads `provider`/`command`, registers cleanup signals |
| `parent-handler.ts` | Routes `provider` to a handler, runs command, clears tracked env in `finally` |
| `base-packer-command-handler.ts` | Abstract base with all command implementations |
| `packer.ts` | `PackerToolHandler` — locates `packer` binary, builds `ToolRunner` |
| `packer-commands.ts` | `PackerBaseCommandInitializer`, `PackerAuthorizationCommandInitializer` |
| `azure-packer-command-handler.ts` | AzureRM auth (WIF / MSI / Service Principal) → `PKR_VAR_arm_*` |
| `aws-packer-command-handler.ts` | AWS auth (static keys / WIF web-identity) → `AWS_*` env |
| `gcp-packer-command-handler.ts` | GCP auth (SA key / WIF) → `GOOGLE_APPLICATION_CREDENTIALS` |
| `oci-packer-command-handler.ts` | OCI auth → `PKR_VAR_oci_*` env + temp key file |
| `vsphere-packer-command-handler.ts` | vSphere auth → `PKR_VAR_vsphere_*` env |
| `none-packer-command-handler.ts` | No cloud creds (local/hypervisor builders) |
| `environment-variables.ts` | Tracked env var helper with `finally`-block cleanup |
| `secure-file-loader.ts`, `secure-temp.ts`, `id-token-generator.ts` | Secure file download, restrictive temp writes, OIDC token generation |

### Commands

`init`, `validate`, `build`, `fmt`, `inspect`, `console`, `fix`, `hcl2_upgrade`, `plugins`, `version`, `custom`. Commands that need cloud credentials (`build`, optionally `validate`/`console`/`custom`) call `handleProvider()`; the rest skip auth.

- `build` injects provider auth, supports `-only`/`-except`/`-parallel-builds`/`-on-error`/`-force`, and (when `manifestFile` is set) reads the Packer `manifest` post-processor output to set the `artifactId` and `manifestFilePath` output variables.
- `fmt` defaults to check mode (`-check -diff`); a formatting diff fails the task.
- Credentials are injected as environment variables (never CLI args) and cleared via `EnvironmentVariableHelper.clearTrackedVariables()` in the `finally` block after every command.

### Provider auth env conventions

`azurerm`, `oci`, and `vsphere` follow the `PKR_VAR_*` convention: the handler injects connection fields as Packer variables (`PKR_VAR_arm_*`, `PKR_VAR_oci_*`, `PKR_VAR_vsphere_*`); templates declare matching `variable` blocks and wire them to the builder source. This mirrors the Terraform extension's OCI `TF_VAR_` approach. AWS and GCP are the exception: their SDKs read well-known environment variables natively (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`), so no template wiring is required for those two.

> **Resolved (was: Spike S1).** `packer-plugin-azure` does **not** read `ARM_*` environment variables — auth fields (`client_id`/`client_secret`/`client_jwt`/`tenant_id`/`subscription_id`/`use_azure_cli_auth`) are HCL-only (confirmed against `builder/azure/common/client/config.go`). The Azure handler injects `PKR_VAR_arm_client_id`/`PKR_VAR_arm_subscription_id`/`PKR_VAR_arm_tenant_id` plus either `PKR_VAR_arm_client_jwt` (WIF) or `PKR_VAR_arm_client_secret` (Service Principal); the template's `azure-arm` source block must reference them (see `docs/yaml-examples.md`). For Managed Identity, the handler deliberately injects **only** `subscription_id` — `packer-plugin-azure` falls back to MSI automatically when `tenant_id`/`client_secret`/`client_jwt`/`client_cert_path`/the OIDC fields are all unset, so the template must not set those either. ADO's MSI-scheme service connection does not expose a distinct client ID for a specific user-assigned identity, so only the VM's default identity is supported. The historical `client_jwt` "x5t header" rejection of Azure DevOps-issued OIDC tokens (`hashicorp/packer-plugin-azure#451`) is fixed upstream; use a recent plugin version.

## Testing

Mock-runner L0 pattern (copied from the Terraform extension). Test pairs: `<Name>.ts` (mock-run setup) + `<Name>L0.ts` (the actual run), driven by `Tests/L0.ts` via `MockTestRunner`. Run with `npm test` in each task directory.

## Key Dependencies

| Package | Purpose |
| --- | --- |
| `azure-pipelines-task-lib` | ADO task SDK |
| `azure-pipelines-tool-lib` | Tool download/cache (installer) |
| `azure-pipelines-tasks-securefiles-common` | Secure file download (command task) |
| `openpgp` | GPG signature verification (installer) |
| `undici` | Proxy-aware fetch (installer) |
| `mocha` + `ts-node` | Test framework |

## Initiatives

- [Initiative 1: Pipeline Tasks for Packer extension](docs/initiatives/initiative-1-packer-extension.md)
