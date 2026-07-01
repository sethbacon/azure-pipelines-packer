import * as assert from 'assert';
import * as ttm from 'azure-pipelines-task-lib/mock-test';
import * as path from 'path';

describe('PackerTask Test Suite', function () {

    before(() => {
        delete process.env.NODE_OPTIONS;
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

    // --- Command argument assembly (provider = none) ---
    expectSuccess('BuildNoneSuccess');
    expectSuccess('BuildWithOptions');
    expectSuccess('ValidateSyntaxOnly');
    expectSuccess('InitUpgrade');
    expectSuccess('FmtCheckSuccess');
    expectSuccess('PluginsInstalled');
    expectSuccess('PluginsInstall');
    expectSuccess('VersionSuccess');
    expectSuccess('Hcl2UpgradeSuccess');
    expectSuccess('InspectSuccess');
    expectSuccess('CustomSuccess');

    // --- Failure mapping ---
    expectFailure('FmtFail');

    // --- Provider auth handlers (environment-variable injection) ---
    expectSuccess('AwsStaticAuth');
    expectSuccess('AzureServicePrincipalAuth');
    expectSuccess('AzureWifAuth');
    expectSuccess('AzureMsiAuth');
    expectSuccess('VsphereAuth');
    expectSuccess('OciAuth');
    expectSuccess('NoneAuth');
});
