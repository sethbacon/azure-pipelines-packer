import * as assert from 'assert';
import tasks = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerNone } from '../src/none-packer-command-handler';
import { EnvironmentVariableHelper } from '../src/environment-variables';

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
 */

type Outcome = 'REJECT' | 'WARN' | 'ALLOW';
type Row = { entry: string; key: string; outcome: Outcome; why: string };

const ROWS: Row[] = [
    // --- REJECT: names that select an identity ---
    { entry: 'AWS_ACCESS_KEY_ID=fake', key: 'AWS_ACCESS_KEY_ID', outcome: 'REJECT', why: 'static AWS keys beat the web-identity token file in the SDK credential chain' },
    { entry: 'AWS_WEB_IDENTITY_TOKEN_FILE=/tmp/x', key: 'AWS_WEB_IDENTITY_TOKEN_FILE', outcome: 'REJECT', why: 'points the AWS SDK at a token this task did not mint' },
    { entry: 'AWS_ROLE_SESSION_NAME=whatever', key: 'AWS_ROLE_SESSION_NAME', outcome: 'REJECT', why: 'forges the CloudTrail attribution the derived per-run name provides (#197)' },
    { entry: 'GOOGLE_APPLICATION_CREDENTIALS=/tmp/sa.json', key: 'GOOGLE_APPLICATION_CREDENTIALS', outcome: 'REJECT', why: 'replaces the external_account credential file this task writes' },
    { entry: 'CLOUDSDK_AUTH_ACCESS_TOKEN=tok', key: 'CLOUDSDK_AUTH_ACCESS_TOKEN', outcome: 'REJECT', why: 'gcloud/SDK identity override' },
    { entry: 'PKR_VAR_arm_client_secret=s3cret', key: 'PKR_VAR_arm_client_secret', outcome: 'REJECT', why: 'the Azure handler clears competing selectors; a passthrough would re-select one' },
    { entry: 'PKR_VAR_oci_key_file=/tmp/k.pem', key: 'PKR_VAR_oci_key_file', outcome: 'REJECT', why: 'every PKR_VAR_oci_* field participates in OCI identity' },
    { entry: 'PKR_VAR_vsphere_password=pw', key: 'PKR_VAR_vsphere_password', outcome: 'REJECT', why: 'vSphere credential' },
    { entry: 'OCI_CLI_PROFILE=other', key: 'OCI_CLI_PROFILE', outcome: 'REJECT', why: 'OCI CLI identity override' },
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
];

describe('passthrough environmentVariables classification (class test #187/#207)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monkeypatch the shared task-lib module
    const t = tasks as any;
    const origGetInput = t.getInput;
    const origWarning = t.warning;
    const origSetVariable = t.setVariable;

    let warnings: string[] = [];

    beforeEach(() => {
        warnings = [];
        t.warning = (m: string) => warnings.push(m);
        t.setVariable = () => { /* EnvironmentVariableHelper also mirrors to a task variable */ };
    });

    afterEach(() => {
        t.getInput = origGetInput;
        t.warning = origWarning;
        t.setVariable = origSetVariable;
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
            assert.strictEqual(process.env[row.key], row.entry.split('=').slice(1).join('='),
                `${row.key}: a non-rejected entry should be applied`);
            const warned = warnings.some((w) => w.includes(`'${row.key}'`));
            assert.strictEqual(warned, row.outcome === 'WARN',
                `${row.key}: expected ${row.outcome === 'WARN' ? 'a' : 'no'} collision warning; got ${JSON.stringify(warnings)}`);
        });
    }

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
