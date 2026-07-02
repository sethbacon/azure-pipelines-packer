import * as assert from 'assert';
import * as ttm from 'azure-pipelines-task-lib/mock-test';
import * as path from 'path';
import { ParentCommandHandler } from '../src/parent-handler';
import { EnvironmentVariableHelper } from '../src/environment-variables';
import './IdTokenGeneratorL0';
import './PemNormalizerL0';
import './SecureTempL0';
import './SecureFileLoaderL0';

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

    /** Like expectSuccess, but also proves the credential was masked -- not just that it landed in process.env. */
    function expectSuccessMasksSecret(file: string) {
        it(file, async () => {
            const tp = path.join(__dirname, `${file}.js`);
            const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
            await tr.runAsync();
            runValidations(() => {
                assert.ok(tr.succeeded, 'task should have succeeded');
                assert.ok(tr.errorIssues.length === 0, 'should have no errors. errors: ' + tr.errorIssues);
                assert.ok(tr.stdOutContained('##vso[task.setsecret]'), 'credential should be masked via tasks.setSecret');
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
    // Secret-bearing paths also assert the credential was masked (tasks.setSecret),
    // not just that it landed in process.env.
    expectSuccessMasksSecret('AwsStaticAuth');
    expectSuccessMasksSecret('AzureServicePrincipalAuth');
    expectSuccessMasksSecret('AzureWifAuth');
    expectSuccess('AzureMsiAuth');
    expectSuccessMasksSecret('VsphereAuth');
    expectSuccessMasksSecret('OciAuth');
    expectSuccessMasksSecret('GcpAuth');
    expectSuccessMasksSecret('GcpWifAuth');
    expectSuccessMasksSecret('AwsWifAuth');
    expectSuccess('NoneAuth');

    // --- Cleanup: the real ParentCommandHandler.execute() path (not a direct
    // handleProvider() call) actually clears env vars and removes temp files. ---
    expectSuccess('OciValidateCleanupSuccess');

    // --- Fail-closed / hardening regressions ---
    expectFailure('AwsStaticIncompleteCredsReject');
    expectFailure('OciTenancyInvalidReject');
    expectFailure('AwsWifMissingServiceConnReject');   // #73
    expectFailure('GcpWifMissingServiceConnReject');   // #73
    expectFailure('VsphereEmptyPasswordReject');       // #74

    it('VsphereInsecureConnectionWarns', async () => {
        const tp = path.join(__dirname, 'VsphereInsecureConnectionWarns.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'task should have succeeded');
            assert.ok(
                tr.warningIssues.some((w) => w.includes('man-in-the-middle')),
                'should warn that vCenter TLS verification is disabled. warnings: ' + tr.warningIssues
            );
        }, tr);
    });

    it('BuildManifestTraversalSkipped', async () => {
        const tp = path.join(__dirname, 'BuildManifestTraversalSkipped.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'the build itself should still succeed');
            assert.ok(
                tr.warningIssues.some((w) => w.includes('resolves outside the working directory')),
                'should warn that manifestFile escapes the working directory. warnings: ' + tr.warningIssues
            );
            assert.ok(!tr.stdout.includes('variable=artifactId'), 'artifactId must not be set from an out-of-bounds manifest');
        }, tr);
    });

    it('BuildManifestParsed', async () => {
        const tp = path.join(__dirname, 'BuildManifestParsed.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'the build should succeed');
            assert.ok(tr.stdout.includes('variable=manifestFilePath'), 'manifestFilePath output variable should be set');
            assert.ok(tr.stdout.includes('variable=artifactId'), 'artifactId output variable should be set');
            // The last build's artifact_id wins.
            assert.ok(tr.stdout.includes('ami-0123456789'), 'artifactId should be the last build\'s artifact_id');
        }, tr);
    });

    it('BuildManifestNonStringArtifact', async () => {
        const tp = path.join(__dirname, 'BuildManifestNonStringArtifact.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'the build should succeed');
            assert.ok(tr.stdout.includes('variable=manifestFilePath'), 'manifestFilePath should still be set');
            assert.ok(!tr.stdout.includes('variable=artifactId'), 'artifactId must be skipped for a non-string/number artifact_id');
        }, tr);
    });

    it('EnvironmentVariablesCollisionWarns', async () => {
        const tp = path.join(__dirname, 'EnvironmentVariablesCollisionWarns.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'task should have succeeded');
            assert.ok(
                tr.warningIssues.some((w) => w.includes("sets 'AWS_ACCESS_KEY_ID'")),
                'should warn about a managed-name collision. warnings: ' + tr.warningIssues
            );
            assert.ok(
                !tr.warningIssues.some((w) => w.includes('MY_CUSTOM_BUILD_VAR')),
                'should not warn about a non-colliding custom variable. warnings: ' + tr.warningIssues
            );
        }, tr);
    });

    it('emergencyCleanup clears tracked env vars even before a handler is assigned', () => {
        EnvironmentVariableHelper.setEnvironmentVariable('PACKER_TEST_EMERGENCY_CLEANUP', 'value');
        assert.strictEqual(process.env['PACKER_TEST_EMERGENCY_CLEANUP'], 'value');

        new ParentCommandHandler().emergencyCleanup();

        assert.strictEqual(process.env['PACKER_TEST_EMERGENCY_CLEANUP'], undefined,
            'emergencyCleanup() must clear tracked env vars regardless of whether execute() ever ran');
    });
});
