import * as assert from 'assert';
import * as ttm from 'azure-pipelines-task-lib/mock-test';
import * as path from 'path';

describe('PackerInstaller Test Suite', function () {

    before(() => {
        // Prevent VSCode debug path-with-spaces issue when spawning child processes
        delete process.env.NODE_OPTIONS;
        // Use the current Node executable instead of downloading a versioned one
        (ttm.MockTestRunner.prototype as unknown as { getNodePath: () => string }).getNodePath = function () {
            return process.execPath;
        };
    });

    after(() => { });

    function runValidations(validator: () => void, tr: ttm.MockTestRunner) {
        try {
            validator();
        } catch (error) {
            console.log("STDERR", tr.stderr);
            console.log("STDOUT", tr.stdout);
            throw error;
        }
    }

    function expectSuccess(file: string) {
        it(file, async () => {
            const tp = path.join(__dirname, `${file}.js`);
            const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
            await tr.runAsync();
            runValidations(() => {
                assert.ok(tr.succeeded, 'task should have succeeded');
                assert.ok(tr.errorIssues.length === 0, 'should have no errors. errors: ' + tr.errorIssues);
            }, tr);
        });
    }

    function expectFailure(file: string) {
        it(file, async () => {
            const tp = path.join(__dirname, `${file}.js`);
            const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
            await tr.runAsync();
            runValidations(() => {
                assert.ok(tr.failed, 'task should have failed');
                assert.ok(tr.errorIssues.length > 0, 'should have an error issue');
            }, tr);
        });
    }

    // --- Success cases ---
    expectSuccess('HashiCorpSpecificVersionSuccess');
    expectSuccess('HashiCorpLatestSuccess');
    expectSuccess('CachedInstallSuccess');
    expectSuccess('RegistrySpecificVersionSuccess');
    expectSuccess('MirrorCustomUrlSuccess');

    // --- Failure cases ---
    expectFailure('InsecureUrlReject');
    expectFailure('Sha256VerificationFail');
    expectFailure('InvalidVersionFail');
    expectFailure('GpgSignatureRequiredButMissing');
    expectFailure('RegistryEmptySha256Rejected');
    expectFailure('RegistryInsecureDownloadUrlReject');
    expectFailure('MirrorMissingChecksumFail');
});
