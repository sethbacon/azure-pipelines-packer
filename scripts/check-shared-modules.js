#!/usr/bin/env node
// Shared-module provenance gate (#67).
//
// The installer's download trust chain — hashicorp-gpg-key.ts, gpg-verifier.ts,
// http-client.ts — was copied from the sibling azure-pipelines-terraform
// extension. The terraform repo enforces BYTE-IDENTITY of these modules across
// its several installer tasks (scripts/check-shared-modules.js, "families" of
// task dirs). That within-repo check does not fit this repo: each module exists
// in exactly ONE task here (PackerInstaller/PackerInstallerV1/src), so there is
// no second in-repo copy to diff against, and a cross-repo byte diff is neither
// available in CI nor even correct any more — http-client.ts has intentionally
// advanced ahead of the terraform copy (per-hop redirect host/scheme
// re-validation, MAX_REDIRECTS, typed HttpError + withRetry, fetchTextAllow404).
//
// So instead of asserting an identity we cannot (and should not) guarantee, this
// gate enforces the *provenance convention* that the "should be mirrored" comment
// used to state informally: every copied module must carry a machine-checkable
// header declaring its upstream source of truth, the sync policy, and its current
// in-sync/diverged status. That turns an unenforced comment into a CI invariant —
// a copy can no longer be added, or lose its provenance, silently. Extracting a
// shared, versioned cross-extension package remains the tracked long-term fix.

const fs = require('fs');
const path = require('path');

const INSTALLER_SRC = 'Tasks/PackerInstaller/PackerInstallerV1/src';
const TASK_SRC = 'Tasks/PackerTask/PackerTaskV1/src';

// The registry of modules copied from azure-pipelines-terraform. Adding a new
// copy means adding it here AND giving it the provenance header below.
//
// Entries carry their own src dir: the registry used to assume a single
// directory (the installer's), which meant a copied module landing in the
// COMMAND task's src/ could not be registered at all and so was silently
// exempt from the provenance convention this gate exists to enforce.
const SHARED_MODULES = [
    { dir: INSTALLER_SRC, file: 'hashicorp-gpg-key.ts' },
    { dir: INSTALLER_SRC, file: 'gpg-verifier.ts' },
    { dir: INSTALLER_SRC, file: 'http-client.ts' },
    { dir: INSTALLER_SRC, file: 'url-secret-redaction.ts' },
    // Egress authorization moved to @4cloudguru/pipeline-task-core (src/egress/)
    // and the local copy is deleted, so there is no longer a copy here to keep in
    // parity — the version pin is what enforces it now. The terraform copy stays
    // gated by ITS OWN check until that repo takes the dependency too; until then
    // the two repos are deliberately no longer symmetrical.
    { dir: INSTALLER_SRC, file: 'url-path-segment.ts' },
    // Verification-failure classification: the typed marker that distinguishes
    // "material was obtained and FAILED verification / was withheld by a reachable
    // source under a require-flag" (fail closed) from "the source could not be
    // reached at all" (degrade to the cached tool). The cache-hit re-verification
    // path in BOTH extensions branches on it, so a drift would silently reclassify
    // a bad GPG signature as a mere availability warning.
    { dir: INSTALLER_SRC, file: 'verification-failure.ts' },
    // Discard-on-failed-verification wrapper: a downloaded archive whose checksum or
    // signature does NOT verify is deleted rather than left in the agent's temp
    // directory. Same body as the terraform copy, which is byte-identical across its
    // three installer tasks.
    { dir: INSTALLER_SRC, file: 'artifact-discard.ts' },
    // The agent-proxy fetch options builder (#196). Body byte-identical to
    // TerraformTaskV5/src/proxy-config.ts, including both setSecret calls (raw
    // and percent-encoded proxy password); only the JSDoc names this repo's own
    // call site. scripts/check-proxy-parity.js enforces that every outbound call
    // actually uses it.
    { dir: TASK_SRC, file: 'proxy-config.ts' },
];

// Required provenance markers (see any listed module's header for the format).
const MARKERS = [
    { name: 'upstream', re: /@shared-module:\s*copied from azure-pipelines-terraform\s*\(.+\)/ },
    { name: 'policy', re: /@shared-module-policy:\s*\S/ },
    { name: 'status', re: /@shared-module-status:\s*(IN-SYNC|DIVERGED)\b/ },
];

let hasError = false;

for (const { dir, file } of SHARED_MODULES) {
    const full = path.resolve(dir, file);
    if (!fs.existsSync(full)) {
        console.error(`FAIL: shared module missing: ${path.join(dir, file)}`);
        hasError = true;
        continue;
    }
    // Only the header comment block matters; scan the first 40 lines.
    const head = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').split('\n').slice(0, 40).join('\n');
    const missing = MARKERS.filter((m) => !m.re.test(head)).map((m) => m.name);
    if (missing.length) {
        console.error(`FAIL: ${file} is missing provenance marker(s): ${missing.join(', ')}`);
        console.error(`      add the @shared-module / @shared-module-policy / @shared-module-status header (see a sibling module).`);
        hasError = true;
    } else {
        console.log(`OK: ${file} carries a valid shared-module provenance header`);
    }
}

if (hasError) {
    process.exit(1);
}
console.log('All shared-module provenance checks passed.');
