# Azure Pipelines Packer Extension - Project Instructions

## Overview

Azure DevOps extension providing HashiCorp Packer integration for Azure Pipelines. Modelled on the sibling `azure-pipelines-terraform` extension and sharing its architecture. Two tasks:

- **PackerInstallerV1** — install Packer from HashiCorp releases, a private `terraform-registry-backend` mirror, or a custom mirror, with GPG/SHA256 verification.
- **PackerTaskV1** — run any Packer CLI command with per-provider service-connection auth (Azure, AWS, GCP, OCI, vSphere, none).

**Repo:** `https://github.com/sethbacon/azure-pipelines-packer`

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
4. PR to `main` with a conventional-commit title; CI runs version check → shared-module provenance check → build/test (Ubuntu + Windows) → actionlint → zizmor, plus PR-title/dependency-review checks and CodeQL.
5. Squash-merge when green.

Every task whose `src/` or `task.json` changed since the last release must have its `task.json`
`Minor` bumped — ADO caches tasks by `Major.Minor`, so an un-bumped fix reaches the Marketplace but
never a running agent. This is **no longer a manual step**: it is applied and enforced in three
layers (#192), matching the sibling `azure-pipelines-terraform` repo —

1. `release-pr-minor-bumps.yml` applies the bumps automatically on the release-please Release PR
   (`scripts/bump-minor-versions.js`, idempotent — never hand-edit a `Minor`, and never bump an
   already-bumped task again),
2. the `Release PR Minor Bumps` merge gate in `pr-checks.yml` fails a Release PR that is still
   missing them, and
3. release.yml's tag-time `Verify per-task Minor bumps` guard (`scripts/check-minor-bumps.js`) is
   the last line, before anything is built or signed.

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
├── scripts/
│   ├── check-versions.js                    # CI: validates version fields exist + are well-formed
│   ├── check-minor-bumps.js                 # CI: fails if a changed task's Minor was NOT bumped
│   ├── bump-minor-versions.js               # CI: applies those bumps on the Release PR (idempotent)
│   ├── check-enforced-disciplines.js        # CI: signature for documented-but-unenforced rules
│   │                                         #     (entry point tested + measured, every declared
│   │                                         #      execution handler exercised, Minor-bump layers,
│   │                                         #      Marketplace publish retry + token off argv)
│   ├── publish-marketplace.js               # Release: tfx publish, token on stdin + bounded retry
│   ├── check-shared-modules.js              # CI: enforces the @shared-module provenance header
│   │                                         #     on files copied from azure-pipelines-terraform
│   ├── test-*.js                            # CI self-tests for each of the guards above
│   └── copy-build.js                        # Build: copies compiled tasks + assets into build/
└── .github/workflows/
    ├── unit-test.yml         # CI: version/provenance/discipline checks, build/test (Node 24 + a
    │                         #     Node 20 load-only smoke per task), actionlint, zizmor
    ├── pr-checks.yml         # PR title convention, dependency review, Release PR Minor Bumps gate
    ├── release.yml           # Tag-triggered: build, sign, attest, publish, draft/undraft release
    ├── release-please.yml    # main-triggered: version-bump PR automation
    ├── release-pr-minor-bumps.yml # Release-PR-triggered: auto-applies per-task Minor bumps
    ├── codeql.yml            # CodeQL analysis (PR, push to main, weekly)
    └── weekly-security.yml   # OSV scan, GPG key freshness, stale-Dependabot check
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
| `pem-normalizer.ts` | Normalizes and validates a PEM-encoded private key (GCP service-account, OCI API key) regardless of its on-disk line-wrapping |

### Commands

`init`, `validate`, `build`, `fmt`, `inspect`, `console`, `fix`, `hcl2_upgrade`, `plugins`, `version`, `custom`. Commands that need cloud credentials (`build`, optionally `validate`/`console`/`custom`) call `handleProvider()`; the rest skip auth.

- `build` injects provider auth, supports `-only`/`-except`/`-parallel-builds`/`-on-error`/`-force`, and (when `manifestFile` is set) reads the Packer `manifest` post-processor output to set the `artifactId` and `manifestFilePath` output variables.
- `fix` only writes a file and sets the `fixFilePath` output variable when `fixOutputFile` is explicitly set; otherwise the fixed template goes to stdout only.
- `fmt` defaults to check mode (`-check -diff`); a formatting diff fails the task.
- Credentials are injected as environment variables (never CLI args) and cleared via `EnvironmentVariableHelper.clearTrackedVariables()` in the `finally` block after every command.

### Provider auth env conventions

`azurerm`, `oci`, and `vsphere` follow the `PKR_VAR_*` convention: the handler injects connection fields as Packer variables (`PKR_VAR_arm_*`, `PKR_VAR_oci_*`, `PKR_VAR_vsphere_*`); templates declare matching `variable` blocks and wire them to the builder source. This mirrors the Terraform extension's OCI `TF_VAR_` approach. AWS and GCP are the exception: their SDKs read well-known environment variables natively (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`), so no template wiring is required for those two.

> **Resolved (was: Spike S1).** `packer-plugin-azure` does **not** read `ARM_*` environment variables — auth fields (`client_id`/`client_secret`/`client_jwt`/`tenant_id`/`subscription_id`/`use_azure_cli_auth`) are HCL-only (confirmed against `builder/azure/common/client/config.go`). The Azure handler injects `PKR_VAR_arm_client_id`/`PKR_VAR_arm_subscription_id`/`PKR_VAR_arm_tenant_id` plus either `PKR_VAR_arm_client_jwt` (WIF) or `PKR_VAR_arm_client_secret` (Service Principal); the template's `azure-arm` source block must reference them (see `docs/yaml-examples.md`). For Managed Identity, the handler deliberately injects **only** `subscription_id` — `packer-plugin-azure` falls back to MSI automatically when `tenant_id`/`client_secret`/`client_jwt`/`client_cert_path`/the OIDC fields are all unset, so the template must not set those either. ADO's MSI-scheme service connection does not expose a distinct client ID for a specific user-assigned identity, so only the VM's default identity is supported. The historical `client_jwt` "x5t header" rejection of Azure DevOps-issued OIDC tokens (`hashicorp/packer-plugin-azure#451`) is fixed upstream; use a recent plugin version.

## Node 20 fallback handler — load-only, not a behavioural gate

Both `task.json` files declare a `Node20_1` execution handler alongside `Node24`, so older
on-prem/air-gapped agents without the Node 24 runner can still invoke these tasks. Each task's CI leg
has a "Set up Node 20 for Node20_1 handler smoke test" step that runs the already-compiled
`src/index.js` under Node 20 with no ADO inputs supplied (#208). That proves the compiled module graph
parses and loads under Node 20 — a Node-20-incompatible dependency or syntax construct fails it — but
the task's own try/catch converts the resulting "input required" error into a caught failure before
any real command, credential or verification logic runs. **Node 24 is the sole behavioural gate**;
Node 20 is deliberately load-only, the same scope decision the sibling `azure-pipelines-terraform`
repo made: running the full suite twice per task would roughly double CI time, and Node 20 is already
EOL — the fallback exists for agents that have not upgraded their runner, not as a second
fully-verified execution path.

## Testing

Mock-runner L0 pattern (copied from the Terraform extension). Test pairs: `<Name>.ts` (mock-run setup) + `<Name>L0.ts` (the actual run), driven by `Tests/L0.ts` via `MockTestRunner`. Run with `npm test` in each task directory.

The mock-runner entry must be the task's **real** `src/index.ts`, never a re-implementation of it:
`PackerTaskV1/Tests/RunCommand.ts` now just `import '../src/index'`, and the installer's
`EntryPointInstallSuccess`/`EntryPointVerifyFail` scenarios point `TaskMockRunner` straight at
`../src/index.js`. `src/index.js` is included in each task's coverage metric (#189), and
`scripts/check-enforced-disciplines.js` fails CI if either property regresses.

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
- [Initiative 2: HCP Packer registry support](docs/initiatives/initiative-2-hcp-packer-registry-support.md)
