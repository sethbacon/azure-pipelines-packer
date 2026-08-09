import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as ttm from 'azure-pipelines-task-lib/mock-test';
import {

    getCacheHashSidecarPath,
    recordCachedBinaryHash,
    verifyCachedBinaryHash,
    verifySha256,
} from '../src/packer-installer';
import { discardArtifactOnFailure } from '../src/artifact-discard';
import { VerificationFailure } from '../src/verification-failure';

/**
 * CLASS TEST — artifact trust (#65 / #78 / #136 / #198 / #204).
 *
 * Defect class: an installed artifact is trusted without the verification the task
 * advertises, or the verification's failure/edge state leaves the install path
 * unrecoverable or silently degraded.
 *
 * Three tables, each covering the class rather than one call site:
 *   A. SITE_ROWS  — every trust site the re-runnable signature
 *                   (scripts/check-artifact-trust.js) enumerates in THIS repo, with
 *                   its verdict. A new download strategy or cache path shows up here
 *                   automatically and fails the enumeration assertion until it is
 *                   accounted for.
 *   B. EDGE_ROWS  — the failure/edge STATES themselves, driven through the real
 *                   exported helpers: a checksum mismatch (artifact must be gone), a
 *                   zero-length / truncated / non-hex cache record, a valid record
 *                   that matches, a valid record that does not.
 *   C. FLOW_ROWS  — the same edge states end-to-end through the task, where the
 *                   decision depends on inputs: SHA256SUMS absent with the GPG toggle
 *                   on, an unresolvable 'latest', and a cache hit with no usable
 *                   record.
 *
 * Every row is mutation-provable: inverting the guard it exercises turns that row —
 * and only that row's group — RED.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');

// --- Table A: the enumerated trust sites -----------------------------------

type SiteRow = { file: string; fn: string; kind: string; verdict: string; why: string };

const INSTALLER = 'Tasks/PackerInstaller/PackerInstallerV1/src/packer-installer.ts';

const SITE_ROWS: SiteRow[] = [
    // --- acquisition: every path that pulls a binary off the network ---
    {
        file: INSTALLER, fn: 'downloadToolWithTimeout', kind: 'ACQUIRE', verdict: 'EXEMPT-DELEGATES-TO-CALLER',
        why: 'pure timeout/retry wrapper around tools.downloadTool; its URL is a parameter, so its callers own verification',
    },
    { file: INSTALLER, fn: 'downloadZipFromHashiCorp', kind: 'ACQUIRE', verdict: 'VERIFIED', why: 'GPG-signed SHA256SUMS from releases.hashicorp.com' },
    { file: INSTALLER, fn: 'downloadZipFromRegistry', kind: 'ACQUIRE', verdict: 'VERIFIED', why: 'registry-provided sha256, mandatory under requireChecksum' },
    { file: INSTALLER, fn: 'downloadZipFromMirror', kind: 'ACQUIRE', verdict: 'VERIFIED', why: 'mirror SHA256SUMS + its GPG signature' },

    // --- #204: a rejected artifact must not outlive the check that rejected it ---
    { file: INSTALLER, fn: 'downloadZipFromHashiCorp', kind: 'VERIFY', verdict: 'DISCARDS-ON-FAILURE', why: 'hashicorp GPG check (#204)' },
    { file: INSTALLER, fn: 'downloadZipFromHashiCorp', kind: 'VERIFY', verdict: 'DISCARDS-ON-FAILURE', why: 'hashicorp SHA256 check (#204)' },
    { file: INSTALLER, fn: 'downloadZipFromRegistry', kind: 'VERIFY', verdict: 'DISCARDS-ON-FAILURE', why: 'registry SHA256 check (#204)' },
    { file: INSTALLER, fn: 'downloadZipFromMirror', kind: 'VERIFY', verdict: 'DISCARDS-ON-FAILURE', why: 'mirror GPG check (#204)' },
    { file: INSTALLER, fn: 'downloadZipFromMirror', kind: 'VERIFY', verdict: 'DISCARDS-ON-FAILURE', why: 'mirror SHA256 check (#204)' },
    {
        file: INSTALLER, fn: 'verifyCachedBinaryHash', kind: 'VERIFY', verdict: 'EXEMPT-CACHE-VERIFY',
        why: 'verifies the AGENT-CACHED binary, which other jobs may be using: a failed check fails the task without evicting the cache entry',
    },

    // --- #65: the require-signature toggle on the "no checksum file" branch ---
    {
        file: INSTALLER, fn: 'downloadZipFromMirror', kind: 'SUMS-ABSENT', verdict: 'HONORS-SIGNATURE-TOGGLE',
        why: 'the SHA256SUMS is what the .sig signs, so "no SUMS published" also means "no signature": requireGpgSignature is read on this branch too (#65)',
    },

    // --- #136: the cache is a trust boundary ---
    {
        file: INSTALLER, fn: 'downloadPacker', kind: 'CACHE-ADMIT', verdict: 'REVERIFIES-AND-GATES',
        why: 'a hit is re-verified offline against the recorded hash, an entry with no usable record is escalated to a remote re-verification, and a record is written only for an artifact this run actually verified (#136)',
    },

    // --- #198: the cache-integrity record's own edge states ---
    {
        file: INSTALLER, fn: 'verifyCachedBinaryHash', kind: 'RECORD-READ', verdict: 'VALIDATES-RECORD',
        why: 'a zero-length/truncated record is unverifiable, not tampering: validated as 64 hex characters before it is used as an expectation (#198)',
    },
    {
        file: INSTALLER, fn: 'recordCachedBinaryHash', kind: 'RECORD-WRITE', verdict: 'ATOMIC-WRITE',
        why: 'temp file + rename, so an interrupted write can never leave the truncated record that #198 is about',
    },

    // --- #78: 'latest' must not silently become a pinned stale version ---
    {
        file: INSTALLER, fn: 'resolveVersionFromHashiCorp', kind: 'LATEST', verdict: 'FAILS-CLOSED',
        why: 'an unreachable checkpoint API fails the task instead of installing a hardcoded FALLBACK_PACKER_VERSION (#78)',
    },
];

// --- Table B: the edge states, against the real helpers ---------------------

type EdgeRow = {
    what: string;
    /** Content written to the sidecar before the check; undefined = no sidecar at all. */
    record?: string;
    /** Expected verifyCachedBinaryHash outcome: true/false, or 'throws' for a real mismatch. */
    expect: true | false | 'throws';
};

/**
 * Table B1 — the cache-integrity record (#198/#136). Rows expecting `false` go RED if
 * the SHA256_HEX_PATTERN validation in verifyCachedBinaryHash is removed or inverted
 * (they then throw a tampering-shaped Sha256VerificationFailed, which is exactly the
 * brick #198 describes). The `'throws'` row goes RED if the validation is widened so
 * far that a genuine mismatch stops failing.
 */
const RECORD_ROWS: EdgeRow[] = [
    { what: 'no record at all (legacy cache entry)', record: undefined, expect: false },
    { what: 'a zero-length record (interrupted write)', record: '', expect: false },
    { what: 'a whitespace-only record', record: '   \n', expect: false },
    { what: 'a truncated record (12 of 64 hex characters)', record: 'aabbccddeeff', expect: false },
    { what: 'an over-long record (65 hex characters)', record: 'a'.repeat(65), expect: false },
    { what: 'a 64-character record that is not hex', record: 'z'.repeat(64), expect: false },
    { what: 'a record carrying a filename as well as a digest', record: `${'a'.repeat(64)}  packer`, expect: false },
    { what: 'a well-formed record that matches the cached binary', record: 'MATCH', expect: true },
    { what: 'a well-formed record that does NOT match (real tampering)', record: 'b'.repeat(64), expect: 'throws' },
];

// --- Table C: the same states end-to-end through the task -------------------

type FlowRow = { fixture: string; what: string; outcome: 'success' | 'failure'; expectText?: string; forbidText?: string };

/**
 * Table C. Each row runs the real task under the mock runner. Rows go RED when the
 * guard named in `what` is inverted, and only those rows do.
 */
const FLOW_ROWS: FlowRow[] = [
    {
        fixture: 'MirrorSumsMissingGpgRequiredFail',
        what: 'mirror publishes no SHA256SUMS while requireGpgSignature is on (#65)',
        outcome: 'failure',
        expectText: 'GPG signature verification is required',
    },
    {
        fixture: 'MirrorChecksumOptOutSuccess',
        what: 'mirror publishes no SHA256SUMS and BOTH toggles are off — installs with a warning (#65 must not over-block)',
        outcome: 'success',
        expectText: 'WITHOUT any local integrity verification',
    },
    {
        fixture: 'MirrorSha256MismatchFail',
        what: 'a mirror hash mismatch is fatal even with requireChecksum off (#204)',
        outcome: 'failure',
    },
    {
        fixture: 'HashiCorpLatestCheckpointDownFail',
        what: "'latest' cannot be resolved — no silent fallback to a pinned version (#78)",
        outcome: 'failure',
    },
    {
        fixture: 'CacheHitHashMismatchFail',
        what: 'a cache hit whose well-formed record does not match the binary (#136)',
        outcome: 'failure',
    },
    {
        fixture: 'CacheHitUnmarkedReverifyMismatchFail',
        what: 'a cache hit with NO record whose binary differs from the freshly verified release (#136)',
        outcome: 'failure',
    },
    {
        fixture: 'CacheHitUnmarkedVerificationFailureFail',
        what: 'a reachable source serving material that fails verification during re-verification — fail closed, not degrade (#136)',
        outcome: 'failure',
    },
    {
        fixture: 'CacheHitTruncatedSidecarDegrades',
        what: 'a truncated record + an unreachable source degrades with a warning instead of bricking the version (#198)',
        outcome: 'success',
        // Under the mock runner task.json's message table is not loaded, so a
        // localized string surfaces as its loc KEY — which is the stable identity to
        // assert on: what matters is that the run degrades through
        // CachedToolReverificationUnavailable rather than dying on a
        // Sha256VerificationFailed that reads as tampering.
        expectText: 'CachedToolReverificationUnavailable',
        forbidText: 'Sha256VerificationFailed',
    },
    {
        fixture: 'CacheHitHashMatchSuccess',
        what: 'a cache hit whose record matches installs offline, with no network call (#136 must not over-block)',
        outcome: 'success',
    },
];

describe('artifact trust (class test #65/#78/#136/#198/#204)', function () {
    this.timeout(30000);

    describe('A. every enumerated trust site in this repo', () => {
        // The signature exits non-zero when it finds residuals, and execFileSync
        // throws on a non-zero exit — capture stdout from the error so a residual
        // fails an ASSERTION below rather than aborting the whole suite at load.
        let stdout: string;
        try {
            stdout = execFileSync(
                process.execPath,
                [path.join(REPO_ROOT, 'scripts/check-artifact-trust.js'), REPO_ROOT, '--json'],
                { encoding: 'utf8' },
            );
        } catch (err) {
            stdout = String((err as { stdout?: string }).stdout ?? '');
            assert.ok(stdout.trim().startsWith('{'), `signature produced no JSON: ${String(err)}`);
        }
        const report = JSON.parse(stdout) as {
            sites: Array<{ rel: string; fn: string; kind: string; verdict: string; why: string; line: number }>;
            failures: number;
        };

        it('leaves no residual instance of the class anywhere in src/', () => {
            assert.strictEqual(
                report.failures, 0,
                `residual artifact-trust sites:\n${JSON.stringify(report.sites.filter(s => s.verdict !== 'OK'), null, 2)}`,
            );
        });

        it('enumerates exactly the sites this table accounts for', () => {
            const seen = report.sites.map(s => `${s.rel}:${s.kind}:${s.fn}:${s.verdict}`).sort();
            const known = SITE_ROWS.map(s => `${s.file}:${s.kind}:${s.fn}:${s.verdict}`).sort();
            assert.deepStrictEqual(
                seen, known,
                'a trust site appeared, vanished, or changed verdict — add it to SITE_ROWS with its verdict and reason',
            );
        });

        for (const row of SITE_ROWS) {
            it(`${row.fn}() [${row.kind}] is ${row.verdict}`, () => {
                const site = report.sites.find(s => s.rel === row.file && s.fn === row.fn && s.kind === row.kind && s.verdict === row.verdict);
                assert.ok(site, `site not found with that verdict: ${row.fn} [${row.kind}] ${row.verdict} — ${row.why}`);
            });
        }
    });

    describe('B1. a verification failure discards the artifact (#204)', () => {
        function tempArtifact(content: string): string {
            const file = path.join(os.tmpdir(), `artifact-trust-${process.pid}-${Math.random().toString(36).slice(2)}.zip`);
            fs.writeFileSync(file, content);
            return file;
        }

        it('a checksum MISMATCH deletes the downloaded artifact', async () => {
            const artifact = tempArtifact('tampered-zip-bytes');
            try {
                await assert.rejects(
                    discardArtifactOnFailure(artifact, () => verifySha256(artifact, 'a'.repeat(64))),
                    /SHA256|Sha256/,
                );
                assert.ok(!fs.existsSync(artifact), 'a checksum-mismatched artifact must not be left on disk');
            } finally {
                try { fs.unlinkSync(artifact); } catch { /* already gone, which is the point */ }
            }
        });

        it('a SIGNATURE failure deletes the downloaded artifact', async () => {
            const artifact = tempArtifact('unsigned-zip-bytes');
            try {
                await assert.rejects(
                    discardArtifactOnFailure(artifact, async () => { throw new VerificationFailure('GPG signature verification failed for SHA256SUMS'); }),
                    /GPG signature verification failed/,
                );
                assert.ok(!fs.existsSync(artifact), 'an artifact whose signature failed must not be left on disk');
            } finally {
                try { fs.unlinkSync(artifact); } catch { /* already gone */ }
            }
        });

        it('a PASSING verification keeps the artifact (the guard must not delete good downloads)', async () => {
            const artifact = tempArtifact('good-zip-bytes');
            const digest = require('crypto').createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
            try {
                await discardArtifactOnFailure(artifact, () => verifySha256(artifact, digest));
                assert.ok(fs.existsSync(artifact), 'a verified artifact must survive');
            } finally {
                try { fs.unlinkSync(artifact); } catch { /* best effort */ }
            }
        });

        it('an unlink failure does not mask the verification error', async () => {
            const missing = path.join(os.tmpdir(), `artifact-trust-absent-${process.pid}.zip`);
            await assert.rejects(
                discardArtifactOnFailure(missing, async () => { throw new VerificationFailure('checksum mismatch'); }),
                /checksum mismatch/,
            );
        });
    });

    describe('B2. the cache-integrity record\'s edge states (#198/#136)', () => {
        let dir: string;
        let binary: string;

        beforeEach(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-trust-cache-'));
            binary = path.join(dir, 'packer');
            fs.writeFileSync(binary, 'cached-packer-binary');
        });
        afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

        const actualDigest = () => require('crypto').createHash('sha256').update(fs.readFileSync(binary)).digest('hex');

        for (const row of RECORD_ROWS) {
            it(`${row.expect === 'throws' ? 'fails on' : `reports ${row.expect} for`} ${row.what}`, async () => {
                const sidecar = getCacheHashSidecarPath(binary);
                if (row.record !== undefined) {
                    fs.writeFileSync(sidecar, row.record === 'MATCH' ? actualDigest() : row.record);
                }
                if (row.expect === 'throws') {
                    await assert.rejects(verifyCachedBinaryHash(binary), /SHA256|Sha256/);
                    return;
                }
                assert.strictEqual(await verifyCachedBinaryHash(binary), row.expect);
            });
        }

        it('accepts an uppercase well-formed record (hex comparison is case-insensitive)', async () => {
            fs.writeFileSync(getCacheHashSidecarPath(binary), actualDigest().toUpperCase());
            assert.strictEqual(await verifyCachedBinaryHash(binary), true);
        });

        it('records the hash atomically, leaving no temp file behind', () => {
            recordCachedBinaryHash(binary);
            const sidecar = getCacheHashSidecarPath(binary);
            assert.strictEqual(fs.readFileSync(sidecar, 'utf8'), actualDigest());
            const strays = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
            assert.deepStrictEqual(strays, [], 'an atomic write must not leave a temp file behind');
        });

        it('heals a torn record: re-recording restores a verifiable entry', async () => {
            const sidecar = getCacheHashSidecarPath(binary);
            fs.writeFileSync(sidecar, 'aabbccddeeff');
            assert.strictEqual(await verifyCachedBinaryHash(binary), false, 'a torn record must read as unverifiable');
            recordCachedBinaryHash(binary);
            assert.strictEqual(await verifyCachedBinaryHash(binary), true, 're-recording must restore a verifiable entry');
        });
    });

    describe('C. the same states end-to-end through the task', () => {
        before(() => {
            delete process.env.NODE_OPTIONS;
            (ttm.MockTestRunner.prototype as unknown as { getNodePath: () => string }).getNodePath = function () {
                return process.execPath;
            };
        });

        for (const row of FLOW_ROWS) {
            it(`${row.outcome === 'failure' ? 'fails' : 'installs'} when ${row.what}`, async () => {
                const tr = new ttm.MockTestRunner(path.join(__dirname, `${row.fixture}.js`));
                await tr.runAsync();
                const detail = `\nSTDOUT: ${tr.stdout}\nSTDERR: ${tr.stderr}`;
                if (row.outcome === 'failure') {
                    assert.ok(tr.failed, `task should have failed (${row.fixture})${detail}`);
                    assert.ok(tr.errorIssues.length > 0, `should have an error issue (${row.fixture})${detail}`);
                    if (row.expectText) {
                        assert.ok(
                            tr.errorIssues.some(e => e.includes(row.expectText!)) || tr.stdout.includes(row.expectText),
                            `expected "${row.expectText}" in the failure (${row.fixture})${detail}`,
                        );
                    }
                    return;
                }
                assert.ok(tr.succeeded, `task should have succeeded (${row.fixture})${detail}`);
                assert.strictEqual(tr.errorIssues.length, 0, `should have no errors (${row.fixture})${detail}`);
                if (row.expectText) {
                    assert.ok(
                        tr.warningIssues.some(w => w.includes(row.expectText!)) || tr.stdout.includes(row.expectText),
                        `expected "${row.expectText}" in the output (${row.fixture})${detail}`,
                    );
                }
                if (row.forbidText) {
                    assert.ok(
                        !tr.stdout.includes(row.forbidText),
                        `"${row.forbidText}" must not appear — an unverifiable record must not be reported as tampering (${row.fixture})${detail}`,
                    );
                }
            });
        }
    });
});
