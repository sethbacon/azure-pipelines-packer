# Plan: Add HCP Packer Registry Support to PipelinePacker@1

## TL;DR
Add optional, cross-cutting "HCP Packer registry" auth to `azure-pipelines-packer`'s
`PackerTaskV1` — independent of the existing `provider` picklist (azurerm/aws/gcp/oci/vsphere/none),
since HCP Packer metadata push happens *alongside* whichever cloud builds the image. Support both
static Client ID/Secret and Workload Identity Federation (OIDC), matching the AWS/GCP/Azure WIF
pattern already in this repo. Bucket name/labels/description stay template-authored (`hcp_packer_registry`
HCL block) — the task only injects auth. Also parse `packer build`'s stdout for the HCP Packer
fingerprint/bucket/version it publishes, exposing them as new output variables.

All mechanics below (credential-file JSON schema, exact log-line formats, minimum Packer version)
are confirmed directly against `hashicorp/hcp-sdk-go` and `hashicorp/packer` source — not just docs —
so implementation risk is low; this is not a from-scratch design spike.

## User decisions (confirmed via questions)
- **Auth scope:** Static Client ID/Secret **and** Workload Identity Federation (OIDC).
- **Bucket metadata:** Template-only (`hcp_packer_registry` block) — no `hcpPackerBucketName` input.
- **Build output parsing:** Include in v1 (new output variables).
- **`-skip-enforcement` flag:** Excluded from v1.

## Adversarial review (2026-07-08)
This plan was independently stress-tested by 4 parallel adversarial subagent passes — security/secrets
handling, external technical fact-checking, codebase consistency, and scope/product — each reading actual
source (this repo + `hashicorp/packer` + `hashicorp/hcp-sdk-go`), not just this document. Full findings are
saved in repo memory for re-derivation if this plan changes again:
`/memories/repo/azure-pipelines-packer-hcp-registry-review.md` (security),
`/memories/repo/hcp-packer-registry-verified-facts.md` (fact-check),
`/memories/repo/azure-pipelines-packer-hcp-codebase-review.md` (codebase consistency). All findings are
already folded into the sections below; this note is a pointer, not a duplicate.

Highest-impact corrections made: (1) WIF now uses an env-var token source instead of a temp JWT file — one
fewer secret-bearing file on disk; (2) the WIF resource name is a single raw input, not 3 decomposed fields;
(3) `HCP_PROJECT_ID` must always be set when known (previously an open "further consideration" — it's
actually a real silent-wrong-project risk if omitted); (4) `inspect` was missing from command coverage and
has been added; (5) `MANAGED_ENV_PATTERNS` needed an `/^HCP_/` entry, previously unmentioned; (6) the
GCP-outer-field-mirroring description was factually wrong (that field is dead code, never read by any
handler) and now correctly cites Azure's `subscriptionid` precedent instead.

**Follow-up review (2026-07-09):** a second pass corrected six more items, now folded into the sections
below — a bounded line-scan instead of full-log stdout capture (step 7/8), the stale collision-warning
message (step 5), the WIF-connection auth-scheme decision (step 1 / Decisions), valid `visibleRule` syntax
(step 2), a fact nit about `getEndpointDataParameter` usage (step 1), and same-PR `Minor`-bump discipline
(step 15).

## Architecture decision
HCP Packer registry is **not** a new `provider` enum value. It's an orthogonal opt-in feature
(new input group, gated on a service-connection input being set), auth-injected alongside
`handleProvider()` for whichever builder provider is in use. Implemented once in
`BasePackerCommandHandler` (shared), not duplicated per provider subclass.

## Key technical facts (source-verified, incl. 4-pass adversarial re-verification)

- **Env vars (static mode):** `HCP_CLIENT_ID`, `HCP_CLIENT_SECRET` (service-principal key), plus
  `HCP_PROJECT_ID` (see below — always set when known, not merely "optional"). Works on Packer ≥1.7.6.
- **WIF mode:** Packer supports `HCP_CRED_FILE` (path to a JSON credential file) since **Packer v1.14.2**
  (hashicorp/packer#13435, merged 2025-08-11) — field-confirmed via hashicorp/packer#13454 (v1.14.1 fails
  with "requires both HCP_CLIENT_ID and HCP_CLIENT_SECRET"; a reporter confirmed v1.14.2 fixes it). No
  later patch reintroduced a regression here (CHANGELOG scanned through v1.15.4).
- **Credential file schema, revised — use an env-var token source, not a temp file** (from
  `hashicorp/hcp-sdk-go`, `auth/cred_file.go` + `auth/workload/*.go`):
  ```
  CredentialFile { scheme: "workload", workload: IdentityProviderConfig }   // omit project_id entirely — see below
  IdentityProviderConfig { provider_resource_name, env: { var: "<ENV_VAR_NAME>" } }  // EnvironmentVariableCredentialSource
  ```
  `IdentityProviderConfig.Validate()` requires **exactly one** of `file`/`token`/`env`/`url`/`aws` set (0 or
  >1 both error) — `hcp-credential-file.ts` must only ever populate `env`. `CredentialFile.Validate()` also
  rejects setting both `oauth` and `workload` — mirror that guard too.
  **Change from the original design:** instead of writing the ADO OIDC JWT to a temp file and referencing it
  via `workload.file.path`, mask it with `tasks.setSecret()` and set it directly as a process env var (e.g.
  `HCP_WORKLOAD_TOKEN`) via the existing `EnvironmentVariableHelper`, then reference it via `workload.env.var`.
  Env vars are already inherited by the spawned `packer` process (`toolrunner.js` uses `options.env ||
  process.env`, and no existing handler overrides `env`), so this needs **no new token-handling code** and
  writes **one fewer secret-bearing temp file** than the original file-based design — only the non-secret
  credential-file JSON itself still needs a temp file (via the existing `writeTrackedSecretFile` helper, for
  its restrictive permissions as defense-in-depth, even though its content holds no secret value).
- **`provider_resource_name` is a single raw string input, not 3 decomposed fields.** Format:
  `iam/project/<PROJECT_ID>/service-principal/<SP_NAME>/workload-identity-provider/<PROVIDER_NAME>`. HCP's
  own `hcp_iam_workload_identity_provider` Terraform resource already exposes this exact string as a
  computed `resource_name` output — decomposing it into 3 task inputs would force users to re-parse a value
  their own IaC already produces as one string, and is less future-proof than a passthrough if HashiCorp ever
  changes the internal format. Mirrors this repo's AWS precedent (raw `awsRoleArn` string), not GCP's 4-field
  decomposition. New input: `hcpWorkloadProviderResourceName` (raw string; hard-required in code via
  `tasks.getInput(name, true)!` when WIF mode is selected, even though `required: false` at the task.json
  schema level — matches the existing `awsRoleArn` convention). Validate with a shape-only regex (reject
  quotes/control characters/newlines; loosely enforce the `iam/project/.../service-principal/.../
  workload-identity-provider/...` shape) before it's embedded in JSON — fail closed with a clear task error
  rather than letting a malformed value fail cryptically later inside Packer.
- **`HCP_PROJECT_ID` — always set it, in both auth modes, whenever `hcpProjectId` is supplied; this is not
  optional "belt-and-suspenders."** Two independent traces (Packer's `internal/hcp/api/client.go`
  `loadProjectID()`, plus hcp-sdk-go's own env resolution) confirm Packer reads `HCP_PROJECT_ID` directly via
  `os.Getenv`, completely bypassing the credential file's `project_id` JSON field (dead for Packer's
  purposes — omit it from the generated credential file entirely rather than ship a misleading no-op field).
  If `HCP_PROJECT_ID` is unset and the service principal can see more than one HCP project, Packer silently
  picks **the oldest project** with only a log warning, not a failure — a real silent-wrong-target risk. If
  `hcpProjectId` is left blank, emit `tasks.warning(...)` explaining this fallback. `HCP_ORGANIZATION_ID` is
  optional in practice (auto-resolves via a List Organizations call that requires exactly one org, true for
  virtually all real setups) — no org-ID input needed.
- **Critical WIF gotcha:** Azure DevOps' OIDC token generator (`generateIdToken()`, now
  `@4cloudguru/pipeline-task-ado`) never sets a
  custom `aud` — every ADO token carries the fixed audience `api://AzureADTokenV2` (already documented
  in `docs/wif-setup.md`'s "Security note" for AWS/GCP/Azure). HCP's *default* expected audience for a
  workload identity provider is the provider's own resource name, so creating the HCP workload identity
  provider **must** pass `--allowed-audience=api://AzureADTokenV2` or every token exchange fails on
  audience mismatch. Must be called out explicitly in the new WIF-setup doc section.
- **`hcp_packer_registry` HCL block**: works on Packer ≥1.7.5 (confirmed byte-identical
  `hcl2template/types.build.go` across the v1.7.5/1.7.6/1.7.7 tags) — HashiCorp's own docs commonly cite
  1.7.7, which is safe but not the minimal floor; document as "≥1.7.5, commonly documented as 1.7.7+." No
  separate plugin needed.
- **Build-output log lines**, confirmed byte-identical between `main` and the `v1.14.2` tag (stable, safe to
  hardcode in a parsing regex):
  - `internal/hcp/registry/{json,hcl}.go`: `ui.Say(fmt.Sprintf("Tracking build on HCP Packer with fingerprint %q", bucket.Version.Fingerprint))`
    → literal: `Tracking build on HCP Packer with fingerprint "<fingerprint>"`
  - `internal/hcp/registry/artifact.go`, `registryArtifact.String()`: `fmt.Sprintf("Published metadata to HCP Packer registry packer/%s/versions/%s", a.BucketName, a.VersionID)`
    → literal: `Published metadata to HCP Packer registry packer/<bucket>/versions/<versionID>` (note: `packer/` is a hardcoded literal, not a variable segment)
  - **ANSI-color confirmed a non-issue:** traced the `Ui` object graph — `command/build.go` passes the
    plain, never-`ColoredUi`-wrapped command-level `c.Ui` into the HCP registry code; per-builder `ColoredUi`
    wrapping only applies to a local per-builder `ui` variable inside the parallel-build loop. These two
    lines are never ANSI-wrapped, regardless of the `disableColor`/`-color=false` input — no ANSI-stripping
    needed before regex-matching.
- **Command coverage correction: add `inspect`.** `command/inspect.go`'s `Initialize()` call has **no
  `SkipDatasourcesExecution` opt-out at all** (unlike `validate`, which at least has an off-by-default
  `-evaluate-datasources` flag) — a template using the read-side `hcp-packer-version`/`hcp-packer-image`/
  `hcp-packer-artifact` datasources needs HCP auth during `packer inspect` today, and this task currently has
  no way to provide it. `validate` itself doesn't strictly need HCP auth as this task is implemented (no
  `-evaluate-datasources` flag is exposed, and the write-side bucket-push path is `build`-only regardless) —
  keep it anyway, it's a harmless no-op and keeps the feature forward-compatible. (Aside: this same
  "`inspect` skips provider auth" gap already exists today for azurerm/aws/gcp too — pre-existing, not
  HCP-specific, worth a one-line doc callout rather than a fix in this change.)

## Steps

### Phase 1 — Service connection + auth injection (core)
1. Add a new `PTPHCPServiceEndpoint` ("Pipeline HCP for Packer") service-endpoint-type contribution
   to `azure-devops-extension.json`, modeled on the existing **`PTPAWSServiceEndpoint`** entry (which has
   the same static-vs-WIF split): a single basic auth scheme with `username` = "Client ID" and `password`
   = "Client Secret" (password `isConfidential: true`), a fixed hidden `url` (HCP portal), and an outer
   optional `projectId` inputDescriptor. **WIF ergonomics (resolved): both `username` and `password` are
   `isRequired: false`, with helpText stating they are ignored under Workload Identity Federation — mirror
   AWS exactly, so a WIF connection can be created with those fields left blank. Do NOT add a second
   `endpoint-auth-scheme-none` (OCI's pattern); a single scheme with optional fields is the right precedent
   for a static/WIF pair and keeps HCP consistent with the AWS/GCP WIF providers.** **Read the outer field
   via `tasks.getEndpointDataParameter(serviceName, 'projectId', false)`, modeled on Azure's `subscriptionid`
   precedent (`azure-packer-command-handler.ts`) — the clearest precedent for reading an *outer* endpoint
   data field. (The OCI handler also calls `getEndpointDataParameter`, but for inner auth params, not an
   outer data field; GCP's analogous outer `project` field is defined in the manifest but is dead code,
   never read by any handler — do not mirror it.)**
2. Add new task.json input group `hcpRegistry` ("HCP Packer Registry", collapsed) with:
   `environmentServiceNameHCP` (`connectedService:PTPHCPServiceEndpoint`, optional — presence = feature
   enabled), `environmentAuthSchemeHCP` (pickList `ServiceConnection`|`WorkloadIdentityFederation`,
   default `ServiceConnection`), `hcpProjectId` (string, optional but strongly recommended — see the
   `HCP_PROJECT_ID` fact above), `hcpWorkloadProviderResourceName` (string, single raw value — see
   above; `visibleRule: environmentAuthSchemeHCP = WorkloadIdentityFederation`). Visible whenever
   `command = build || command = validate || command = inspect || command = console || command = custom`
   (each clause must repeat the field — ADO `visibleRule` has no `field = a || b` shorthand; matches the
   existing rule at `task.json:83`) (**adds `inspect`** to the set that already calls `handleProvider()`).
3. New pure module `Tasks/PackerTask/PackerTaskV1/src/hcp-credential-file.ts`: builds the
   `CredentialFile`/`IdentityProviderConfig` JSON (per the corrected schema above — `workload.env`, no
   `project_id` field) and validates `hcpWorkloadProviderResourceName`'s shape with a regex guard before
   it's embedded in JSON; mirrors `hcp-sdk-go`'s own `Validate()` invariants (exactly one credential
   source populated, never both `oauth` and `workload`).
4. Add `protected async applyHcpPackerRegistryAuth(): Promise<void>` to `base-packer-command-handler.ts`,
   placed immediately adjacent to each `handleProvider(command)` call (the only real ordering constraint,
   confirmed from source, is "both before `tool.execAsync(...)`"):
   - No-op if `environmentServiceNameHCP` is unset.
   - Static: read `username`/`password` endpoint auth params; fail closed if only one is set (mirror
     `AwsStaticIncompleteCredsReject`); `tasks.setSecret`; set `HCP_CLIENT_ID`/`HCP_CLIENT_SECRET` (secret)
     via `EnvironmentVariableHelper`; resolve a project id from the `hcpProjectId` input or the
     connection's `projectId` field and set `HCP_PROJECT_ID` if found, else `tasks.warning(...)` about the
     silent-oldest-project fallback.
   - WIF: `tasks.getInput("hcpWorkloadProviderResourceName", true)!` (hard-required in code even though
     `required: false` at the schema level); validate its shape; get the ADO OIDC token via the existing
     `generateIdToken(serviceName)`, `tasks.setSecret(token)`, and set it directly as an env var (e.g.
     `HCP_WORKLOAD_TOKEN`, secret) via `EnvironmentVariableHelper` — **no temp file for the JWT**; build
     the credential-file JSON via step 3's module, referencing that env var name; write *that* (non-secret)
     JSON via the existing `writeTrackedSecretFile('hcp-cred-file', 'json', json)` for its restrictive
     permissions; set `HCP_CRED_FILE` to that path; same `HCP_PROJECT_ID` resolution/warning as static mode.
   - Call `this.applyHcpPackerRegistryAuth()` from `validate()`, `build()`, `inspect()`, `console()`, `custom()`.
5. Add `/^HCP_/` to `base-packer-command-handler.ts`'s `MANAGED_ENV_PATTERNS` array — currently omitted
   from the array, so a user passing `HCP_CLIENT_ID`/`HCP_CRED_FILE` etc. through the generic
   `environmentVariables` passthrough input would silently get no collision warning (unlike every other
   provider's managed prefix) and be silently overwritten later. **Also update the collision-warning
   message text itself (`base-packer-command-handler.ts:151`), which enumerates the auth commands as
   "build/validate/console/custom" — add `inspect`, since HCP auth (and therefore this warning) now
   applies to it too.**
6. Tests (mirror existing `Tests/Aws*` pairs — see "Relevant files" below for the exact `Tests/L0.ts`
   wiring this requires): `HcpStaticAuth`(+L0), `HcpStaticIncompleteCredsReject`(+L0), `HcpWifAuth`(+L0,
   asserts `HCP_CRED_FILE`'s content references the env var name — not a file path — and that no JWT temp
   file is created), `HcpWifMissingResourceNameReject`(+L0), an extension of
   `EnvironmentVariablesCollisionWarns` for the new `HCP_` pattern, and 1-2 explicit no-op-regression
   additions on an existing provider test (e.g. extend `AzureWifAuth`/`OciAuth` to also assert no
   HCP-related env/output vars appear when HCP inputs are absent — cheap insurance, since this is the
   first base-class method in this codebase called unconditionally across every provider subclass).

### Phase 2 — Build-output parsing (*parallel with Phase 1*; touches `build()` in the same file, coordinate merge order)
7. Capture build stdout for parsing **without buffering the whole log**. Do NOT reuse
   `execWithStdoutCapture()` here — it concatenates every chunk into one growing string, and a long
   multi-builder `packer build` can emit a very large log that would be held entirely in memory just to
   recover two lines. Instead add a sibling helper `execWithLineScan(tool, options, onLine)` that attaches
   the same additive `'stdout'` listener but keeps only a partial-line buffer: on each `data` chunk, append
   to the carry-over buffer, split on `\n`, invoke `onLine(line)` for every completed line, and retain only
   the text after the final newline as carry-over for the next chunk (flush the remainder after exit). The
   cross-chunk carry-over is required for correctness — a single log line can be split across two `data`
   chunks, which would otherwise break the regex match. `build()` passes an `onLine` callback that tests
   each line against the two HCP regexes and stores only the matches, so memory is O(matches), not
   O(build-log). The `'stdout'` listener is purely additive — **confirmed directly from `toolrunner.js`
   source** that the runner unconditionally both emits the event and writes to the console (gated only by an
   unused `silent` option), so live console echo is unaffected. (`execWithStdoutCapture()` stays as-is for
   `fix()`, whose output is small and bounded.)
8. Match the two confirmed log-line formats above **as each line is scanned** (**confirmed never
   ANSI-wrapped, no stripping needed**), retaining `hcpPackerFingerprint` (first match) and
   `hcpPackerBucketName` + `hcpPackerVersionId` (last match, mirroring the existing "last build" convention
   for manifest `artifactId`); after the build completes, set the output variables from the retained
   matches. Reuse `sanitizeOutputVariableValue()` for all three. No new input required — purely additive,
   no-op when the template doesn't push to HCP Packer.
9. Tests: `BuildHcpMetadataParsed`(+L0), `BuildHcpMetadataAbsentNoOutputs`(+L0) — mirror `BuildManifestParsed.ts`/`BuildManifestNotFoundWarns.ts`.

### Phase 3 — Docs (*depends on Phases 1–2 being functionally settled*)
10. `docs/yaml-examples.md`: new "HCP Packer registry" section — static example, WIF example, and a
    `hcp_packer_registry` HCL snippet for the template side (bucket_name/description/bucket_labels/build_labels)
    so users understand the task-auth vs. template-metadata split. Mention `inspect` alongside `build` as a
    command that needs HCP auth when a template uses read-side `hcp-packer-*` datasources.
11. `docs/wif-setup.md`: new "HCP" section mirroring the AWS/GCP structure — creating a project-level HCP
    service principal, `hcp iam workload-identity-providers create-oidc` with issuer
    `https://vstoken.dev.azure.com/<ORG_ID>`, **`--allowed-audience=api://AzureADTokenV2`** (the critical
    gotcha above), conditional access statement on `jwt_claims.sub == "sc://<ORG>/<PROJECT>/<SERVICE_CONNECTION_NAME>"`,
    and the same long-running-build token-lifetime caveat already documented for the other 3 providers.
    Note that `hcpWorkloadProviderResourceName` is exactly the `resource_name` computed output if the
    provider was created via the `hcp` Terraform provider.
12. `docs/troubleshooting.md`: add the fail-fast behavior note ("if HCP credentials are set but invalid/missing
    when `hcp_packer_registry` is configured, Packer aborts the build immediately") and the
    silent-oldest-project-fallback note for a missing `hcpProjectId`.
13. `README.md` / `overview.md`: mention HCP Packer registry as an optional cross-cutting feature.
14. `CLAUDE.md`: update the PackerTaskV1 file table (add `hcp-credential-file.ts`), add an "HCP Packer
    registry" subsection next to "Provider auth env conventions" documenting the env vars, the Packer
    version floors (1.7.6 static / 1.7.5 HCL block / 1.14.2 WIF), and the audience gotcha, and add `/^HCP_/`
    to the documented `MANAGED_ENV_PATTERNS` list.
15. Bump `Tasks/PackerTask/PackerTaskV1/task.json`'s `Minor` version per the repo's release convention,
    **in the same PR as this feature.** `check-versions.js` only validates that version fields are
    well-formed — it does NOT enforce that a changed task's `Minor` was bumped (see Further considerations
    #2) — so a forgotten bump passes CI and only surfaces later as an ADO task-cache staleness bug.

## Relevant files
- `Tasks/PackerTask/PackerTaskV1/task.json` — new `hcpRegistry` input group
- `Tasks/PackerTask/PackerTaskV1/src/base-packer-command-handler.ts` — `applyHcpPackerRegistryAuth()`, new `execWithLineScan()` helper + `build()` bounded line-scan parsing (not full-log capture), the new `/^HCP_/` `MANAGED_ENV_PATTERNS` entry **and updated collision-warning message text**, wire into `validate()`/`build()`/`inspect()`/`console()`/`custom()`
- `Tasks/PackerTask/PackerTaskV1/src/hcp-credential-file.ts` (NEW) — pure credential-file JSON builder (`workload.env` source) + resource-name shape validation
- `@4cloudguru/pipeline-task-ado`'s `generateIdToken()` — reused as-is; its `writeSecretFile` reused for the credential-file JSON only (no longer for the JWT)
- `azure-devops-extension.json` — new `PTPHCPServiceEndpoint` contribution
- `docs/yaml-examples.md`, `docs/wif-setup.md`, `docs/troubleshooting.md`, `README.md`, `overview.md`, `CLAUDE.md`
- `Tasks/PackerTask/PackerTaskV1/Tests/*` — new test pairs, **plus explicit `expectX('HcpStaticAuth')`-style
  calls added inside `Tests/L0.ts`'s single `describe(...)` block** (the driver/fixture pairs in this repo
  have no self-registering `describe`/`it` of their own — a bare `import` of a new pair would silently no-op
  under mocha; `Tests/L0.ts` must explicitly reference each new driver's basename, same as every existing
  `Aws*`/`Gcp*`/`Oci*` pair)

## Verification
1. `npm run compile && npm test` in `Tasks/PackerTask/PackerTaskV1` (per `CLAUDE.md` workflow).
2. New unit tests green: static auth injection, incomplete-creds rejection, WIF credential-file content
   (references the token env var, not a file path), missing-resource-name rejection, `MANAGED_ENV_PATTERNS`
   collision warning, output-variable parsing (present + absent cases), and the no-op-regression additions
   on at least one existing provider test.
3. `npm run package:self` from repo root — confirms the new service-endpoint-type JSON is schema-valid and the `.vsix` still packages.
4. Manual/live smoke test (the one thing that can't be verified from source alone): a real `packer build`
   (and `packer inspect` against a template using a read-side `hcp-packer-*` datasource) against an actual
   HCP Packer registry, once with static Client ID/Secret and once with a real HCP workload identity
   provider trusting an ADO OIDC token, to confirm end-to-end auth and validate the output-parsing regexes
   against real (not just documented) log output.

## Decisions
- Cross-cutting feature, not a 6th `provider` value (see Architecture decision above).
- Bucket name/description/labels stay template-authored via `hcp_packer_registry`; task injects auth only.
- `-skip-enforcement` excluded from v1.
- `hcpWorkloadProviderResourceName` is a single raw string input, not 3 decomposed fields (reverses the
  original draft — see "Adversarial review" above).
- The WIF token source is a masked env var (`HCP_WORKLOAD_TOKEN`), not a temp file (reverses the original
  draft — fewer secret-bearing files on disk).
- The HCP service connection uses a single basic-auth scheme with both `username`/`password`
  `isRequired: false` (mirrors `PTPAWSServiceEndpoint`); a WIF connection leaves Client ID/Secret blank
  rather than getting a separate `endpoint-auth-scheme-none`.
- Build-output parsing uses a bounded line-scan (`execWithLineScan`, retains only matched lines), not
  full-log stdout capture — memory stays O(matches) on large multi-builder builds.
- `HCP_PROJECT_ID` is always set (in both auth modes) whenever `hcpProjectId` is known, with a task warning
  when it's absent — this was an open "further consideration" in the original draft and is now resolved.
- Command coverage is `build`, `validate`, `inspect`, `console`, `custom` — `inspect` was missing from the
  original draft and has been added.
- Document Packer version floors: 1.7.6+ (static env vars), 1.7.5+ (`hcp_packer_registry` HCL block,
  commonly documented as 1.7.7+), 1.14.2+ (WIF/`HCP_CRED_FILE`).

## Further considerations
1. The pre-existing gap that `inspect` (and, for that matter, `validate`) skip cloud-provider auth entirely
   for azurerm/aws/gcp today (not just HCP) is out of scope for this change — worth a one-line doc callout,
   not a fix, unless the user wants that addressed as a separate follow-up.
2. This repo's `check-versions.js` only validates version fields are well-formed; it does not actually
   enforce that a changed task's `Minor` was bumped (unlike the sibling `azure-pipelines-terraform` repo's
   `check-minor-bumps.js`). Two follow-ups, both orthogonal to this feature: (a) `CLAUDE.md`'s file-table
   line for `check-versions.js` ("fails if a changed task's Minor wasn't bumped") is inaccurate — **corrected
   as part of this review**; (b) porting the sibling's `check-minor-bumps.js` to actually enforce bumps is a
   worthwhile separate PR, not part of this change.
