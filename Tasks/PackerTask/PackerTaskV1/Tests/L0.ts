import * as assert from 'assert';
import * as ttm from 'azure-pipelines-task-lib/mock-test';
import * as path from 'path';
import { ParentCommandHandler } from '../src/parent-handler';
import { EnvironmentVariableHelper } from '@4cloudguru/pipeline-task-ado';
import './ProxyParityL0';
import './PassthroughEnvClassificationL0';
import './RoleSessionNameManifestL0';
import './SecureFileLoaderL0';
import './PreMaskingClassL0';
import './CredentialFailClosedMatrixL0';
import './EntryPointSignalsL0';
import './OutputBoundaryClassL0';
// This extension's half of azure-pipelines-terraform#867's class: a credential
// input left as `type: string` is stored in the pipeline definition in cleartext.
import './CredentialInputTypeClassL0';
// This extension's half of azure-pipelines-terraform#884/#897: command dispatch
// keyed by a task input through a plain object literal.
import './PrototypeSafeLookupClassL0';

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

    /**
     * Like expectSuccess, but also proves the credential was masked -- not just
     * that it landed in process.env. When `expectedSecrets` is given, asserts
     * that EACH exact value was registered via tasks.setSecret (not just that
     * some setSecret call happened somewhere), so a regression to a single or
     * wrong-value registration on a multi-mask path (e.g. Azure WIF's token
     * masked twice) is caught (#111).
     */
    function expectSuccessMasksSecret(file: string, expectedSecrets?: string[]) {
        it(file, async () => {
            const tp = path.join(__dirname, `${file}.js`);
            const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
            await tr.runAsync();
            runValidations(() => {
                assert.ok(tr.succeeded, 'task should have succeeded');
                assert.ok(tr.errorIssues.length === 0, 'should have no errors. errors: ' + tr.errorIssues);
                assert.ok(tr.stdOutContained('##vso[task.setsecret]'), 'credential should be masked via tasks.setSecret');
                for (const secret of expectedSecrets ?? []) {
                    assert.ok(
                        tr.stdOutContained(`##vso[task.setsecret]${secret}`),
                        `expected the specific credential '${secret}' to be masked via tasks.setSecret`
                    );
                }
            }, tr);
        });
    }

    // --- Command argument assembly (provider = none) ---
    expectSuccess('BuildNoneSuccess');
    expectSuccess('BuildWithOptions');
    expectSuccess('ValidateSyntaxOnly');
    expectSuccess('InitUpgrade');
    expectSuccess('FmtCheckSuccess');
    expectFailure('FmtCheckCapitalTrueFail');  // #331: 'True' from unquoted YAML must keep -check ON
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
    expectSuccessMasksSecret('AwsStaticAuth', ['secretkey']);
    expectSuccessMasksSecret('AzureServicePrincipalAuth', ['spkey']);
    expectSuccessMasksSecret('AzureWifAuth', ['mock-oidc-jwt-12345']);
    expectSuccess('AzureMsiAuth');
    expectSuccessMasksSecret('VsphereAuth', ['pw']);
    expectSuccessMasksSecret('OciAuth');
    expectSuccessMasksSecret('GcpAuth');
    expectSuccessMasksSecret('GcpWifAuth', ['mock-gcp-oidc-jwt-12345']);
    expectSuccessMasksSecret('AwsWifAuth', ['mock-aws-oidc-jwt-12345']);
    expectSuccess('NoneAuth');
    expectSuccess('GcpMultilinePemAuth');   // #108: genuine multi-line PEM must not throw
    expectSuccess('OciMultilinePemAuth');   // #195: same for OCI (REST/CLI-created connections)

    it('OciAuthPerLineMasking', async () => {
        const tp = path.join(__dirname, 'OciAuth.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'task should have succeeded');
            const setSecretCount = (tr.stdout.match(/##vso\[task\.setsecret\]/g) || []).length;
            // The normalized PEM body is re-wrapped at 64 chars/line
            // (pem-normalizer.ts); a 2048-bit RSA PKCS8 key's base64 body spans
            // well over 5 lines, so per-line masking must register far more than
            // a single secret. A regression to whole-key-only masking would drop
            // this to 1.
            assert.ok(setSecretCount > 5, `expected multiple per-line secret registrations for the normalized PEM; got ${setSecretCount}`);
        }, tr);
    });

    it('GcpAuthPerLineMasking', async () => {
        const tp = path.join(__dirname, 'GcpAuth.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'task should have succeeded');
            const setSecretCount = (tr.stdout.match(/##vso\[task\.setsecret\]/g) || []).length;
            // #108: before the fix, GCP registered exactly one setSecret call (the
            // raw key); this pins the new per-line masking of the normalized
            // on-disk form.
            assert.ok(setSecretCount > 5, `expected multiple per-line secret registrations for the normalized PEM; got ${setSecretCount}`);
        }, tr);
    });

    // --- Cleanup: the real ParentCommandHandler.execute() path (not a direct
    // handleProvider() call) actually clears env vars and removes temp files. ---
    expectSuccess('OciValidateCleanupSuccess');

    // --- Fail-closed / hardening regressions ---
    expectFailure('AwsStaticIncompleteCredsReject');
    expectFailure('OciTenancyInvalidReject');
    expectFailure('AwsWifMissingServiceConnReject');   // #73
    expectFailure('GcpWifMissingServiceConnReject');   // #73
    expectFailure('VsphereEmptyPasswordReject');       // #74
    expectFailure('VsphereMissingServiceConnReject');       // #141
    expectFailure('VsphereServerUrlUnparseableReject');     // #141
    expectFailure('AzureUndefinedSchemeReject');               // #97
    expectFailure('AzureMissingServicePrincipalSecretReject'); // #97
    expectFailure('AzureUnknownSchemeRejects');                // #111
    expectFailure('Hcl2UpgradeTraversalReject');               // #100
    expectFailure('FixOutputTraversalReject');                 // #111
    expectFailure('VariableFilesTraversalReject');             // #339
    expectFailure('VariableFilesSymlinkReject');                // #339
    expectSuccess('ConsoleExpressionSuccess');                 // #111
    expectSuccess('VsphereServerUserinfoStripped');            // #110
    expectFailure('VsphereServerInvalidCharsetReject');        // #110
    expectFailure('EnvironmentVariablesIdentityReject');        // #187

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

    it('BuildManifestArtifactIdControlCharsRejected', async () => {
        const tp = path.join(__dirname, 'BuildManifestArtifactIdControlCharsRejected.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'the build should still succeed');
            assert.ok(tr.stdout.includes('variable=manifestFilePath'), 'manifestFilePath should still be set');
            assert.ok(!tr.stdout.includes('variable=artifactId'), 'artifactId with an embedded newline must be rejected, not exported');
            assert.ok(
                tr.warningIssues.some((w) => w.includes('failed output-variable validation')),
                'should warn that artifact_id failed validation. warnings: ' + tr.warningIssues
            );
        }, tr);
    });

    it('BuildManifestNotFoundWarns', async () => {
        const tp = path.join(__dirname, 'BuildManifestNotFoundWarns.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'the build itself should still succeed');
            assert.ok(
                tr.warningIssues.some((w) => w.includes('Manifest file not found')),
                'a missing, explicitly-configured manifestFile should warn (not just debug-log). warnings: ' + tr.warningIssues
            );
        }, tr);
    });

    it('BuildManifestUnparseableWarns', async () => {
        const tp = path.join(__dirname, 'BuildManifestUnparseableWarns.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'the build itself should still succeed');
            assert.ok(
                tr.warningIssues.some((w) => w.includes('Could not parse Packer manifest')),
                'an unparseable, explicitly-configured manifestFile should warn (not just debug-log). warnings: ' + tr.warningIssues
            );
        }, tr);
    });

    it('EnvironmentVariablesCollisionWarns', async () => {
        const tp = path.join(__dirname, 'EnvironmentVariablesCollisionWarns.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'task should have succeeded');
            assert.ok(
                tr.warningIssues.some((w) => w.includes("sets 'AWS_REGION'")),
                'should warn about a managed-name collision. warnings: ' + tr.warningIssues
            );
            assert.ok(
                !tr.warningIssues.some((w) => w.includes('will be overwritten by the provider handler')),
                '#187: the warning must not promise an overwrite that does not happen. warnings: ' + tr.warningIssues
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

    it('FixOutputWritten', async () => {
        const tp = path.join(__dirname, 'FixOutputWritten.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'the fix command should succeed');
            assert.ok(tr.stdout.includes('variable=fixFilePath'), 'fixFilePath output variable should be set');
        }, tr);
    });

    it('BuildSecureVarsFileCleanup', async () => {
        const tp = path.join(__dirname, 'BuildSecureVarsFileCleanup.js');
        const tr: ttm.MockTestRunner = new ttm.MockTestRunner(tp);
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'the build should succeed with the secure var-file wired into -var-file');
            assert.ok(tr.stdout.includes('SECUREFILE_DOWNLOADED:secure-file-id-e2e'), 'the secure file should be downloaded');
            assert.ok(tr.stdout.includes('SECUREFILE_DELETED:secure-file-id-e2e'), 'the secure file should be deleted during finally-block cleanup');
            // Windows' filesystem only tracks a read-only attribute, not POSIX
            // mode bits: chmod(0o600) succeeds but stat() reports back 0o666
            // (writable) rather than 0o600. The exact-mode assertion only holds
            // on platforms with real POSIX permissions; tightenFilePermissions's
            // own platform-branching behavior is covered directly in
            // @4cloudguru/pipeline-task-ado's own test suite.
            if (process.platform !== 'win32') {
                assert.ok(tr.stdout.includes('mode=600'), 'the downloaded secure file should be chmod 0600 before cleanup (#103)');
            }
        }, tr);
    });
});
