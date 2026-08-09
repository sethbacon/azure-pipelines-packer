# Contributing

This document describes the development process for the **Pipeline Tasks for Packer** extension (`sethbacon.pipeline-tasks-packer`).

## Attribution

This extension shares its architecture and tooling lineage with [azure-pipelines-terraform](https://github.com/sethbacon/azure-pipelines-terraform) (itself a fork of Microsoft DevLabs' `azure-pipelines-terraform`, MIT licensed). The original Microsoft copyright notice is retained in `LICENSE`. "Packer" is a trademark of HashiCorp; this is an independent community extension and the name is nominative fair use.

## Commit convention

All commits and PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
type: short description (50 chars max)
```

| Type       | When to use                                  |
| ---------- | -------------------------------------------- |
| `feat`     | New Packer command, provider, or auth scheme |
| `fix`      | Bug fix                                       |
| `docs`     | Documentation only                            |
| `refactor` | Restructure without changing behavior         |
| `perf`     | Performance improvement                       |
| `test`     | Adding or fixing tests                        |
| `ci`       | CI/CD workflow changes                        |
| `chore`    | Housekeeping                                  |
| `deps`     | Dependency updates                            |
| `security` | Security fix or hardening                     |

The PR title is what ends up in the changelog — write it as a clear, reader-facing statement.

## Prerequisites

- Node.js 24 (Active LTS — matches CI)
- npm 10+
- GitHub CLI (`gh`) — optional, useful for creating PRs

TypeScript (`tsc`) and `tfx-cli` are installed as dev dependencies; no global installation needed.

## Initial setup

```bash
git clone https://github.com/sethbacon/azure-pipelines-packer
cd azure-pipelines-packer

# Command task
cd Tasks/PackerTask/PackerTaskV1
npm install --include=dev

# Installer task
cd ../../../Tasks/PackerInstaller/PackerInstallerV1
npm install --include=dev
```

## Development workflow

1. Create a branch from `main`: `git checkout -b feat/my-feature`
2. Make your changes.
3. Run the local quality gate from the task directory you changed:

   ```bash
   npm run compile   # zero TypeScript errors required
   npm run lint      # eslint src/
   npm test          # all tests must pass
   ```

4. Open a PR to `main` with a conventional-commit title.
5. CI runs automatically. Every one of these jobs gates the PR — a change that
   trips any of them blocks the merge, so it is worth knowing they exist before
   you are surprised by one:

   <!-- ci-jobs:begin -->
   - `Check Version Consistency` — validates the version fields in each `task.json`.
   - `Check Shared Module Provenance` — every module copied from
     `azure-pipelines-terraform` must carry its `@shared-module` provenance header,
     and every outbound HTTP call must honour the agent proxy configuration
     (`scripts/check-shared-modules.js`, `scripts/check-egress-authorization.js`,
     `scripts/check-proxy-parity.js`, `scripts/check-docs-claims.js`).
   - `Build and Test Packer Task V1` — lint, compile and unit tests, on Ubuntu and Windows × Node 24.
   - `Build and Test Packer Installer V1` — same, for the installer task.
   - `Lint GitHub Actions` — actionlint.
   - `Scan Workflows (zizmor)` — workflow-security scan.
   <!-- ci-jobs:end -->

   This list is checked against `.github/workflows/unit-test.yml` by
   `scripts/check-docs-claims.js`, in both directions, so it cannot drift as jobs
   are added or renamed.

6. Squash-merge when CI passes and the PR is approved; the branch is deleted automatically.

## Testing

Test files come in pairs under each task's `Tests/` directory:

- `<Name>.ts` — mock-runner setup (inputs, env vars, exec answers), then `tr.run()`
- `<Name>L0.ts` — the task body run inside the mock child
- `Tests/L0.ts` — the mocha suite that registers each scenario

The command task uses a shared `RunCommand.ts` entry that drives the real provider dispatch path; auth handlers are exercised by dedicated `*AuthL0.ts` entries that assert the injected environment variables. The installer uses a shared `RunInstaller.ts` entry. When adding a command or provider, add a matching scenario pair and register it in `Tests/L0.ts`.

## Release process

Releases are automated via [release-please](https://github.com/googleapis/release-please):

1. Merge conventional-commit PRs to `main` — release-please accumulates them.
2. release-please opens a **Release PR** that bumps `azure-devops-extension.json` (`version`) and updates `CHANGELOG.md`.
3. Before merging the Release PR, manually bump the `Minor` field in `task.json` for every task whose code changed since the last release. ADO agents cache tasks by `Major.Minor` and will not pick up new code until `Minor` increments.

   - `Tasks/PackerTask/PackerTaskV1/task.json` — if PackerTaskV1 changed
   - `Tasks/PackerInstaller/PackerInstallerV1/task.json` — if PackerInstallerV1 changed

   Increment `Minor` by 1, leave `Patch` at 0.

4. Merge the Release PR. release-please creates a draft GitHub Release and pushes the `vX.Y.Z` tag.
5. The `release.yml` workflow fires on the tag: verifies the tag is on `main` and matches the manifest version, runs full CI, builds the bundle, packages the `.vsix`, generates CycloneDX SBOMs + a cosign keyless signature, creates a draft GitHub Release, publishes to the VS Marketplace (behind the `marketplace` environment approval), then undrafts the release.

**Required secrets/variables:**

| Name                       | Type     | Purpose                                                                            |
| -------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `AZDO_PUBLISH_CLIENT_ID`   | Variable | Client ID of the Entra app whose federated credential publishes to the Marketplace |
| `AZDO_PUBLISH_TENANT_ID`   | Variable | Entra tenant ID for the publish login                                              |
| `RELEASE_DISPATCH_APP_ID`  | Variable | GitHub App client ID for release-please                                            |
| `RELEASE_DISPATCH_APP_KEY` | Secret   | GitHub App private key for release-please                                          |

The Marketplace publish uses **GitHub OIDC federated to Microsoft Entra** — there is no stored Marketplace PAT. The `release.yml` publish job runs under the `marketplace` environment with `id-token: write`, signs in via `azure/login` using `AZDO_PUBLISH_CLIENT_ID`/`AZDO_PUBLISH_TENANT_ID`, exchanges the OIDC token for a short-lived Entra access token, and passes it to `tfx extension publish`. The Entra app must have a federated credential whose subject is `repo:sethbacon/azure-pipelines-packer:environment:marketplace`.

The `marketplace` environment (Settings → Environments) must have at least one required reviewer so every publish gets human approval.

## Personal dev publishing

To test a private build in your own Azure DevOps org:

1. Create `configs/self.json` (gitignored):

   ```json
   {
     "id": "pipeline-tasks-packer-dev",
     "name": "Pipeline Tasks for Packer (Dev)",
     "public": false,
     "publisher": "<your-publisher-id>",
     "version": "0.0.1"
   }
   ```

2. From the repo root:

   ```bash
   npm install --include=dev
   npm run build:release
   npm run package:self
   ```

3. Upload the generated `.vsix` to your publisher page as a **Private** extension, share it with your test org, and install it.

## Publisher information

- **Publisher ID:** `sethbacon`
- **Extension ID:** `pipeline-tasks-packer`
- **Extension name:** `Pipeline Tasks for Packer`
