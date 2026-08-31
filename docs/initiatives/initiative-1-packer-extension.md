<!-- markdownlint-disable MD013 -->
# Initiative 1: Pipeline Tasks for Packer — New Azure DevOps Extension

## Implementation Status

**Status: SHIPPED** — implemented and published to the Visual Studio Marketplace (currently `v1.2.4`). This document is retained as the founding plan for the `azure-pipelines-packer` repository; treat it as historical context rather than a live spec.

## Goal

Ship a standalone Azure DevOps extension, modelled file-for-file on `azure-pipelines-terraform`, that provides:

1. **PackerInstallerV1** — install the HashiCorp Packer CLI from official releases, a private registry (`terraform-registry-backend`), or a custom mirror, with GPG/SHA256 verification.
2. **PackerTaskV1** — run every Packer CLI command (`init`, `validate`, `build`, `fmt`, `inspect`, `console`, `fix`, `hcl2_upgrade`, `plugins`, `version`, plus a `custom` escape hatch) with first-class service-connection auth for every cloud Packer officially supports: **Azure, AWS, Google Cloud, Oracle OCI**, plus **vSphere** (vCenter credentials) and a **none** provider for local/hypervisor builders (Docker, QEMU, VirtualBox, VMware, Hyper-V, Vagrant).

## Decisions (confirmed 2026-06-11)

| Decision | Choice |
| --- | --- |
| Cloud auth scope | Azure, AWS, GCP, OCI (parity with Terraform extension, incl. WIF) + vSphere endpoint + `none` for local builders |
| Extension coupling | **Standalone.** Own copies of the custom AWS/GCP/OCI endpoint types under new names (`PTP*`). No marketplace dependency on the Terraform extension. Azure uses the built-in AzureRM connection type. |
| Repo | `sethbacon/azure-pipelines-packer`, scaffolded from `azure-pipelines-terraform` (CI, release-please, security hardening, docs layout) |

## Identity & Naming

| Item | Value |
| --- | --- |
| Repo | `https://github.com/sethbacon/azure-pipelines-packer` |
| Extension ID | `pipeline-tasks-packer` |
| Extension name | `Pipeline Tasks for Packer` (nominative fair use — same trademark rationale as the Terraform extension; never "Packer" standalone) |
| Publisher | `sethbacon` |
| Tasks | `PipelinePackerInstaller` (`Tasks/PackerInstaller/PackerInstallerV1`), `PipelinePackerTask` (`Tasks/PackerTask/PackerTaskV1`) |
| Endpoint types | `PTPAWSServiceEndpoint` ("Pipeline AWS for Packer"), `PTPGoogleCloudServiceEndpoint` ("Pipeline GCP for Packer"), `PTPOCIServiceEndpoint` ("Pipeline OCI for Packer"), `PTPvSphereServiceEndpoint` ("Pipeline vSphere for Packer") |

Each task gets a **new GUID** (do not reuse Terraform task GUIDs). Execution targets `Node24` only (as shipped; unlike the Terraform tasks, there is no `Node20_1` fallback section — see issue #113 item 3).

## Repository Bootstrap (copy from azure-pipelines-terraform)

Carry over with renames:

- Root `package.json` build pipeline (tsc + webpack bundling, `build:release`, `package:release`, `package:self`), `configs/{dev,release,self}.json` publisher overrides.
- `.github/workflows/unit-test.yml` (version-consistency check + per-task build/test on Ubuntu + Windows + actionlint), `release-please.yml`, `release.yml` (tag-driven: full CI → `.vsix` → CycloneDX SBOM → cosign keyless → draft release → marketplace publish behind `marketplace` environment approval), `codeql.yml`, `dependabot.yml`.
- `.release-please-config.json` / manifest targeting `azure-devops-extension.json` version.
- CODEOWNERS, branch protection, squash-merge-only, conventional commits — apply the same hardening checklist from the Terraform repo's CLAUDE.md.
- Docs skeleton: `overview.md`, `README.md`, `docs/yaml-examples.md`, `docs/troubleshooting.md`, `CONTRIBUTING.md`, `SECURITY.md`, LICENSE/attribution notes.
- New repo CLAUDE.md derived from the Terraform one.

Required secrets/variables: ~~`TFX_PAT`~~ — superseded by GitHub OIDC → Entra federated credential, see CONTRIBUTING.md, `RELEASE_DISPATCH_APP_ID`, `RELEASE_DISPATCH_APP_KEY` (same roles as the Terraform repo).

Not carried over: the Terraform Plan results tab (a Packer build tab is a possible later initiative, not in scope here).

## Task 1: PackerInstallerV1

Clone of `TerraformInstallerV1` (reuse `gpg-verifier.ts`, `hashicorp-gpg-key.ts`, `http-client.ts` largely verbatim — Packer is signed with the same HashiCorp releases key).

### Inputs

| Input | Type | Default | Notes |
| --- | --- | --- | --- |
| `packerVersion` | string | `latest` | `latest` resolves via HashiCorp checkpoint API (`checkpoint-api.hashicorp.com/v1/check/packer`) with a pinned fallback; registry source resolves via `/terraform/binaries/{name}/versions/latest` |
| `downloadSource` | pickList | `hashicorp` | `hashicorp` \| `registry` \| `mirror` |
| `registryUrl` | string | — | visibleRule `downloadSource = registry`; HTTPS enforced |
| `registryMirrorName` | string | `packer` | The `{name}` segment in `/terraform/binaries/{name}/...`. The registry backend already supports `tool: packer` mirror configs (`terraform_mirror_sync.go: productNameForTool`) |
| `mirrorBaseUrl` | string | — | visibleRule `downloadSource = mirror`; must mirror the `releases.hashicorp.com/packer` path structure |
| `requireGpgSignature` | boolean | `true` | visibleRule `downloadSource != registry` (registry serves pre-verified binaries + SHA256 in API response) |
| `requireChecksum` | boolean | `false` | visibleRule `downloadSource = mirror` |

### Behavior

- Download `packer_{version}_{os}_{arch}.zip`; verify `SHA256SUMS` + `SHA256SUMS.sig` (HashiCorp GPG key) for `hashicorp`/`mirror` sources; verify API-provided SHA256 for `registry` source.
- OS/arch matrix identical to the Terraform installer: windows/linux/darwin × amd64/arm64/arm/386.
- Cache via `azure-pipelines-tool-lib`, prepend to PATH.
- Proxy support via `tasks.getHttpProxyConfiguration()`.
- Output variables: `packerLocation`, `packerDownloadedFrom` (`hashicorp` \| `registry:<url>` \| `mirror:<url>`).

## Task 2: PackerTaskV1

Same architecture as `TerraformTaskV5`: `index.ts` → `ParentCommandHandler` (provider dispatch) → `BasePackerCommandHandler` (command implementations) → per-provider handlers for auth env injection, with `EnvironmentVariableHelper` tracking and `finally`-block credential cleanup.

### Core inputs

| Input | Type | Notes |
| --- | --- | --- |
| `command` | pickList | `init`, `validate`, `build`, `fmt`, `inspect`, `console`, `fix`, `hcl2_upgrade`, `plugins`, `version`, `custom` |
| `workingDirectory` | filePath | Template directory (or single file via `templateFile`) |
| `templateFile` | string | Optional explicit template/`.pkr.hcl` file argument |
| `provider` | pickList | `azurerm` \| `aws` \| `gcp` \| `oci` \| `vsphere` \| `none` — selects the auth handler; commands that never need auth (`fmt`, `inspect`, `version`, `hcl2_upgrade`, `fix`, `plugins`) skip `handleProvider()` |
| `*ServiceConnection` | connectedService | One per provider via `visibleRule` (AzureRM built-in; `PTP*` custom types; vSphere) |
| `variableFiles` | multiLine | `-var-file` arguments |
| `packerVariables` | multiLine | `key=value` lines → `-var` arguments |
| `secureVarsFile` | secureFile | Downloaded from ADO Secure Files (reuse `secure-file-loader.ts`) |
| `commandOptions` | string | Free-form extra CLI args |
| `environmentVariables` | multiLine | `key=value` passthrough (e.g. builder-specific settings for local builders) |

### Command implementations

| Command | Auth | Flags surfaced as inputs | Notes |
| --- | --- | --- | --- |
| `init` | none | `upgradePlugins` → `-upgrade` | Optional `githubToken` secret input → `PACKER_GITHUB_API_TOKEN` to avoid GitHub rate limits on plugin download |
| `validate` | optional | `syntaxOnly` → `-syntax-only`, `-only`/`-except` via `commandOptions` | Var files supported |
| `build` | required (or `none`) | `onlyBuilds` → `-only`, `exceptBuilds` → `-except`, `parallelBuilds` → `-parallel-builds`, `onError` → `-on-error`, `force` → `-force`, `colorOutput` | Always runs with `-machine-readable` capture OFF by default; see "Build outputs" below |
| `fmt` | none | `fmtWrite` (default check-only `-check -diff`), `-recursive` | Non-zero exit on diff in check mode → task failure, mirroring `terraform fmt` handling |
| `inspect` | none | `-machine-readable` option | |
| `console` | optional | `consoleExpression` input piped via stdin | Non-interactive: `echo "<expr>" \| packer console` |
| `fix` | none | `fixOutputFile`, `-validate` flag | Legacy JSON templates; stdout redirected to output file |
| `hcl2_upgrade` | none | `hclOutputFile` → `-output-file`, `withAnnotations` → `-with-annotations` | |
| `plugins` | none | `pluginsSubCommand` pickList: `install` \| `installed` \| `remove` \| `required`; `pluginSource`, `pluginVersion` | |
| `version` | none | — | |
| `custom` | optional | `customCommand` | Escape hatch, mirrors TerraformTaskV5 |

### Build outputs

- Parse `packer build` output (machine-readable artifact lines or the `manifest` post-processor JSON if `manifestFile` input set) and set output variables: `artifactId` (last build's artifact ID — e.g. AMI ID / managed image ID), `manifestFilePath`.
- This enables chaining image IDs into a downstream Terraform task.

### Provider auth handlers

| Handler | Connection | Env injection | WIF/OIDC |
| --- | --- | --- | --- |
| `azurerm` | Built-in AzureRM | ~~`ARM_SUBSCRIPTION_ID`, `ARM_TENANT_ID`, `ARM_CLIENT_ID`/`ARM_CLIENT_SECRET`~~ — **superseded, see Spike S1 resolution below**: `PKR_VAR_arm_subscription_id`, `PKR_VAR_arm_tenant_id`, `PKR_VAR_arm_client_id`/`PKR_VAR_arm_client_jwt`/`PKR_VAR_arm_client_secret` | WIF via ADO OIDC ID token passed as `client_jwt`; reuses `id-token-generator.ts` |
| `aws` | `PTPAWSServiceEndpoint` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | SDK-native WIF: write ID token to file, set `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` (same mechanism as Terraform extension initiative 3) |
| `gcp` | `PTPGoogleCloudServiceEndpoint` | `GOOGLE_APPLICATION_CREDENTIALS` → temp SA-key JSON | WIF: write external_account credential-config JSON referencing the ADO ID token file (same as Terraform extension) |
| `oci` | `PTPOCIServiceEndpoint` | Write temp OCI SDK config + key file; expose path as `PKR_VAR_oci_config_file` (documented template convention: `access_cfg_file = var.oci_config_file`) | Stretch — not in v1 (mirrors that OCI WIF landed late in the Terraform extension) |
| `vsphere` | `PTPvSphereServiceEndpoint` (server URL + username + password, basic auth) | `PKR_VAR_vsphere_server`, `PKR_VAR_vsphere_user`, `PKR_VAR_vsphere_password` — documented convention: templates declare these three variables and wire them to `vcenter_server`/`username`/`password` | n/a |
| `none` | — | Only `environmentVariables` passthrough | For Docker, QEMU, VirtualBox, VMware, Hyper-V, Vagrant builders |

All injected credentials are tracked and cleared in the `finally` block (same `EnvironmentVariableHelper` contract as TerraformTaskV5).

## Extension manifest

`azure-devops-extension.json`: id `pipeline-tasks-packer`, scopes `vso.build`, categories Azure Pipelines, tags (Packer, Azure, AWS, GCP, OCI, vSphere, Image, DevOps), two task contributions, four service-endpoint-type contributions (`PTPAWS`/`PTPGoogleCloud`/`PTPOCI` cloned from the `PTT*` definitions with renamed `properties.name`; new `PTPvSphere` with visible server URL + basic username/password scheme), `overview.md` + screenshots.

## Testing

Mock-runner L0 pattern copied from TerraformTaskV5: test pairs (`<Name>.ts` + `<Name>L0.ts`) organized by command × provider — `BuildTests/`, `InitTests/`, `ValidateTests/`, `FmtTests/`, `PluginsTests/`, `InspectTests/`, `ConsoleTests/`, `FixTests/`, `Hcl2UpgradeTests/`, `CustomTests/`, plus auth-handler tests per provider (env injection + cleanup). Installer tests mirror the Terraform installer's (source strategies, GPG verify, version resolution, HTTPS enforcement).

## Verification Spikes (resolve during Phase 2, before locking task.json)

- **[RESOLVED] S1 — Azure plugin auth surface:** `packer-plugin-azure` does **not** read `ARM_*` env vars at all (confirmed against upstream `builder/azure/common/client/config.go` — only `ARM_METADATA_URL` is env-backed; every credential field is HCL-only). The Azure handler was shipped with `ARM_*` injection anyway (mirroring the Terraform extension's own env-var convention) and it silently failed to authenticate until fixed to use the `PKR_VAR_arm_*` convention below. See `CLAUDE.md`'s "Provider auth env conventions" section and `docs/yaml-examples.md` for the corrected design and a worked template.
- **S2 — checkpoint API:** confirm `v1/check/packer` response shape matches the Terraform checkpoint handling.
- **S3 — fmt/validate exit codes:** confirm `packer fmt -check` and `validate` non-zero exit codes for correct pass/fail mapping.
- **S4 — machine-readable artifact parsing:** confirm `,artifact,0,id` line format across builders for the `artifactId` output variable.
- **S5 — OCI config file convention:** confirm `oracle-oci` builder accepts a non-default config path via template variable.

## Phases

```txt
0. Repo bootstrap: scaffold, CI, manifest, publisher, branch protection
   → verify: unit-test.yml green on empty-task skeletons; `npm run package:self` produces installable .vsix
1. PackerInstallerV1 (hashicorp + registry + mirror, GPG/SHA256, latest resolution)
   → verify: L0 tests for all 3 sources × version paths; manual install on Windows + Linux agents
2. PackerTaskV1 core: init / validate / build with azurerm + aws + none handlers (incl. spikes S1–S4)
   → verify: L0 suites; live build of a trivial Azure + AWS image from a test pipeline
3. Remaining commands: fmt, inspect, console, fix, hcl2_upgrade, plugins, version, custom
   → verify: L0 suite per command
4. GCP, OCI, vSphere handlers + WIF for AWS/Azure/GCP; build output variables (artifactId, manifestFilePath)
   → verify: L0 auth tests; WIF live test against each cloud (reuse Terraform repo's WIF setup docs)
5. Docs (overview, yaml-examples, troubleshooting, WIF setup), screenshots, marketplace publish v1.0.0
   → verify: release.yml end-to-end with marketplace environment approval
```
