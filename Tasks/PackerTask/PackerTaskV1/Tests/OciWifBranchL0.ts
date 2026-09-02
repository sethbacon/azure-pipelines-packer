import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import tasks = require('azure-pipelines-task-lib/task');
import pipelineTaskAdo = require('@4cloudguru/pipeline-task-ado');
import { PackerCommandHandlerOCI } from '../src/oci-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

/**
 * #344 finding 1: the OCI Workload Identity Federation branch.
 *
 * The two network hops (generateIdToken, exchangeOidcForUpst) are stubbed;
 * everything else -- RSA keygen, the MD5 fingerprint, the synthetic config
 * file, the temp-file tracking -- runs for real, so the assertions below are
 * about what this handler actually produces rather than about the stubs.
 *
 * WHY THE CONFIG FILE AT ALL. packer-plugin-oracle reads none of
 * OCI_CLI_CONFIG_FILE / OCI_CLI_PROFILE / OCI_CLI_AUTH (builder/oci/config.go:
 * getDefaultOCISettingsPath() hard-codes ~/.oci/config, and the only override
 * is the `access_cfg_file` HCL field). Session-token auth is reachable only
 * through that file: ComposingConfigurationProvider takes each field from the
 * first provider returning no error, rawConfigurationProvider errors on every
 * empty field, and fileConfigurationProvider.KeyID() returns "ST$<token>" for a
 * profile with security_token_file and no user. Hence the API-key PKR_VAR_oci_*
 * selectors must be ABSENT, which is asserted explicitly below -- if any were
 * set, the raw provider at index 0 would answer first and the session token
 * would never be consulted.
 */
describe('OCI Workload Identity Federation branch (#344)', function () {
    const t = tasks as any;
    const ado = pipelineTaskAdo as any;

    const orig = {
        getInput: tasks.getInput,
        getVariable: tasks.getVariable,
        setSecret: tasks.setSecret,
        warning: tasks.warning,
        debug: tasks.debug,
        generateIdToken: ado.generateIdToken,
        exchangeOidcForUpst: ado.exchangeOidcForUpst,
    };

    const INPUTS: Record<string, string> = {
        environmentAuthSchemeOCI: 'WorkloadIdentityFederation',
        ociWifIdentityDomainUrl:
            'https://idcs-0123456789abcdef0123456789abcdef.identity.oraclecloud.com',
        ociWifClientId: 'the-client-id',
        ociWifTenancyOcid: 'ocid1.tenancy.oc1..aaaaaaaaexampletenancyocid',
        ociWifRegion: 'us-ashburn-1',
    };

    let setSecretCalls: string[] = [];
    let inputs: Record<string, string>;

    beforeEach(() => {
        inputs = { ...INPUTS };
        setSecretCalls = [];
        t.debug = () => { /* quiet */ };
        t.warning = () => { /* quiet */ };
        t.setSecret = (v: string) => {
            // Reproduce task-lib's real contract: setSecret throws on CR/LF, so a
            // handler that registered a whole PEM in one call would fail here
            // rather than silently masking nothing.
            if (v && /\r|\n/.test(v)) throw new Error('LIB_MultilineSecret');
            setSecretCalls.push(v);
        };
        t.getInput = (name: string) => inputs[name];
        t.getVariable = () => undefined;
        ado.generateIdToken = async () => 'mock-oidc-jwt';
        ado.exchangeOidcForUpst = async () => 'mock-upst-token';
    });

    afterEach(() => {
        Object.assign(tasks as any, {
            getInput: orig.getInput,
            getVariable: orig.getVariable,
            setSecret: orig.setSecret,
            warning: orig.warning,
            debug: orig.debug,
        });
        ado.generateIdToken = orig.generateIdToken;
        ado.exchangeOidcForUpst = orig.exchangeOidcForUpst;
        pipelineTaskAdo.EnvironmentVariableHelper.clearTrackedVariables();
        for (const k of Object.keys(process.env)) {
            if (k.startsWith('PKR_VAR_oci_') || k.startsWith('OCI_CLI_')) delete process.env[k];
        }
    });

    const command = () => new PackerAuthorizationCommandInitializer('build', '', 'OCI');

    async function runWif(): Promise<PackerCommandHandlerOCI> {
        const handler = new PackerCommandHandlerOCI();
        try {
            await handler.handleProvider(command());
        } catch (e) {
            handler.cleanupTempFiles();
            throw e;
        }
        return handler;
    }

    it('writes a session-token config the plugin can actually resolve', async () => {
        const handler = await runWif();
        try {
            const tracked: string[] = (handler as any).tempFiles;
            assert.strictEqual(tracked.length, 3, 'expected key, UPST and config temp files');

            const configPath = tracked.find((p) => p.includes('oci-wif-config'))!;
            const keyPath = tracked.find((p) => p.includes('oci-wif-key'))!;
            const upstPath = tracked.find((p) => p.includes('oci-wif-upst'))!;
            assert.ok(configPath && keyPath && upstPath, 'all three temp files must be tracked');

            // Re-derive the fingerprint from the key actually written, rather than
            // comparing against a golden string that would pass even if the handler
            // wrote a fingerprint for a different key.
            const privatePem = fs.readFileSync(keyPath, 'utf8');
            const der = crypto.createPublicKey(privatePem).export({ type: 'spki', format: 'der' });
            const expectedFingerprint = crypto
                .createHash('md5')
                .update(der)
                .digest('hex')
                .match(/.{2}/g)!
                .join(':');

            assert.strictEqual(
                fs.readFileSync(configPath, 'utf8'),
                [
                    '[DEFAULT]',
                    `tenancy=${INPUTS.ociWifTenancyOcid}`,
                    `region=${INPUTS.ociWifRegion}`,
                    `key_file=${keyPath}`,
                    `fingerprint=${expectedFingerprint}`,
                    `security_token_file=${upstPath}`,
                ].join('\n') + '\n',
            );
            assert.strictEqual(fs.readFileSync(upstPath, 'utf8'), 'mock-upst-token');
        } finally {
            handler.cleanupTempFiles();
        }
    });

    it('delivers the config path as a -var, not only as PKR_VAR_', async () => {
        const handler = await runWif();
        try {
            const configPath = ((handler as any).tempFiles as string[]).find((p) =>
                p.includes('oci-wif-config'),
            )!;
            const varArgs: string[] = (handler as any).providerVarArgs;

            // The env var alone would be silently skipped by a template that never
            // declared the variable; the -var makes packer refuse the run instead.
            assert.deepStrictEqual(varArgs, [`oci_access_cfg_file=${configPath}`]);
            assert.strictEqual(process.env['PKR_VAR_oci_access_cfg_file'], configPath);
            assert.strictEqual(process.env['PKR_VAR_oci_access_cfg_file_account'], 'DEFAULT');
        } finally {
            handler.cleanupTempFiles();
        }
    });

    it('leaves every API-key selector unset, so the file provider is reached', async () => {
        const handler = await runWif();
        try {
            for (const name of [
                'PKR_VAR_oci_tenancy_ocid',
                'PKR_VAR_oci_user_ocid',
                'PKR_VAR_oci_region',
                'PKR_VAR_oci_fingerprint',
                'PKR_VAR_oci_key_file',
            ]) {
                assert.strictEqual(
                    process.env[name],
                    undefined,
                    `${name} must be unset on the WIF branch: a value here is answered by the raw ` +
                    `configuration provider at index 0 and the session token is never consulted`,
                );
            }
        } finally {
            handler.cleanupTempFiles();
        }
    });

    it('clears inherited competing and API-key credential variables', async () => {
        const seeded = [
            'OCI_CLI_CONFIG_FILE',
            'OCI_CLI_PROFILE',
            'OCI_CLI_AUTH',
            'OCI_CLI_TENANCY',
            'PKR_VAR_oci_user_ocid',
            'PKR_VAR_oci_key_file',
            'PKR_VAR_oci_pass_phrase',
        ];
        for (const name of seeded) process.env[name] = 'inherited-from-the-agent';

        const handler = await runWif();
        try {
            for (const name of seeded) {
                assert.strictEqual(
                    process.env[name],
                    undefined,
                    `${name} must be cleared before WIF credentials are injected`,
                );
            }
        } finally {
            handler.cleanupTempFiles();
        }
    });

    it('masks the OIDC token, the UPST, and every line of the ephemeral key', async () => {
        const handler = await runWif();
        try {
            assert.ok(setSecretCalls.includes('mock-oidc-jwt'), 'the OIDC token must be masked');
            assert.ok(setSecretCalls.includes('mock-upst-token'), 'the UPST must be masked');

            const keyPath = ((handler as any).tempFiles as string[]).find((p) =>
                p.includes('oci-wif-key'),
            )!;
            const bodyLines = fs
                .readFileSync(keyPath, 'utf8')
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l && !l.startsWith('-----'));

            assert.ok(bodyLines.length > 1, 'the ephemeral key should span several lines');
            for (const line of bodyLines) {
                assert.ok(
                    setSecretCalls.includes(line),
                    'every body line of the ephemeral private key must be registered line-wise ' +
                    "(ADO's masker matches within one log line, and setSecret rejects multi-line input)",
                );
            }
        } finally {
            handler.cleanupTempFiles();
        }
    });

    it('validates every input before requesting a token', async () => {
        // Ordering, not merely rejection: a federated assertion is a live bearer
        // credential the moment it exists, so a config error must be caught
        // before one is minted. Pass/fail alone cannot prove that -- the proof
        // is that generateIdToken is never CALLED.
        for (const [field, bad] of [
            ['ociWifIdentityDomainUrl', 'https://evil.example.com'],
            ['ociWifTenancyOcid', 'ocid1.user.oc1..notatenancy'],
            ['ociWifRegion', 'US-Ashburn-1'],
        ] as const) {
            let minted = false;
            ado.generateIdToken = async () => {
                minted = true;
                return 'mock-oidc-jwt';
            };
            inputs = { ...INPUTS, [field]: bad };

            const handler = new PackerCommandHandlerOCI();
            await assert.rejects(
                () => handler.handleProvider(command()),
                `${field}='${bad}' must be rejected`,
            );
            handler.cleanupTempFiles();
            assert.strictEqual(
                minted,
                false,
                `an OIDC token was requested despite an invalid ${field} -- validation must precede minting`,
            );
        }
    });

    it('refuses an unrecognized authorization scheme', async () => {
        inputs = { ...INPUTS, environmentAuthSchemeOCI: 'Bogus' };
        const handler = new PackerCommandHandlerOCI();
        await assert.rejects(
            () => handler.handleProvider(command()),
            /Unrecognized authorization scheme/,
        );
        handler.cleanupTempFiles();
    });

    it('fails closed when the service connection is absent', async () => {
        let minted = false;
        ado.generateIdToken = async () => {
            minted = true;
            return 'mock-oidc-jwt';
        };
        const handler = new PackerCommandHandlerOCI();
        await assert.rejects(
            () => handler.handleProvider(new PackerAuthorizationCommandInitializer('build', '', '')),
            /service connection is required/,
        );
        handler.cleanupTempFiles();
        assert.strictEqual(minted, false, 'no OIDC token may be requested for an empty connection id');
    });

    it('the API-key branch clears the WIF selectors (the mirror image)', async () => {
        // The API-key branch neutralizes only after its field reads succeed, so
        // this row has to drive it to completion with real endpoint data rather
        // than letting it fail closed early.
        const { privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        const seededEndpoint = {
            ENDPOINT_DATA_OCI_PRIVATEKEY: privateKey.replace(/\n/g, ' ').trim(),
            ENDPOINT_DATA_OCI_TENANCY: 'ocid1.tenancy.oc1..aaaaaaaaexampletenancyocid',
            ENDPOINT_DATA_OCI_USER: 'ocid1.user.oc1..aaaaaaaaexampleuserocid',
            ENDPOINT_DATA_OCI_REGION: 'us-ashburn-1',
            ENDPOINT_DATA_OCI_FINGERPRINT: 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99',
        };
        for (const [k, v] of Object.entries(seededEndpoint)) process.env[k] = v;

        process.env['PKR_VAR_oci_access_cfg_file_account'] = 'inherited';
        process.env['PKR_VAR_oci_security_token_file'] = '/inherited/upst';

        inputs = { environmentAuthSchemeOCI: 'ServiceConnection' };
        const handler = new PackerCommandHandlerOCI();
        try {
            await handler.handleProvider(command());

            // Both directions of the mirror matter: whichever branch runs must not
            // leave the other branch's selectors inherited from the agent.
            for (const name of ['PKR_VAR_oci_access_cfg_file_account', 'PKR_VAR_oci_security_token_file']) {
                assert.strictEqual(
                    process.env[name],
                    undefined,
                    `${name} must be cleared by the API-key branch`,
                );
            }
            // And the API-key branch still pins access_cfg_file at the
            // never-existing path (#333), rather than a synthetic config.
            assert.ok(
                (process.env['PKR_VAR_oci_access_cfg_file'] ?? '').includes('intentionally-absent'),
                'the API-key branch must keep the #333 access_cfg_file pin',
            );
        } finally {
            handler.cleanupTempFiles();
            for (const k of Object.keys(seededEndpoint)) delete process.env[k];
        }
    });
});
