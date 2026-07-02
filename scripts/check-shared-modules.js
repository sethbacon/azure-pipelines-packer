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

const SRC_DIR = 'Tasks/PackerInstaller/PackerInstallerV1/src';

// The registry of modules copied from azure-pipelines-terraform. Adding a new
// copy means adding it here AND giving it the provenance header below.
const SHARED_MODULES = [
    'hashicorp-gpg-key.ts',
    'gpg-verifier.ts',
    'http-client.ts',
];

// Required provenance markers (see any listed module's header for the format).
const MARKERS = [
    { name: 'upstream', re: /@shared-module:\s*copied from azure-pipelines-terraform\s*\(.+\)/ },
    { name: 'policy', re: /@shared-module-policy:\s*\S/ },
    { name: 'status', re: /@shared-module-status:\s*(IN-SYNC|DIVERGED)\b/ },
];

let hasError = false;

for (const file of SHARED_MODULES) {
    const full = path.resolve(SRC_DIR, file);
    if (!fs.existsSync(full)) {
        console.error(`FAIL: shared module missing: ${path.join(SRC_DIR, file)}`);
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
