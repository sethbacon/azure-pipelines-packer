import * as assert from 'assert';
import * as crypto from 'crypto';
import * as path from 'path';
import { execFileSync } from 'child_process';
import tasks = require('azure-pipelines-task-lib/task');
import idTokenGeneratorModule = require('@4cloudguru/pipeline-task-ado');
import { PackerCommandHandlerAzureRM } from '../src/azure-packer-command-handler';
import { PackerCommandHandlerAWS } from '../src/aws-packer-command-handler';
import { PackerCommandHandlerGCP } from '../src/gcp-packer-command-handler';
import { PackerCommandHandlerOCI } from '../src/oci-packer-command-handler';
import { PackerCommandHandlerVSphere } from '../src/vsphere-packer-command-handler';
import { PackerCommandHandlerNone } from '../src/none-packer-command-handler';
import { BasePackerCommandHandler } from '../src/base-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';
import { EnvironmentVariableHelper } from '@4cloudguru/pipeline-task-ado';

/**
 * THE CLASS TEST for the provider-auth fail-open defect class
 * (#97 / #187 / #194 / #199 / #44 / #197).
 *
 * Its rows ARE the cells of the (handler x auth-branch x required-field) matrix
 * that `scripts/auth-parity-matrix.cjs` enumerates -- not the individual call
 * sites named in the issues. #97 reopened because its first fix hardened one
 * branch of one file and its test asserted that one branch; the sibling WIF
 * branch of the same file stayed fail-open and stayed green. A per-site test
 * that passes while its sibling is broken is worse than no test, so every
 * branch of every handler gets a row here, driven from one table.
 *
 * Each row is mutation-provable: invert the predicate of the guard the row
 * names and the row turns RED, because the row asserts the REJECTION, not the
 * happy path. The `complete` control row per handler proves the guards do not
 * simply reject everything.
 */
describe('credential fail-closed matrix (handler x auth-branch x required-field)', function () {
    this.timeout(20000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monkeypatch the shared task-lib module
    const t = tasks as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itg = idTokenGeneratorModule as any;

    const orig = {
        debug: t.debug,
        warning: t.warning,
        setSecret: t.setSecret,
        getInput: t.getInput,
        getBoolInput: t.getBoolInput,
        getVariable: t.getVariable,
        getEndpointAuthorizationParameter: t.getEndpointAuthorizationParameter,
        getEndpointAuthorizationScheme: t.getEndpointAuthorizationScheme,
        getEndpointDataParameter: t.getEndpointDataParameter,
        getEndpointUrl: t.getEndpointUrl,
        generateIdToken: itg.generateIdToken,
    };

    /** A real RSA key: the OCI/GCP handlers run normalizePem for real. */
    const { privateKey: REAL_PEM } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    interface Fixture {
        inputs?: Record<string, string>;
        bools?: Record<string, boolean>;
        vars?: Record<string, string>;
        auth?: Record<string, string>;
        data?: Record<string, string>;
        url?: string;
        scheme?: string;
        /** Pre-existing agent/passthrough environment for the neutralization rows. */
        env?: Record<string, string>;
        serviceConnection?: string;
    }

    let active: Fixture = {};
    const touchedEnv = new Set<string>();

    function install(fixture: Fixture): void {
        active = fixture;
        t.debug = () => { /* silence */ };
        t.warning = () => { /* silence */ };
        t.setSecret = () => { /* no-op: masking is covered by its own tests */ };
        t.getInput = (name: string, required?: boolean) => {
            const v = fixture.inputs?.[name];
            if (required && !v) throw new Error(`Input required: ${name}`);
            return v;
        };
        t.getBoolInput = (name: string) => fixture.bools?.[name] ?? false;
        t.getVariable = (name: string) => fixture.vars?.[name];
        t.getEndpointAuthorizationParameter = (_id: string, key: string, optional: boolean) => {
            const v = fixture.auth?.[key];
            if (!optional && !v) throw new Error(`LIB_EndpointAuthNotExist: ${key}`);
            return v;
        };
        t.getEndpointAuthorizationScheme = (_id: string, optional: boolean) => {
            const v = fixture.scheme;
            if (!optional && !v) throw new Error('LIB_EndpointAuthNotExist: scheme');
            return v;
        };
        t.getEndpointDataParameter = (_id: string, key: string, optional: boolean) => {
            const v = fixture.data?.[key];
            if (!optional && !v) throw new Error(`LIB_EndpointDataNotExist: ${key}`);
            return v;
        };
        t.getEndpointUrl = (_id: string, optional: boolean) => {
            const v = fixture.url;
            if (!optional && !v) throw new Error('LIB_EndpointNotExist');
            return v;
        };
        itg.generateIdToken = async () => 'mock-oidc-jwt-for-matrix';
        // Data parameters are ALSO provisioned through the real ENDPOINT_DATA_*
        // channel, not only through the getEndpointDataParameter stub above: a
        // SECRET data field is read by readSecretEndpointDataParameter straight from
        // process.env, because task-lib's accessor debug-logs the value at read time
        // and leaves it for the child to inherit (#185/#195, endpoint-data-secret.ts).
        // Stubbing only the accessor would make the absent-credential rows below pass
        // against a channel production never uses. Same provisioning as
        // OciMultilinePemAuth.ts; the `without(..., 'data', k)` mutation drops the
        // field from BOTH channels, so each row stays red when its guard is inverted.
        if (fixture.serviceConnection) {
            for (const [k, v] of Object.entries(fixture.data ?? {})) {
                const name = `ENDPOINT_DATA_${fixture.serviceConnection}_${k.toUpperCase()}`;
                process.env[name] = v;
                touchedEnv.add(name);
            }
        }
        for (const [k, v] of Object.entries(fixture.env ?? {})) {
            process.env[k] = v;
            touchedEnv.add(k);
        }
    }

    afterEach(() => {
        Object.assign(t, {
            debug: orig.debug,
            warning: orig.warning,
            setSecret: orig.setSecret,
            getInput: orig.getInput,
            getBoolInput: orig.getBoolInput,
            getVariable: orig.getVariable,
            getEndpointAuthorizationParameter: orig.getEndpointAuthorizationParameter,
            getEndpointAuthorizationScheme: orig.getEndpointAuthorizationScheme,
            getEndpointDataParameter: orig.getEndpointDataParameter,
            getEndpointUrl: orig.getEndpointUrl,
        });
        itg.generateIdToken = orig.generateIdToken;
        EnvironmentVariableHelper.clearTrackedVariables();
        for (const k of touchedEnv) delete process.env[k];
        touchedEnv.clear();
        active = {};
    });

    // --- complete, valid fixtures: one per (handler, auth-branch) -------------

    const COMPLETE: Record<string, Fixture> = {
        'azure.WorkloadIdentityFederation': {
            inputs: { environmentServiceNameAzureRM: 'AzureRM' },
            scheme: 'WorkloadIdentityFederation',
            auth: { serviceprincipalid: 'e7a1b2c3-0000-4444-8888-99990000aaaa', tenantid: '11112222-3333-4444-5555-666677778888' },
            data: { subscriptionid: 'aaaabbbb-cccc-dddd-eeee-ffff00001111' },
        },
        'azure.ServicePrincipal': {
            inputs: { environmentServiceNameAzureRM: 'AzureRM' },
            scheme: 'ServicePrincipal',
            auth: {
                serviceprincipalid: 'e7a1b2c3-0000-4444-8888-99990000aaaa',
                serviceprincipalkey: 'sp-secret-value',
                tenantid: '11112222-3333-4444-5555-666677778888',
            },
            data: { subscriptionid: 'aaaabbbb-cccc-dddd-eeee-ffff00001111' },
        },
        'azure.ManagedServiceIdentity': {
            inputs: { environmentServiceNameAzureRM: 'AzureRM' },
            scheme: 'ManagedServiceIdentity',
            data: { subscriptionid: 'aaaabbbb-cccc-dddd-eeee-ffff00001111' },
        },
        'aws.static': {
            serviceConnection: 'AWS',
            inputs: {},
            auth: { username: 'AKIAEXAMPLEKEYID', password: 'example-secret-access-key', region: 'us-east-1' },
        },
        'aws.WorkloadIdentityFederation': {
            serviceConnection: 'AWS',
            inputs: {
                environmentAuthSchemeAWS: 'WorkloadIdentityFederation',
                awsRoleArn: 'arn:aws:iam::123456789012:role/packer-builder',
                awsRegion: 'us-east-1',
            },
            vars: { 'System.TeamProject': 'Contoso Images', 'Build.BuildId': '4242' },
        },
        'gcp.static': {
            serviceConnection: 'GCP',
            inputs: {},
            auth: {
                Issuer: 'packer@example.iam.gserviceaccount.com',
                Audience: 'https://oauth2.googleapis.com/token',
                PrivateKey: REAL_PEM as string,
            },
        },
        'gcp.WorkloadIdentityFederation': {
            serviceConnection: 'GCP',
            inputs: {
                environmentAuthSchemeGCP: 'WorkloadIdentityFederation',
                gcpProjectNumber: '123456789012',
                gcpWorkloadIdentityPoolId: 'ado-pool',
                gcpWorkloadIdentityProviderId: 'ado-provider',
                gcpServiceAccountEmail: 'packer@example.iam.gserviceaccount.com',
            },
        },
        'oci.static': {
            serviceConnection: 'OCI',
            inputs: {},
            data: {
                privateKey: (REAL_PEM as string).replace(/\n/g, ' ').trim(),
                tenancy: 'ocid1.tenancy.oc1..aaaaaaaaexampletenancyocid',
                user: 'ocid1.user.oc1..aaaaaaaaexampleuserocid',
                region: 'us-ashburn-1',
                fingerprint: 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99',
            },
        },
        'vsphere.static': {
            serviceConnection: 'vsphere',
            inputs: {},
            url: 'https://vcenter.example.com/',
            auth: { username: 'admin@vsphere.local', password: 'vcenter-password' },
        },
    };

    function clone(base: Fixture): Fixture {
        return JSON.parse(JSON.stringify(base)) as Fixture;
    }

    function makeHandler(handler: string): BasePackerCommandHandler {
        switch (handler) {
            case 'azure': return new PackerCommandHandlerAzureRM();
            case 'aws': return new PackerCommandHandlerAWS();
            case 'gcp': return new PackerCommandHandlerGCP();
            case 'oci': return new PackerCommandHandlerOCI();
            case 'vsphere': return new PackerCommandHandlerVSphere();
            case 'none': return new PackerCommandHandlerNone();
            default: throw new Error(`unknown handler ${handler}`);
        }
    }

    async function run(handler: string, fixture: Fixture): Promise<BasePackerCommandHandler> {
        const impl = makeHandler(handler);
        install(fixture);
        try {
            await impl.handleProvider(new PackerAuthorizationCommandInitializer('build', '', fixture.serviceConnection ?? ''));
        } finally {
            impl.cleanupTempFiles();
        }
        return impl;
    }

    /** Removes one field from a complete fixture -- the "absent credential" mutation. */
    function without(base: string, bucket: 'inputs' | 'auth' | 'data' | 'url' | 'scheme' | 'serviceConnection', key?: string): Fixture {
        const f = clone(COMPLETE[base]);
        if (bucket === 'url' || bucket === 'scheme' || bucket === 'serviceConnection') delete f[bucket];
        else delete (f[bucket] as Record<string, string>)?.[key!];
        return f;
    }

    /** Replaces one field with an HCL-expression-bearing value -- the "malformed" mutation. */
    function malformed(base: string, bucket: 'inputs' | 'auth' | 'data', key: string): Fixture {
        const f = clone(COMPLETE[base]);
        (f[bucket] as Record<string, string>)[key] = '${file("/etc/passwd")}';
        return f;
    }

    // --- ROWS: every required field of every branch must fail closed ----------

    interface Row {
        site: string;
        handler: string;
        fixture: () => Fixture;
    }

    const REJECT_ROWS: Row[] = [
        // #97 -- the reopened cell and its siblings. The WIF branch is the one
        // whose guard was missing while ServicePrincipal's was present.
        { site: 'azure.WorkloadIdentityFederation.serviceprincipalid', handler: 'azure', fixture: () => without('azure.WorkloadIdentityFederation', 'auth', 'serviceprincipalid') },
        { site: 'azure.WorkloadIdentityFederation.tenantid', handler: 'azure', fixture: () => without('azure.WorkloadIdentityFederation', 'auth', 'tenantid') },
        { site: 'azure.ServicePrincipal.serviceprincipalid', handler: 'azure', fixture: () => without('azure.ServicePrincipal', 'auth', 'serviceprincipalid') },
        { site: 'azure.ServicePrincipal.serviceprincipalkey', handler: 'azure', fixture: () => without('azure.ServicePrincipal', 'auth', 'serviceprincipalkey') },
        { site: 'azure.ServicePrincipal.tenantid', handler: 'azure', fixture: () => without('azure.ServicePrincipal', 'auth', 'tenantid') },
        { site: 'azure.schemeResolution.authorizationScheme', handler: 'azure', fixture: () => without('azure.WorkloadIdentityFederation', 'scheme') },
        // #199 -- value validation, not just presence.
        { site: 'azure.WorkloadIdentityFederation.serviceprincipalid[malformed]', handler: 'azure', fixture: () => malformed('azure.WorkloadIdentityFederation', 'auth', 'serviceprincipalid') },
        { site: 'azure.handleProvider.subscriptionid[malformed]', handler: 'azure', fixture: () => malformed('azure.WorkloadIdentityFederation', 'data', 'subscriptionid') },
        { site: 'azure.ServicePrincipal.tenantid[malformed]', handler: 'azure', fixture: () => malformed('azure.ServicePrincipal', 'auth', 'tenantid') },

        { site: 'aws.static.username', handler: 'aws', fixture: () => without('aws.static', 'auth', 'username') },
        { site: 'aws.static.password', handler: 'aws', fixture: () => without('aws.static', 'auth', 'password') },
        { site: 'aws.static.username[malformed]', handler: 'aws', fixture: () => malformed('aws.static', 'auth', 'username') },
        { site: 'aws.static.region[malformed]', handler: 'aws', fixture: () => malformed('aws.static', 'auth', 'region') },
        { site: 'aws.static.serviceConnection', handler: 'aws', fixture: () => without('aws.static', 'serviceConnection') },
        { site: 'aws.WorkloadIdentityFederation.serviceConnection', handler: 'aws', fixture: () => without('aws.WorkloadIdentityFederation', 'serviceConnection') },
        { site: 'aws.WorkloadIdentityFederation.awsRoleArn', handler: 'aws', fixture: () => without('aws.WorkloadIdentityFederation', 'inputs', 'awsRoleArn') },
        { site: 'aws.WorkloadIdentityFederation.awsRegion', handler: 'aws', fixture: () => without('aws.WorkloadIdentityFederation', 'inputs', 'awsRegion') },
        { site: 'aws.WorkloadIdentityFederation.awsRoleArn[malformed]', handler: 'aws', fixture: () => malformed('aws.WorkloadIdentityFederation', 'inputs', 'awsRoleArn') },
        // #197 -- an explicit session name outside AWS's grammar must fail here,
        // not as an opaque STS rejection mid-build.
        {
            site: 'aws.WorkloadIdentityFederation.roleSessionName[malformed]', handler: 'aws', fixture: () => {
                const f = clone(COMPLETE['aws.WorkloadIdentityFederation']);
                f.inputs!.awsSessionName = 'not a valid session name!';
                return f;
            }
        },

        { site: 'gcp.static.serviceConnection', handler: 'gcp', fixture: () => without('gcp.static', 'serviceConnection') },
        { site: 'gcp.static.Issuer', handler: 'gcp', fixture: () => without('gcp.static', 'auth', 'Issuer') },
        { site: 'gcp.static.Audience', handler: 'gcp', fixture: () => without('gcp.static', 'auth', 'Audience') },
        { site: 'gcp.static.PrivateKey', handler: 'gcp', fixture: () => without('gcp.static', 'auth', 'PrivateKey') },
        {
            // The Audience becomes `token_uri` in the credentials file -- the URL the
            // Google SDK POSTs the signed assertion to. Terraform's GCP handler has
            // always constrained it; packer's had not (#199).
            site: 'gcp.static.Audience[foreign-origin]', handler: 'gcp', fixture: () => {
                const f = clone(COMPLETE['gcp.static']);
                f.auth!.Audience = 'https://attacker.example.com/token';
                return f;
            }
        },
        { site: 'gcp.WorkloadIdentityFederation.serviceConnection', handler: 'gcp', fixture: () => without('gcp.WorkloadIdentityFederation', 'serviceConnection') },
        { site: 'gcp.WorkloadIdentityFederation.gcpProjectNumber', handler: 'gcp', fixture: () => without('gcp.WorkloadIdentityFederation', 'inputs', 'gcpProjectNumber') },
        { site: 'gcp.WorkloadIdentityFederation.gcpServiceAccountEmail[malformed]', handler: 'gcp', fixture: () => malformed('gcp.WorkloadIdentityFederation', 'inputs', 'gcpServiceAccountEmail') },

        { site: 'oci.static.serviceConnection', handler: 'oci', fixture: () => without('oci.static', 'serviceConnection') },
        { site: 'oci.static.privateKey', handler: 'oci', fixture: () => without('oci.static', 'data', 'privateKey') },
        { site: 'oci.static.tenancy', handler: 'oci', fixture: () => without('oci.static', 'data', 'tenancy') },
        { site: 'oci.static.user', handler: 'oci', fixture: () => without('oci.static', 'data', 'user') },
        { site: 'oci.static.region', handler: 'oci', fixture: () => without('oci.static', 'data', 'region') },
        { site: 'oci.static.fingerprint', handler: 'oci', fixture: () => without('oci.static', 'data', 'fingerprint') },
        { site: 'oci.static.tenancy[malformed]', handler: 'oci', fixture: () => malformed('oci.static', 'data', 'tenancy') },

        { site: 'vsphere.static.serviceConnection', handler: 'vsphere', fixture: () => without('vsphere.static', 'serviceConnection') },
        { site: 'vsphere.static.url', handler: 'vsphere', fixture: () => without('vsphere.static', 'url') },
        { site: 'vsphere.static.username', handler: 'vsphere', fixture: () => without('vsphere.static', 'auth', 'username') },
        { site: 'vsphere.static.password', handler: 'vsphere', fixture: () => without('vsphere.static', 'auth', 'password') },
        { site: 'vsphere.static.username[malformed]', handler: 'vsphere', fixture: () => malformed('vsphere.static', 'auth', 'username') },
    ];

    for (const row of REJECT_ROWS) {
        it(`fails closed: ${row.site}`, async () => {
            await assert.rejects(
                () => run(row.handler, row.fixture()),
                `${row.site}: an absent or malformed credential field must fail the task, not degrade to ambient credentials`);
        });
    }

    // --- CONTROL ROWS: the guards must accept a complete configuration --------

    const ACCEPT_ROWS: Array<{ site: string; handler: string; fixture: () => Fixture }> = [
        { site: 'azure.WorkloadIdentityFederation.complete', handler: 'azure', fixture: () => clone(COMPLETE['azure.WorkloadIdentityFederation']) },
        { site: 'azure.ServicePrincipal.complete', handler: 'azure', fixture: () => clone(COMPLETE['azure.ServicePrincipal']) },
        { site: 'azure.ManagedServiceIdentity.complete', handler: 'azure', fixture: () => clone(COMPLETE['azure.ManagedServiceIdentity']) },
        { site: 'aws.static.complete', handler: 'aws', fixture: () => clone(COMPLETE['aws.static']) },
        // #194: awsRegion and the connection's `region` are BOTH legitimately
        // optional. This configuration is valid and must NOT abort in the
        // credential path -- the opposite direction from every row above, and the
        // reason the fail-closed guards are placed on identity fields only.
        { site: 'aws.static.region[absent-is-valid]', handler: 'aws', fixture: () => without('aws.static', 'auth', 'region') },
        { site: 'aws.WorkloadIdentityFederation.complete', handler: 'aws', fixture: () => clone(COMPLETE['aws.WorkloadIdentityFederation']) },
        { site: 'gcp.static.complete', handler: 'gcp', fixture: () => clone(COMPLETE['gcp.static']) },
        { site: 'gcp.WorkloadIdentityFederation.complete', handler: 'gcp', fixture: () => clone(COMPLETE['gcp.WorkloadIdentityFederation']) },
        { site: 'oci.static.complete', handler: 'oci', fixture: () => clone(COMPLETE['oci.static']) },
        { site: 'vsphere.static.complete', handler: 'vsphere', fixture: () => clone(COMPLETE['vsphere.static']) },
        // The one code-verified exemption in the matrix: local/hypervisor builders
        // authenticate to nothing, so this handler has no cell to guard.
        { site: 'none.handleProvider.no-credentials[exempt]', handler: 'none', fixture: () => ({}) },
    ];

    for (const row of ACCEPT_ROWS) {
        it(`accepts a complete configuration: ${row.site}`, async () => {
            await run(row.handler, row.fixture());
        });
    }

    // --- NEUTRALIZATION ROWS (#187) ------------------------------------------
    // Setting the right credentials is not enough when a competing variable
    // out-ranks them in the provider SDK's own resolution order.

    const NEUTRALIZE_ROWS: Array<{ site: string; handler: string; base: string; competing: string[] }> = [
        {
            site: 'aws.WorkloadIdentityFederation.competing-credential-env', handler: 'aws', base: 'aws.WorkloadIdentityFederation',
            competing: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_SHARED_CREDENTIALS_FILE'],
        },
        {
            site: 'aws.static.competing-credential-env', handler: 'aws', base: 'aws.static',
            competing: ['AWS_WEB_IDENTITY_TOKEN_FILE', 'AWS_ROLE_ARN', 'AWS_SESSION_TOKEN'],
        },
        {
            // packer-plugin-azure's UseMSI() only holds while these are ALL unset.
            site: 'azure.ManagedServiceIdentity.competing-credential-env', handler: 'azure', base: 'azure.ManagedServiceIdentity',
            competing: ['PKR_VAR_arm_client_secret', 'PKR_VAR_arm_client_jwt', 'PKR_VAR_arm_client_cert_path', 'PKR_VAR_arm_tenant_id'],
        },
        {
            site: 'azure.WorkloadIdentityFederation.competing-credential-env', handler: 'azure', base: 'azure.WorkloadIdentityFederation',
            competing: ['PKR_VAR_arm_client_secret', 'PKR_VAR_arm_client_cert_path'],
        },
        {
            site: 'azure.ServicePrincipal.competing-credential-env', handler: 'azure', base: 'azure.ServicePrincipal',
            competing: ['PKR_VAR_arm_client_jwt', 'PKR_VAR_arm_client_cert_path'],
        },
        {
            site: 'gcp.static.competing-credential-env', handler: 'gcp', base: 'gcp.static',
            competing: ['GOOGLE_CREDENTIALS', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'CLOUDSDK_AUTH_ACCESS_TOKEN'],
        },
        {
            site: 'gcp.WorkloadIdentityFederation.competing-credential-env', handler: 'gcp', base: 'gcp.WorkloadIdentityFederation',
            competing: ['GOOGLE_CREDENTIALS', 'GOOGLE_OAUTH_ACCESS_TOKEN'],
        },
        {
            site: 'oci.static.competing-credential-env', handler: 'oci', base: 'oci.static',
            competing: ['OCI_CLI_CONFIG_FILE', 'OCI_CLI_PROFILE', 'OCI_CLI_TENANCY', 'OCI_CLI_KEY_FILE'],
        },
        {
            // #44/#187: an inherited insecure-connection flag would disable vCenter
            // TLS verification for a build whose operator never enabled the toggle.
            site: 'vsphere.static.competing-credential-env', handler: 'vsphere', base: 'vsphere.static',
            competing: ['PKR_VAR_vsphere_insecure_connection'],
        },
    ];

    for (const row of NEUTRALIZE_ROWS) {
        it(`clears competing identity env vars: ${row.site}`, async () => {
            const fixture = clone(COMPLETE[row.base]);
            fixture.env = Object.fromEntries(row.competing.map((name) => [name, 'inherited-from-agent']));
            await run(row.handler, fixture);
            for (const name of row.competing) {
                assert.strictEqual(process.env[name], undefined,
                    `${row.site}: '${name}' was inherited from the agent and can out-rank the credentials this branch injects; it must be cleared`);
            }
        });
    }

    // --- SESSION-NAME ROW (#197) ---------------------------------------------

    it('derives a per-run role session name instead of a shared constant: aws.WorkloadIdentityFederation.roleSessionName', async () => {
        await run('aws', clone(COMPLETE['aws.WorkloadIdentityFederation']));
        const sessionName = process.env['AWS_ROLE_SESSION_NAME'];
        assert.ok(sessionName, 'AWS_ROLE_SESSION_NAME must be set on the WIF path');
        assert.notStrictEqual(sessionName, 'AzureDevOps-Packer',
            'a fixed constant collapses CloudTrail attribution across every federated build of every pipeline');
        assert.ok(sessionName!.includes('4242'),
            `the session name must identify the run (CloudTrail userIdentity.arn pivot); got '${sessionName}'`);
        assert.ok(/^[\w+=,.@-]{2,64}$/.test(sessionName!),
            `the session name must satisfy AWS's RoleSessionName grammar; got '${sessionName}'`);
    });

    it('honours an explicit, valid role session name', async () => {
        const fixture = clone(COMPLETE['aws.WorkloadIdentityFederation']);
        fixture.inputs!.awsSessionName = 'release-pipeline-42';
        await run('aws', fixture);
        assert.strictEqual(process.env['AWS_ROLE_SESSION_NAME'], 'release-pipeline-42');
    });

    // --- STRUCTURAL ROW: the matrix itself must have no unguarded cell --------
    // This is what keeps the table above honest: a NEW handler, or a new branch
    // in an existing one, appears as a new matrix cell and fails here until it
    // is guarded or carries a code-verified @credential-exempt marker.

    it('scripts/auth-parity-matrix.cjs reports zero UNGUARDED cells', () => {
        const script = path.resolve(__dirname, '../../../../scripts/auth-parity-matrix.cjs');
        const repoRoot = path.resolve(__dirname, '../../../..');
        const out = execFileSync(process.execPath, [script, repoRoot, '--json'], { encoding: 'utf8' });
        const report = JSON.parse(out) as {
            cells: Array<{ site: string; verdict: string; detail: string }>;
            unguarded: number;
        };
        assert.ok(report.cells.length > 0, 'the signature must enumerate at least one cell');
        assert.strictEqual(report.unguarded, 0,
            'unguarded credential cells: ' + report.cells.filter((c) => c.verdict === 'UNGUARDED')
                .map((c) => `${c.site} (${c.detail})`).join('; '));
    });
});
