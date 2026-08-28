import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ttm from 'azure-pipelines-task-lib/mock-test';
// Dependency-free pure module (no imports of its own), so importing the sibling
// PackerInstallerV1 package's copy directly is safe and keeps its row
// BEHAVIOURAL rather than source-level.
import { redactUrlUserInfo } from '@4cloudguru/pipeline-task-core';

/**
 * CLASS TEST — "a value that originates in template-, tool- or remote-service-
 * controlled output crosses a trust boundary (a pipeline output variable, a file
 * path, a parsed file) without content validation or containment, or is DROPPED
 * before it can cross because the producing exec rejected." (#101, #202, #203,
 * #110.)
 *
 * The rows below are the ENUMERATED SINKS produced by the re-runnable signature
 * `signatures/batch-E-output-boundary-signature.cjs` (S1 output variables, S2
 * path writes, S3 exec-dropped crossings, S4 unbounded parses) -- not one test
 * per reported call site. A per-site test that passes while its sibling sink is
 * broken is exactly what let #101 and #110 be closed and then reconfirmed.
 *
 * Every row is mutation-provable: inverting that row's own guard predicate turns
 * that row RED and leaves the others green. The two EXEMPT rows assert the
 * STRUCTURAL property the exemption rests on, so the row fails if the structure
 * that makes the sink safe is ever removed.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const INSTALLER_SRC = path.join(REPO_ROOT, 'Tasks', 'PackerInstaller', 'PackerInstallerV1', 'src');

/** True for a value the ADO agent would parse as more than one log line. */
function isSingleLine(value: string): boolean {
    return !/[\r\n\u0000-\u001F\u007F]/.test(value);
}

async function runScenario(file: string): Promise<ttm.MockTestRunner> {
    const tr = new ttm.MockTestRunner(path.join(__dirname, `${file}.js`));
    await tr.runAsync();
    return tr;
}

function handlerSource(): string {
    return fs.readFileSync(path.join(__dirname, '..', 'src', 'base-packer-command-handler.ts'), 'utf8');
}

function report(tr: ttm.MockTestRunner, message: string): string {
    return `${message}\n--- STDOUT ---\n${tr.stdout}\n--- STDERR ---\n${tr.stderr}`;
}

describe('Output-boundary defect class (S1 output variables / S2 path writes / S3 dropped crossings / S4 unbounded parse)', function () {

    // --- S1: pipeline output variables ------------------------------------

    it('S1 setVariable(artifactId) — a template-controlled manifest value carrying CR/LF and a ##vso[ payload never reaches the variable', async () => {
        const tr = await runScenario('ClassArtifactIdVsoInjection');
        assert.ok(tr.succeeded, report(tr, 'the build itself should still succeed'));
        assert.ok(!tr.stdout.includes('variable=artifactId'), report(tr, 'artifactId must NOT be exported from a control-char-bearing artifact_id'));
        assert.ok(!tr.stdout.includes('variable=pwnedByTemplate'), report(tr, 'the smuggled logging command must never be executed by the agent'));
        assert.ok(
            tr.warningIssues.some((w) => w.includes('failed output-variable validation')),
            report(tr, 'the rejection must be visible as a warning')
        );
    });

    it('S1 setVariable(manifestFilePath) — a control-char-bearing resolved path is rejected, not exported', async function () {
        if (process.platform === 'win32') {
            // NTFS cannot hold '\n' in a directory name, so the behavioural form of
            // this row is POSIX-only; assert the wiring structurally instead of
            // pending the row.
            assert.ok(
                /const safeManifestPath = this\.sanitizeOutputVariableValue\(resolved\);[\s\S]{0,200}?tasks\.setVariable\('manifestFilePath', safeManifestPath/.test(handlerSource()),
                'manifestFilePath must be exported only through the output-variable guard'
            );
            return;
        }
        const tr = await runScenario('ClassManifestPathNewlineRejected');
        assert.ok(tr.succeeded, report(tr, 'the build itself should still succeed'));
        assert.ok(!tr.stdout.includes('variable=manifestFilePath'), report(tr, 'manifestFilePath must be skipped when the resolved path is not printable-ASCII'));
        assert.ok(
            tr.warningIssues.some((w) => w.includes('failed output-variable validation')),
            report(tr, 'the rejection must be visible as a warning')
        );
    });

    it('S1 setVariable(fixFilePath) — a control-char-bearing resolved path is rejected, not exported', async function () {
        if (process.platform === 'win32') {
            assert.ok(
                /const safeFixFilePath = this\.sanitizeOutputVariableValue\(resolved\);[\s\S]{0,200}?tasks\.setVariable\('fixFilePath', safeFixFilePath/.test(handlerSource()),
                'fixFilePath must be exported only through the output-variable guard'
            );
            return;
        }
        const tr = await runScenario('ClassFixPathNewlineRejected');
        assert.ok(!tr.stdout.includes('variable=fixFilePath'), report(tr, 'fixFilePath must be skipped when the resolved path is not printable-ASCII'));
        assert.ok(
            tr.warningIssues.some((w) => w.includes('failed output-variable validation')),
            report(tr, 'the rejection must be visible as a warning')
        );
    });

    it('S1 setVariable(packerDownloadedFrom) — the operator-URL redaction strips C0 controls, so no newline survives into the variable', () => {
        // `new URL()` validation upstream does NOT catch this: the WHATWG parser
        // silently strips CR/LF while parsing, so the raw input string the
        // installer keeps passing around still carries the newline.
        const poisoned = 'https://user:pw@registry.example.com/base\n##vso[task.setvariable variable=pwned]1';
        assert.ok(new URL(poisoned).href.length > 0, 'precondition: new URL() accepts the poisoned input');
        const redacted = redactUrlUserInfo(poisoned);
        assert.ok(isSingleLine(redacted), `redactUrlUserInfo must neutralize control characters; got ${JSON.stringify(redacted)}`);
        assert.ok(!redacted.includes('user:pw@'), 'userinfo must still be stripped');
        // The variable value the installer builds from it is therefore single-line.
        assert.ok(isSingleLine(`registry:${redacted}`));
    });

    it('S1 setVariable(packerLocation) — EXEMPT: the exported path is <tools dir>/<literal tool>/<cleanVersion-validated semver>', () => {
        const src = fs.readFileSync(path.join(INSTALLER_SRC, 'packer-installer.ts'), 'utf8');
        // The remote-resolved version (checkpoint API / registry API) is put
        // through tools.cleanVersion(), which returns null for anything semver
        // rejects -- and the installer throws on null -- so no remote value can
        // put a control character into the cache path.
        assert.ok(/tools\.cleanVersion\(resolvedVersion\)/.test(src), 'the remote-resolved version must pass through tools.cleanVersion()');
        assert.ok(/if \(!version\) \{[\s\S]{0,200}?throw new Error/.test(src), 'an unparseable version must fail closed, not flow into the cache path');
        // The executable basename is a literal matched by tasks.match, not a name
        // taken from the downloaded archive.
        assert.ok(/packerToolName \+ getExecutableExtension\(\)/.test(src), 'the executable basename must be a literal, not archive-supplied');
    });

    // --- S3: crossings dropped by a rejecting exec ------------------------

    it('S3 build() — manifest-derived outputs are published even when packer build exits non-zero (task still fails)', async () => {
        const tr = await runScenario('ClassBuildFailureStillPublishes');
        assert.ok(tr.failed, report(tr, 'a non-zero packer build must still fail the task'));
        assert.ok(tr.stdout.includes('variable=artifactId'), report(tr, '#202: artifactId from the partially-written manifest must still be published'));
        assert.ok(tr.stdout.includes('variable=manifestFilePath'), report(tr, '#202: manifestFilePath must still be published'));
        assert.ok(tr.stdout.includes('ami-partial-0001'), report(tr, 'the surviving builder\'s artifact id must be the exported value'));
    });

    it('S3 fix() — the captured fixed template is written and fixFilePath exported even when packer fix exits non-zero (task still fails)', async () => {
        const tr = await runScenario('ClassFixFailureStillWrites');
        assert.ok(tr.failed, report(tr, 'a non-zero packer fix must still fail the task'));
        // fixFilePath is set ONLY inside `if (result.stdout) { tasks.writeFile(...); ... }`,
        // so its presence after a code=1 exec proves both that execution continued
        // past the (previously rejecting) exec AND that the fixed template was still
        // buffered when the write ran. The on-disk file cannot be asserted here:
        // mock-task's tasks.writeFile is a documented no-op under the mock runner
        // (node_modules/azure-pipelines-task-lib/mock-task.js: `function writeFile
        // (file, data, options) { //do nothing }`).
        assert.ok(tr.stdout.includes('variable=fixFilePath'), report(tr, '#203: fixFilePath must still be published'));
        assert.ok(tr.stdout.includes('fixed.json'), report(tr, '#203: the write target must be the resolved fixOutputFile'));
    });

    // --- S2: path write sinks ---------------------------------------------

    it('S2 tasks.writeFile(fixOutputFile) — a path escaping the working directory is refused', async () => {
        const tr = await runScenario('FixOutputTraversalReject');
        assert.ok(tr.failed, report(tr, 'a traversing fixOutputFile must fail the task'));
        assert.ok(
            tr.errorIssues.some((e) => e.includes('resolves outside the working directory')),
            report(tr, 'the containment check must be the reason for the failure')
        );
    });

    it('S2 fixOutputFile — the containment check runs AGAIN after packer fix returns (TOCTOU, #110)', () => {
        // The behavioural half above proves the PRE-exec check. The post-exec
        // re-check closes the window in which a symlink could be planted at the
        // target while packer fix runs -- a race no mock-runner scenario can
        // reproduce, so it is pinned structurally: both calls must be present and
        // the second must come after the exec that opens the window. Deleting
        // either check turns this row RED.
        const src = handlerSource();
        const fixBody = src.slice(src.indexOf('public async fix('), src.indexOf('public async hcl2Upgrade('));
        const checks = (fixBody.match(/isWithinWorkingDirectory\(/g) || []).length;
        assert.strictEqual(checks, 2, `fix() must contain a pre-exec AND a post-exec containment check; found ${checks}`);
        const execAt = fixBody.indexOf('execWithStdoutCapture(');
        const writeAt = fixBody.indexOf('tasks.writeFile(');
        const secondCheckAt = fixBody.indexOf('isWithinWorkingDirectory(', fixBody.indexOf('isWithinWorkingDirectory(') + 1);
        assert.ok(execAt < secondCheckAt && secondCheckAt < writeAt, 'the re-check must sit between the exec and the write');
    });

    it('S2 -output-file (hcl2_upgrade) — a path escaping the working directory is refused', async () => {
        const tr = await runScenario('Hcl2UpgradeTraversalReject');
        assert.ok(tr.failed, report(tr, 'a traversing hclOutputFile must fail the task'));
        assert.ok(
            tr.errorIssues.some((e) => e.includes('resolves outside the working directory')),
            report(tr, 'the containment check must be the reason for the failure')
        );
    });

    it('S2 -var-file (variableFiles) — a path escaping the working directory is refused (#339)', async () => {
        const tr = await runScenario('VariableFilesTraversalReject');
        assert.ok(tr.failed, report(tr, 'a traversing variableFiles entry must fail the task'));
        assert.ok(
            tr.errorIssues.some((e) => e.includes('resolves outside the working directory')),
            report(tr, 'the containment check must be the reason for the failure')
        );
    });

    it('S2 -var-file (variableFiles) — an entry that only stays inside workingDirectory lexically, via a symlink, is refused (#339)', async () => {
        const tr = await runScenario('VariableFilesSymlinkReject');
        assert.ok(tr.failed, report(tr, 'a symlink-escaping variableFiles entry must fail the task'));
        assert.ok(
            tr.errorIssues.some((e) => e.includes('resolves outside the working directory')),
            report(tr, 'the containment check must be the reason for the failure')
        );
    });

    it('S2 manifest read — a manifest resolving outside the working directory publishes nothing', async () => {
        const tr = await runScenario('BuildManifestTraversalSkipped');
        assert.ok(tr.succeeded, report(tr, 'the build itself should still succeed'));
        assert.ok(!tr.stdout.includes('variable=artifactId'), report(tr, 'no output variable may come from an out-of-bounds manifest'));
        assert.ok(
            tr.warningIssues.some((w) => w.includes('resolves outside the working directory')),
            report(tr, 'the containment check must be the reason nothing was published')
        );
    });

    // --- S4: unbounded parse of tool-written content ----------------------

    it('S4 manifest JSON.parse — a manifest over the size cap is not buffered or parsed', async () => {
        const tr = await runScenario('ClassManifestTooLarge');
        assert.ok(tr.succeeded, report(tr, 'the build itself should still succeed'));
        assert.ok(!tr.stdout.includes('variable=artifactId'), report(tr, 'nothing may be published from an over-cap manifest'));
        assert.ok(
            tr.warningIssues.some((w) => w.includes('above the') && w.includes('cap')),
            report(tr, 'the size cap must be the reason nothing was published')
        );
    });
});
