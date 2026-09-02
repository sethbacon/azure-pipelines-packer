import * as assert from 'assert';
import tasks = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerNone } from '../src/none-packer-command-handler';
import { EnvironmentVariableHelper } from '@4cloudguru/pipeline-task-ado';

/**
 * CLASS TEST — how a passthrough `environmentVariables` entry is classified
 * (#187 / #207).
 *
 * Three outcomes, and every managed name must land in exactly one of them:
 *   REJECT  — the name SELECTS an identity. Applied before handleProvider(), a
 *             passthrough here can win the provider SDK's credential-resolution
 *             race against the service connection, so it fails the task (#187).
 *   WARN    — the name only CONFIGURES an already-chosen identity, or is a
 *             proxy setting. A handler may replace it; it is not a credential.
 *   ALLOW   — an ordinary builder setting; passes through silently.
 *
 * This table is the reason `/^ARM_/` could be removed from MANAGED_ENV_PATTERNS
 * for #207 without changing behaviour: the `ARM_SUBSCRIPTION_ID` row asserts a
 * bare `ARM_*` still REJECTS, which it does via IDENTITY_SELECTING_ENV_PATTERNS,
 * checked first. Nothing in this codebase ever sets a bare `ARM_*`
 * (packer-plugin-azure reads only HCL / `PKR_VAR_arm_*`), so the old
 * "this task also manages it" warning was unreachable AND untrue.
 *
 * Mutation-provability: dropping `/^ARM_/` from IDENTITY_SELECTING_ENV_PATTERNS
 * turns the `ARM_SUBSCRIPTION_ID` row RED and no other; dropping `/^AWS_/` from
 * MANAGED_ENV_PATTERNS turns the `AWS_REGION` row RED and no other.
 *
 * A fourth, ORTHOGONAL dimension (#108): a non-rejected entry whose KEY looks
 * secret-shaped (TOKEN/SECRET/PASSWORD/KEY, case-insensitive) is masked via
 * tasks.setSecret regardless of whether it also warned. `mask` is independent
 * of `outcome` -- a WARN row can mask, an ALLOW row can mask, a REJECT row
 * never reaches the masking code at all (it throws first).
 */

type Outcome = 'REJECT' | 'WARN' | 'ALLOW';
type Row = { entry: string; key: string; outcome: Outcome; why: string; mask?: boolean };

const ROWS: Row[] = [
    // --- REJECT: names that select an identity ---
    { entry: 'AWS_ACCESS_KEY_ID=fake', key: 'AWS_ACCESS_KEY_ID', outcome: 'REJECT', why: 'static AWS keys beat the web-identity token file in the SDK credential chain' },
    { entry: 'AWS_WEB_IDENTITY_TOKEN_FILE=/tmp/x', key: 'AWS_WEB_IDENTITY_TOKEN_FILE', outcome: 'REJECT', why: 'points the AWS SDK at a token this task did not mint' },
    { entry: 'AWS_ROLE_SESSION_NAME=whatever', key: 'AWS_ROLE_SESSION_NAME', outcome: 'REJECT', why: 'forges the CloudTrail attribution the derived per-run name provides (#197)' },
    { entry: 'GOOGLE_APPLICATION_CREDENTIALS=/tmp/sa.json', key: 'GOOGLE_APPLICATION_CREDENTIALS', outcome: 'REJECT', why: 'replaces the external_account credential file this task writes' },
    { entry: 'CLOUDSDK_AUTH_ACCESS_TOKEN=tok', key: 'CLOUDSDK_AUTH_ACCESS_TOKEN', outcome: 'REJECT', why: 'gcloud/SDK identity override' },
    { entry: 'PKR_VAR_arm_client_secret=s3cret', key: 'PKR_VAR_arm_client_secret', outcome: 'REJECT', why: 'the Azure handler clears competing selectors; a passthrough would re-select one' },
    { entry: 'PKR_VAR_arm_oidc_request_url=https://evil.example.com', key: 'PKR_VAR_arm_oidc_request_url', outcome: 'REJECT', why: '#332: re-enables azurerm OIDC-refresh auth, outranking the freshly-minted client_jwt' },
    { entry: 'PKR_VAR_arm_oidc_request_token=tok', key: 'PKR_VAR_arm_oidc_request_token', outcome: 'REJECT', why: '#332: pairs with oidc_request_url to complete the OIDC-refresh selector' },
    { entry: 'PKR_VAR_arm_use_azure_cli_auth=true', key: 'PKR_VAR_arm_use_azure_cli_auth', outcome: 'REJECT', why: '#332: silently authenticates as the agent\'s ambient az-CLI session instead of the service connection' },
    { entry: 'PKR_VAR_oci_key_file=/tmp/k.pem', key: 'PKR_VAR_oci_key_file', outcome: 'REJECT', why: 'every PKR_VAR_oci_* field participates in OCI identity' },
    { entry: 'PKR_VAR_vsphere_password=pw', key: 'PKR_VAR_vsphere_password', outcome: 'REJECT', why: 'vSphere credential' },
    { entry: 'OCI_CLI_PROFILE=other', key: 'OCI_CLI_PROFILE', outcome: 'REJECT', why: 'OCI CLI identity override' },
    { entry: 'OCI_CLI_AUTH=security_token', key: 'OCI_CLI_AUTH', outcome: 'REJECT', why: 'selects the OCI auth METHOD, so it can redirect which credential the build uses' },
    { entry: 'PKR_VAR_oci_access_cfg_file=/tmp/c.ini', key: 'PKR_VAR_oci_access_cfg_file', outcome: 'REJECT', why: 'names the config file the WIF branch authenticates from (#344)' },
    { entry: 'PKR_VAR_oci_use_instance_principals=true', key: 'PKR_VAR_oci_use_instance_principals', outcome: 'REJECT', why: 'switches the builder to instance-principal auth, defeating both OCI branches' },
    {
        entry: 'ARM_SUBSCRIPTION_ID=00000000-0000-0000-0000-000000000000',
        key: 'ARM_SUBSCRIPTION_ID',
        outcome: 'REJECT',
        why: '#207: packer-plugin-azure never reads ARM_*, so this is an operator confusing this extension with the Terraform one — fail rather than let their value sit there doing nothing',
    },

    // --- WARN: managed, but only configures an already-chosen identity ---
    { entry: 'AWS_REGION=eu-west-1', key: 'AWS_REGION', outcome: 'WARN', why: 'the AWS handler may replace it; it names no identity' },
    { entry: 'PKR_VAR_arm_resource_group=rg', key: 'PKR_VAR_arm_resource_group', outcome: 'WARN', why: 'PKR_VAR_arm_* that is not one of the identity selectors' },
    { entry: 'HTTPS_PROXY=http://proxy.example.com:8080', key: 'HTTPS_PROXY', outcome: 'WARN', why: 'the task derives proxy settings from the agent configuration (#196)' },

    // --- ALLOW: ordinary builder settings ---
    { entry: 'MY_CUSTOM_BUILD_VAR=hello', key: 'MY_CUSTOM_BUILD_VAR', outcome: 'ALLOW', why: 'not a name this task manages' },
    { entry: 'PACKER_LOG=1', key: 'PACKER_LOG', outcome: 'ALLOW', why: 'a packer setting, not a credential' },

    // --- Masking (#108): secret-shaped key, unmanaged name, ALLOWed through but masked ---
    { entry: 'DIGITALOCEAN_TOKEN=do_v1_abc123', key: 'DIGITALOCEAN_TOKEN', outcome: 'ALLOW', why: 'unmanaged name, but TOKEN-shaped -- masked as defense-in-depth, not rejected', mask: true },
    { entry: 'PKR_VAR_ssh_password=hunter2', key: 'PKR_VAR_ssh_password', outcome: 'ALLOW', why: 'unmanaged PKR_VAR (not oci/vsphere/arm), PASSWORD-shaped -- masked, not rejected', mask: true },
    { entry: 'MY_CUSTOM_BUILD_VAR=hello', key: 'MY_CUSTOM_BUILD_VAR', outcome: 'ALLOW', why: 'a plain builder setting must NOT be masked -- over-masking every value would hide the point of this table', mask: false },
];

describe('passthrough environmentVariables classification (class test #187/#207)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monkeypatch the shared task-lib module
    const t = tasks as any;
    const origGetInput = t.getInput;
    const origWarning = t.warning;
    const origSetVariable = t.setVariable;
    const origSetSecret = t.setSecret;

    let warnings: string[] = [];
    let maskedValues: string[] = [];

    beforeEach(() => {
        warnings = [];
        maskedValues = [];
        t.warning = (m: string) => warnings.push(m);
        t.setVariable = () => { /* EnvironmentVariableHelper also mirrors to a task variable */ };
        t.setSecret = (v: string) => maskedValues.push(v);
    });

    afterEach(() => {
        t.getInput = origGetInput;
        t.warning = origWarning;
        t.setVariable = origSetVariable;
        t.setSecret = origSetSecret;
        EnvironmentVariableHelper.clearTrackedVariables();
    });

    for (const row of ROWS) {
        it(`${row.outcome}s '${row.key}'`, () => {
            t.getInput = (name: string) => (name === 'environmentVariables' ? row.entry : undefined);
            const handler = new PackerCommandHandlerNone();
            // applyEnvironmentVariables is protected; the classification it performs
            // is the unit under test, so reach it directly rather than through a
            // full mock-run of every command.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- protected member under test
            const apply = () => (handler as any).applyEnvironmentVariables();

            if (row.outcome === 'REJECT') {
                assert.throws(apply, new RegExp(`'${row.key}'`), row.why);
                assert.strictEqual(process.env[row.key], undefined,
                    `${row.key}: a rejected entry must never reach the child process environment`);
                return;
            }

            apply();
            const value = row.entry.split('=').slice(1).join('=');
            assert.strictEqual(process.env[row.key], value,
                `${row.key}: a non-rejected entry should be applied`);
            const warned = warnings.some((w) => w.includes(`'${row.key}'`));
            assert.strictEqual(warned, row.outcome === 'WARN',
                `${row.key}: expected ${row.outcome === 'WARN' ? 'a' : 'no'} collision warning; got ${JSON.stringify(warnings)}`);
            if (row.mask !== undefined) {
                const masked = maskedValues.includes(value);
                assert.strictEqual(masked, row.mask,
                    `${row.key}: expected ${row.mask ? '' : 'no '}masking of its value; masked=${JSON.stringify(maskedValues)}`);
            }
        });
    }

    it("REJECTs 'PATH' without disturbing the ambient value (#339)", () => {
        // PATH doesn't fit the ROWS table above: unlike every other REJECT row,
        // it is legitimately already present in process.env before this test
        // ever runs (the real search path node itself was launched with), so
        // asserting it becomes `undefined` after rejection -- the ROWS loop's
        // assertion for every other row -- would be wrong. What actually matters
        // is that applyEnvironmentVariables() throws before EnvironmentVariableHelper
        // ever gets a chance to overwrite it with the passthrough value: #339,
        // applyEnvironmentVariables() runs before dispatch, and every command
        // resolves its packer binary via tasks.which('packer', true), which
        // searches process.env.PATH at call time -- a passthrough PATH selects
        // which packer binary this task's own tool resolution finds.
        const ambientPath = process.env['PATH'];
        t.getInput = (name: string) => (name === 'environmentVariables' ? 'PATH=/tmp/evil:/usr/bin' : undefined);
        const handler = new PackerCommandHandlerNone();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- protected member under test
        const apply = () => (handler as any).applyEnvironmentVariables();
        assert.throws(apply, /'PATH'/, "a PATH passthrough must be rejected outright, like the other identity-selecting names");
        assert.strictEqual(process.env['PATH'], ambientPath, 'PATH must be left exactly as it was; the malicious passthrough must never be applied');
    });

    it('never promises an overwrite it cannot deliver (#207)', () => {
        t.getInput = (name: string) => (name === 'environmentVariables' ? 'AWS_REGION=eu-west-1' : undefined);
        const handler = new PackerCommandHandlerNone();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- protected member under test
        (handler as any).applyEnvironmentVariables();
        assert.strictEqual(warnings.length, 1, 'expected exactly one collision warning');
        assert.ok(
            !/will be overwritten/i.test(warnings[0]),
            `the warning must not promise a per-prefix overwrite that is not true for every managed pattern: ${warnings[0]}`,
        );
    });
});
