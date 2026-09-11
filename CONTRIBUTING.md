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
| `fix`      | Bug fix                                      |
| `docs`     | Documentation only                           |
| `refactor` | Restructure without changing behavior        |
| `perf`     | Performance improvement                      |
| `test`     | Adding or fixing tests                       |
| `ci`       | CI/CD workflow changes                       |
| `chore`    | Housekeeping                                 |
| `deps`     | Dependency updates                           |
| `security` | Security fix or hardening                    |

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

   <!-- ci-jobs:begin .github/workflows/unit-test.yml -->
   - `Check Version Consistency` — validates the version fields in each `task.json`.
   - `Check Shared Module Provenance` — every module copied from
     `azure-pipelines-terraform` must carry its `@shared-module` provenance header
     and every outbound egress must be authorized (`scripts/check-shared-modules.js`,
     `scripts/check-egress-authorization.js`); four class gates run here as composite
     actions from `4cloudguru/shared-workflows`, called by full commit SHA rather than
     kept as copies here — `check-enforced-disciplines`, `check-proxy-parity` (every
     outbound HTTP call must honour the agent proxy configuration), `check-artifact-trust`
     and `auth-parity-matrix`; and the documented claims in these files must match what
     the tree and its workflows actually do, which is that repository's `check-docs-claims`
     action on the same pin.
   - `Build and Test Packer Task V1` — lint, compile and unit tests, on Ubuntu and Windows × Node 24.
   - `Build and Test Packer Installer V1` — same, for the installer task.
   - `Workflow Security` — actionlint checks the workflow schema and zizmor scans
     for workflow-security anti-patterns, both from `4cloudguru/shared-workflows`'
     `workflow-security.yml` rather than maintained here.
   - `Workflow Security Record` — the same zizmor scan again, in SARIF mode, so
     findings land in the Security tab where one can be dismissed with a reason
     that outlives the run. It is a reporter, not a gate: in that mode zizmor
     exits 0 whatever it finds, so `Workflow Security` above is what blocks.
   <!-- ci-jobs:end -->

   This list is checked against `.github/workflows/unit-test.yml` in both directions, so it
   cannot drift as jobs are added or renamed. The checker is not a script in this repository:
   it is `4cloudguru/shared-workflows`' `check-docs-claims` composite action, called by full
   commit SHA from the `Validate documented claims against the code` step of the
   `Check Shared Module Provenance` job. Keeping it as a composite (rather than a reusable
   workflow) is what lets that job keep its name, which is a required status context on `main`.
   To run it locally against a sibling checkout of that repository:

   ```bash
   node ../shared-workflows/.github/actions/check-docs-claims/check-docs-claims.js .
   ```

   The same job runs `4cloudguru/shared-workflows`' `check-shared-module-pins` action, at the
   same pin, as its `Shared-module pins in lockstep (#1108 class signature)` step — it fails the
   PR if the two tasks declare or resolve different versions of a shared `@4cloudguru` package.
   Locally:

   ```bash
   node ../shared-workflows/.github/actions/check-shared-module-pins/check-shared-module-pins.js .
   ```

   **`npm test` itself now requires a sibling `shared-workflows` checkout for the tasks that
   spawn a class gate, and that is deliberate.** The four class gates below are composite
   actions in the same repository, on the same pin, and three of them are spawned by task L0
   suites as well as run as CI steps: `PackerTaskV1/Tests/ProxyParityL0.ts` and
   `PackerTaskV1/Tests/CredentialFailClosedMatrixL0.ts`, and
   `PackerInstallerV1/Tests/ArtifactTrustL0.ts`, each run the gate and assert its whole
   enumerated set. On a runner the composite exports its own path and `Tests/shared-gate.ts`
   reads it; on your machine that resolver looks for `../shared-workflows` beside this
   checkout, and when it finds neither it fails the suite with the `git clone` line to run.
   It deliberately does not skip: these assertions are the only thing enumerating their defect
   class under `npm test`, so a could-not-run that read like a clean run would be worse than a
   red one. (Every task's mocha invocation also passes `--forbid-pending`, so even a future
   edit that tried to `this.skip()` around a missing gate would fail the run.)

   ```bash
   git clone https://github.com/4cloudguru/shared-workflows ../shared-workflows
   ```

   The same four run locally against this repository as:

   ```bash
   node ../shared-workflows/.github/actions/check-enforced-disciplines/check-enforced-disciplines.js .
   node ../shared-workflows/.github/actions/check-proxy-parity/check-proxy-parity.js .
   node ../shared-workflows/.github/actions/check-artifact-trust/check-artifact-trust.js .
   node ../shared-workflows/.github/actions/auth-parity-matrix/auth-parity-matrix.cjs .
   ```

   None of these actions has a self-test step here any more: every self-test runs in
   `4cloudguru/shared-workflows`' own CI, beside the scripts they exercise. That is a gain
   rather than a loss for one of them — this repository's deleted copy of the artifact-trust
   self-test was invoked by nothing at all: not a workflow, not `package.json`, not another
   script. It existed only to satisfy a replay signature that asks whether the file is there,
   never whether anything runs it. Its upstream successor actually runs.

   Your sibling checkout is at whatever ref you left it on, which is not necessarily the SHA CI
   pins. Every suite prints a `[shared-gate] <file> sha256:… <- <path> (via …)` line once per
   gate for exactly that reason: which bytes ran is answerable from the log, locally and in CI.

   `.github/workflows/pr-checks.yml` gates the PR as well, with the conventional
   title check, dependency review, the Release-PR Minor-bump backstop, and the
   two release-parsing guards: `release-please can read the merged commit` builds
   the single message this PR would squash into `main` and parses it, while
   `Breaking-change footers survive the squash` counts breaking-change
   declarations across the commits being concatenated.

## One breaking change per merged commit

This repository squash-merges with `squash_merge_commit_message=COMMIT_MESSAGES`,
so every commit body in a PR is concatenated into one merge commit — and
release-please keeps only the **first** `BREAKING CHANGE:` footer of a commit,
reading a `!` marker only from its header. A second declaration anywhere in the
PR is dropped in silence: no changelog entry, no upgrade note, and nothing
failing to say so. terraform-registry-backend v4.0.0 shipped two undocumented
breaking changes exactly this way.

Splitting the footers across separate commits does not help; the squash
concatenates them back. Either open one PR per breaking change, or combine them
into a single `BREAKING CHANGE:` footer and write each one up in the upgrade
guide. A footer and a `!` header in the same commit are one declaration, not
two, and are fine.

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
3. The per-task `Minor` bumps happen **automatically** on the Release PR. ADO agents cache tasks by
   `Major.Minor` and will not pick up new code until `Minor` increments, so every task whose `src/`
   or `task.json` changed, or whose PRODUCTION dependency surface changed (`package.json`'s
   `dependencies`, or a non-dev-only `package-lock.json` entry — #264), since the last release must
   have its `task.json` `Minor` incremented before the release is tagged. A `devDependencies`-only
   change is exempt: it never changes what `npm ci --omit=dev` bundles into the `.vsix`. Three
   layers enforce this, so in the normal case there is nothing to do by hand:

   - **Auto-bump (primary):** `.github/workflows/release-pr-minor-bumps.yml` triggers on the Release
     PR, runs `scripts/bump-minor-versions.js`, and pushes the bumps back onto it.
   - **Merge gate (backstop):** the `Release PR Minor Bumps` required check in
     `.github/workflows/pr-checks.yml` runs `scripts/check-minor-bumps.js` against the Release PR
     and fails it if any bump is still missing.
   - **Tag-time guard (final defense):** `release.yml`'s `Verify per-task Minor bumps` step re-runs
     the same check after the tag is pushed and fails the release if anything slipped through.

   **Manual fallback (only if the automation is broken):** run `node scripts/bump-minor-versions.js`
   from the repo root — or bump `Minor` by 1 (leave `Patch` at 0) by hand in the `task.json` of every
   task that needs it:

   - `Tasks/PackerTask/PackerTaskV1/task.json` — if PackerTaskV1 changed
   - `Tasks/PackerInstaller/PackerInstallerV1/task.json` — if PackerInstallerV1 changed

4. Merge the Release PR. release-please creates a draft GitHub Release and pushes the `vX.Y.Z` tag.
5. The `release.yml` workflow fires on the tag: verifies the tag is on `main` and matches the manifest version, runs full CI, builds the bundle, packages the `.vsix`, generates CycloneDX SBOMs + a cosign keyless signature, creates a draft GitHub Release, publishes to the VS Marketplace (behind the `marketplace` environment approval), then undrafts the release.

**Required secrets/variables:**

| Name                       | Type     | Purpose                                                                            |
| -------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `AZDO_PUBLISH_CLIENT_ID`   | Variable | Client ID of the Entra app whose federated credential publishes to the Marketplace |
| `AZDO_PUBLISH_TENANT_ID`   | Variable | Entra tenant ID for the publish login                                              |
| `RELEASE_DISPATCH_APP_ID`  | Variable | GitHub App client ID for release-please                                            |
| `RELEASE_DISPATCH_APP_KEY` | Secret   | GitHub App private key for release-please                                          |

The Marketplace publish uses **GitHub OIDC federated to Microsoft Entra** — there is no stored Marketplace PAT. The `release.yml` publish job runs under the `marketplace` environment with `id-token: write`, signs in via `azure/login` using `AZDO_PUBLISH_CLIENT_ID`/`AZDO_PUBLISH_TENANT_ID`, exchanges the OIDC token for a short-lived Entra access token, and passes it to `tfx extension publish`. The Entra app must have a federated credential whose subject is `repo:sethbacon/azure-pipelines-packer:environment:marketplace`.

> **That subject shape is this repository's, not a template.** GitHub gives repositories created after **2026-07-15** an immutable default OIDC subject embedding the owner and repository IDs — `repo:OWNER@<ownerId>/REPO@<repoId>:environment:marketplace`. This repository was created 2026-06-12 and keeps the plain form; the sibling azure-pipelines-release-docs was created 2026-08-11 and does not, so a credential copied from the line above would never have matched there. A **rename or transfer** after the cutoff moves a legacy repository onto the immutable form too, which would invalidate the credential above. Read the authoritative value rather than assuming: `gh api repos/OWNER/REPO/actions/oidc/customization/sub --jq .sub_claim_prefix`. A mismatch surfaces as `AADSTS700213: No matching federated identity record found`, which reads like a missing credential rather than a malformed one.

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
