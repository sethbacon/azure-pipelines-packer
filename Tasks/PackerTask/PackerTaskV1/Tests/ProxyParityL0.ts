import * as assert from 'assert';
import * as path from 'path';
import { execFileSync } from 'child_process';
import tasks = require('azure-pipelines-task-lib/task');
import { exchangeOidcForUpst, generateIdToken } from '@4cloudguru/pipeline-task-ado';

/**
 * CLASS TEST — outbound proxy parity (#196).
 *
 * Defect class: an outbound HTTP request is issued through a transport
 * primitive that does NOT consult the ADO agent's configured proxy, in a repo
 * where sibling transports do. Node's global fetch() ignores HTTP_PROXY /
 * HTTPS_PROXY and every agent setting unless handed an undici dispatcher, so
 * "honours the proxy" is a property of the CALL, not of the environment.
 *
 * Two tables, each covering the class rather than one call site:
 *   B. WIF_CALL_ROWS — every WIF outbound call this task makes, driven through
 *                      its REAL entry point with a stubbed fetch, asserting a
 *                      dispatcher arrives when a proxy is configured and does
 *                      NOT when one is not.
 *   C. SITE_ROWS    — every outbound call site the re-runnable signature
 *                     (scripts/check-proxy-parity.js) enumerates in this repo,
 *                     with its verdict.
 *
 * Mutation-provability:
 *   - dropping the `generateIdToken` call's proxy wiring (which now lives in
 *     @4cloudguru/pipeline-task-ado, not this repo) reddens the 'ADO OIDC
 *     token request' row of table B and its two call-site rows in table C.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- monkeypatch the shared task-lib module
const t = tasks as any;

type ProxyConfig = { proxyUrl: string; proxyUsername?: string; proxyPassword?: string };

/**
 * A throwaway public key for the OCI UPST row below. Generated rather than
 * hard-coded because exchangeOidcForUpst exports it as SPKI DER before sending,
 * so it has to be a real key -- but it never leaves this process and is paired
 * with no private half that is kept.
 */
const OCI_WIF_TEST_PUBLIC_KEY = require('crypto').generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).publicKey as string;

/**
 * Table B. Every outbound call this task makes on a WIF path, exercised through
 * its real entry point. Adding a second token exchange means adding a row here,
 * not a new test file — which is the property the previous round's per-site
 * tests lacked.
 */
type WifCallRow = {
    what: string;
    /** Runs the real code path; resolves once the stubbed fetch has been called. */
    invoke: () => Promise<unknown>;
    /**
     * The redirect policy this call is expected to set. Both refuse to follow a
     * 3xx, by different mechanisms: 'error' makes fetch itself throw, while
     * 'manual' surfaces the redirect so the caller can reject it with a specific
     * message and mark it non-retryable. The property under test is "this call
     * does not follow redirects" -- pinning one spelling for every row would
     * make the table assert an implementation rather than the property.
     */
    redirect: 'error' | 'manual';
};
const WIF_CALL_ROWS: WifCallRow[] = [
    {
        what: 'ADO OIDC token request (all four WIF providers)',
        invoke: () => generateIdToken('service-connection-id'),
        redirect: 'error',
    },
    {
        // The second hop of the OCI WIF flow (#344). A real identity-domain host
        // is required: exchangeOidcForUpst validates the destination BEFORE it
        // transmits, so a placeholder host would reject without ever reaching
        // fetch and this row would assert nothing.
        what: 'OCI UPST token exchange',
        invoke: () => exchangeOidcForUpst(
            'oidc-jwt',
            'https://idcs-0123456789abcdef0123456789abcdef.identity.oraclecloud.com',
            'client-id',
            OCI_WIF_TEST_PUBLIC_KEY,
        ),
        // 'manual' rather than 'error' so the handler can reject the redirect
        // with its own message -- "refusing to forward the OIDC token to another
        // origin" -- and mark it non-retryable, instead of a generic fetch throw.
        redirect: 'manual',
    },
];

/** Table C. Every outbound call site the signature enumerates in THIS repo. */
type SiteRow = { file: string; fn: string; sink: string; verdict: string; why: string };
const SITE_ROWS: SiteRow[] = [
    {
        file: 'Tasks/PackerTask/PackerTaskV1/src/azure-packer-command-handler.ts',
        fn: 'handleProvider', sink: 'generateIdToken', verdict: 'PROXIED-BY-PACKAGE',
        why: 'the proxy decision itself now lives in @4cloudguru/pipeline-task-ado (buildAdoFetchOptions), so there is no fetchOptions here to inspect and the site is held to a version floor instead',
    },
    {
        file: 'Tasks/PackerTask/PackerTaskV1/src/base-packer-command-handler.ts',
        fn: 'writeOidcTokenFile', sink: 'generateIdToken', verdict: 'PROXIED-BY-PACKAGE',
        why: 'the same delegated token exchange, called from the AWS/GCP/OCI OIDC-file-writing path',
    },
    {
        file: 'Tasks/PackerInstaller/PackerInstallerV1/src/http-client.ts',
        fn: 'createDefaultClient', sink: 'createAdoHttpClient', verdict: 'PROXIED-BY-PACKAGE',
        why: 'installer transport; the proxy decision itself now lives in pipeline-task-ado, so there is no fetchOptions here to inspect and the site is held to a version floor instead',
    },
    {
        file: 'Tasks/PackerInstaller/PackerInstallerV1/src/http-client.ts',
        fn: 'createRegistryClient', sink: 'createAdoHttpClient', verdict: 'PROXIED-BY-PACKAGE',
        why: 'the same transport with the registry-specific failure message; a second construction is a second site the floor has to cover',
    },
    {
        file: 'Tasks/PackerTask/PackerTaskV1/src/oci-packer-command-handler.ts',
        fn: 'handleProviderWIF', sink: 'generateIdToken', verdict: 'PROXIED-BY-PACKAGE',
        why: 'the OCI WIF path mints its own OIDC token directly rather than via writeOidcTokenFile, because OCI needs the token value for the UPST exchange rather than a file on disk (#344)',
    },
    {
        file: 'Tasks/PackerTask/PackerTaskV1/src/oci-packer-command-handler.ts',
        fn: 'handleProviderWIF', sink: 'exchangeOidcForUpst', verdict: 'PROXIED-BY-PACKAGE',
        why: 'the second hop of the OCI WIF flow: its fetch() and buildAdoFetchOptions call both live in @4cloudguru/pipeline-task-ado, so like generateIdToken it is held to a version floor rather than a local fetchOptions inspection (#344)',
    },
];

describe('outbound proxy parity (class test #196)', function () {
    this.timeout(30000);

    const origProxy = t.getHttpProxyConfiguration;
    const origSetSecret = t.setSecret;
    const origDebug = t.debug;
    const origGetEndpointAuthorizationParameter = t.getEndpointAuthorizationParameter;
    const origLoc = t.loc;
    let originalFetch: typeof globalThis.fetch;
    let originalOidcUri: string | undefined;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        originalOidcUri = process.env['SYSTEM_OIDCREQUESTURI'];
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        if (originalOidcUri === undefined) delete process.env['SYSTEM_OIDCREQUESTURI'];
        else process.env['SYSTEM_OIDCREQUESTURI'] = originalOidcUri;
        t.getHttpProxyConfiguration = origProxy;
        t.setSecret = origSetSecret;
        t.debug = origDebug;
        t.getEndpointAuthorizationParameter = origGetEndpointAuthorizationParameter;
        t.loc = origLoc;
    });

    describe('B. every WIF outbound call, driven through its real entry point', () => {
        /** Stubs the agent surface an OIDC exchange needs and captures the RequestInit. */
        function armFetchCapture(proxy: ProxyConfig | undefined): { inits: RequestInit[] } {
            const inits: RequestInit[] = [];
            process.env['SYSTEM_OIDCREQUESTURI'] = 'https://vstoken.dev.azure.com/oidc';
            t.debug = () => { /* silence */ };
            t.setSecret = () => { /* not under test here */ };
            t.loc = (k: string) => k;
            t.getEndpointAuthorizationParameter = () => 'access-token';
            t.getHttpProxyConfiguration = () => proxy;
            globalThis.fetch = (async (_url: string, init: RequestInit) => {
                inits.push(init);
                // Carries the success shape of BOTH hops: `oidcToken` for the ADO
                // token request, `access_token` for the OCI UPST exchange. Each
                // row reads only its own field, and a row that threw before
                // reaching fetch would fail the assertion below rather than
                // silently passing.
                return new Response(
                    JSON.stringify({ oidcToken: 'federated-token', access_token: 'upst-token' }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }) as unknown as typeof globalThis.fetch;
            return { inits };
        }

        for (const row of WIF_CALL_ROWS) {
            it(`${row.what} is routed through the agent proxy when one is configured`, async () => {
                const captured = armFetchCapture({
                    proxyUrl: 'http://proxy.example.com:8080',
                    proxyUsername: 'user',
                    proxyPassword: 'p@ss',
                });
                await row.invoke();
                assert.ok(captured.inits.length > 0, 'the stubbed fetch was never called');
                for (const init of captured.inits) {
                    assert.ok(init && 'dispatcher' in init,
                        `${row.what}: fetch was called without a proxy dispatcher — Node's global fetch would bypass the agent proxy`);
                }
            });

            it(`${row.what} connects directly when no proxy is configured`, async () => {
                const captured = armFetchCapture(undefined);
                await row.invoke();
                assert.ok(captured.inits.length > 0, 'the stubbed fetch was never called');
                for (const init of captured.inits) {
                    assert.ok(init && !('dispatcher' in init),
                        `${row.what}: a dispatcher was attached with no proxy configured`);
                }
            });

            it(`${row.what} keeps its existing transport hardening`, async () => {
                const captured = armFetchCapture({ proxyUrl: 'http://proxy.example.com:8080' });
                await row.invoke();
                for (const init of captured.inits) {
                    // The proxy fix must not relax the redirect policy: a 3xx could
                    // otherwise forward the System.AccessToken bearer header to an
                    // unvalidated hop through the proxy.
                    assert.strictEqual(init.redirect, row.redirect,
                        `${row.what}: redirect policy was weakened by the proxy change`);
                    assert.ok(init.signal, `${row.what}: the abort signal (30s timeout) was dropped`);
                }
            });
        }
    });

    describe('C. every enumerated outbound call site in this repo', () => {
        // The signature exits non-zero when it finds residuals, and execFileSync
        // throws on a non-zero exit — capture stdout from the error so a residual
        // fails an ASSERTION below rather than aborting the whole suite at load.
        let stdout: string;
        try {
            stdout = execFileSync(
                process.execPath,
                [path.join(REPO_ROOT, 'scripts/check-proxy-parity.js'), REPO_ROOT, '--json'],
                { encoding: 'utf8' },
            );
        } catch (err) {
            stdout = String((err as { stdout?: string }).stdout ?? '');
            assert.ok(stdout.trim().startsWith('{'), `signature produced no JSON: ${String(err)}`);
        }
        const report = JSON.parse(stdout) as {
            sites: Array<{ rel: string; fn: string; sink: string; verdict: string }>;
            failures: number;
        };

        it('leaves no unproxied outbound call site anywhere in src/', () => {
            assert.strictEqual(report.failures, 0,
                `residual unproxied call sites:\n${JSON.stringify(report.sites.filter(s => s.verdict === 'UNPROXIED'), null, 2)}`);
        });

        it('enumerates exactly the sites this table accounts for', () => {
            const seen = report.sites.map(s => `${s.rel}:${s.fn}:${s.sink}`).sort();
            const known = SITE_ROWS.map(s => `${s.file}:${s.fn}:${s.sink}`).sort();
            assert.deepStrictEqual(seen, known,
                'a new outbound call site appeared (or one vanished) — add it to SITE_ROWS with its verdict and reason');
        });

        for (const row of SITE_ROWS) {
            it(`${row.fn}() -> ${row.sink}() is ${row.verdict}`, () => {
                const site = report.sites.find(s => s.rel === row.file && s.fn === row.fn && s.sink === row.sink);
                assert.ok(site, `site not found: ${row.file} ${row.fn} -> ${row.sink}`);
                assert.strictEqual(site!.verdict, row.verdict, row.why);
            });
        }
    });
});
