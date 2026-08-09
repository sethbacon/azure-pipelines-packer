import * as assert from 'assert';
import * as path from 'path';
import { execFileSync } from 'child_process';
import tasks = require('azure-pipelines-task-lib/task');
import { buildProxyFetchOptions } from '../src/proxy-config';
import { generateIdToken } from '../src/id-token-generator';

/**
 * CLASS TEST — outbound proxy parity (#196).
 *
 * Defect class: an outbound HTTP request is issued through a transport
 * primitive that does NOT consult the ADO agent's configured proxy, in a repo
 * where sibling transports do. Node's global fetch() ignores HTTP_PROXY /
 * HTTPS_PROXY and every agent setting unless handed an undici dispatcher, so
 * "honours the proxy" is a property of the CALL, not of the environment.
 *
 * Three tables, each covering the class rather than one call site:
 *   A. BUILDER_ROWS — the proxy-options builder itself, including the two
 *                     setSecret registrations (raw + percent-encoded password).
 *   B. WIF_CALL_ROWS — every WIF outbound call this task makes, driven through
 *                      its REAL entry point with a stubbed fetch, asserting a
 *                      dispatcher arrives when a proxy is configured and does
 *                      NOT when one is not.
 *   C. SITE_ROWS    — every outbound call site the re-runnable signature
 *                     (scripts/check-proxy-parity.js) enumerates in this repo,
 *                     with its verdict.
 *
 * Mutation-provability:
 *   - dropping `...buildProxyFetchOptions()` from id-token-generator.ts's fetch
 *     reddens the 'ADO OIDC token request' row of table B and its
 *     id-token-generator.ts row in table C, and nothing else;
 *   - inverting `if (!proxy) return {}` in proxy-config.ts reddens exactly the
 *     'no proxy configured' rows of tables A and B.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- monkeypatch the shared task-lib module
const t = tasks as any;

type ProxyConfig = { proxyUrl: string; proxyUsername?: string; proxyPassword?: string };

/**
 * Table A. `undefined` proxy rows go RED if the no-proxy early return is
 * inverted; the credential rows go RED if either setSecret registration is
 * dropped; the malformed row goes RED if the URL parse stops being guarded.
 */
type BuilderRow = {
    what: string;
    proxy: ProxyConfig | undefined;
    dispatcher: boolean;
    masks?: string[];
    throws?: RegExp;
};
const BUILDER_ROWS: BuilderRow[] = [
    { what: 'no proxy configured', proxy: undefined, dispatcher: false },
    {
        what: 'an unauthenticated proxy',
        proxy: { proxyUrl: 'http://proxy.example.com:8080', proxyUsername: '', proxyPassword: '' },
        dispatcher: true,
    },
    {
        what: 'an authenticated proxy (raw password masked)',
        proxy: { proxyUrl: 'http://proxy.example.com:8080', proxyUsername: 'user', proxyPassword: 'p@ss' },
        dispatcher: true,
        masks: ['p@ss'],
    },
    {
        // 'p@ss' -> 'p%40ss': the WHATWG URL password setter percent-encodes '@',
        // and that encoded string -- not the raw password -- is what the proxy URL
        // actually embeds. ADO masks literal registered strings only.
        what: 'an authenticated proxy (percent-encoded password also masked)',
        proxy: { proxyUrl: 'http://proxy.example.com:8080', proxyUsername: 'user', proxyPassword: 'p@ss' },
        dispatcher: true,
        masks: ['p@ss', 'p%40ss'],
    },
    {
        what: 'a malformed proxy URL',
        proxy: { proxyUrl: 'not a url', proxyUsername: 'user', proxyPassword: 'p@ss' },
        dispatcher: false,
        throws: /Invalid proxy URL/,
    },
];

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
};
const WIF_CALL_ROWS: WifCallRow[] = [
    {
        what: 'ADO OIDC token request (all three WIF providers)',
        invoke: () => generateIdToken('service-connection-id'),
    },
];

/** Table C. Every outbound call site the signature enumerates in THIS repo. */
type SiteRow = { file: string; fn: string; sink: string; verdict: string; why: string };
const SITE_ROWS: SiteRow[] = [
    {
        file: 'Tasks/PackerTask/PackerTaskV1/src/id-token-generator.ts',
        fn: 'fetchToken', sink: 'fetch', verdict: 'PROXIED',
        why: 'the reported site of #196: spreads buildProxyFetchOptions() while keeping redirect:\'error\' and the https-only assertion',
    },
    {
        file: 'Tasks/PackerInstaller/PackerInstallerV1/src/http-client.ts',
        fn: 'fetchWithTimeout', sink: 'fetch', verdict: 'PROXIED',
        why: 'the installer transport that was already proxy-aware, and the parity this class is measured against',
    },
    {
        file: 'Tasks/PackerInstaller/PackerInstallerV1/src/packer-installer.ts',
        fn: 'downloadToolWithTimeout', sink: 'downloadTool', verdict: 'EXEMPT-TOOL-LIB',
        why: 'azure-pipelines-tool-lib/tool.js constructs its HttpClient with proxy: tl.getHttpProxyConfiguration(), so the proxy is applied inside the library',
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

    describe('A. the proxy-options builder', () => {
        for (const row of BUILDER_ROWS) {
            it(`${row.throws ? 'rejects' : 'handles'} ${row.what}`, () => {
                const masked: string[] = [];
                t.setSecret = (v: string) => masked.push(v);
                t.getHttpProxyConfiguration = () => row.proxy;

                if (row.throws) {
                    assert.throws(() => buildProxyFetchOptions(), row.throws);
                    return;
                }
                const options = buildProxyFetchOptions();
                assert.strictEqual('dispatcher' in options, row.dispatcher,
                    `expected dispatcher presence to be ${row.dispatcher} for ${row.what}`);
                for (const secret of row.masks ?? []) {
                    assert.ok(masked.includes(secret),
                        `expected '${secret}' to be registered with setSecret; got ${JSON.stringify(masked)}`);
                }
            });
        }
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
                return new Response(JSON.stringify({ oidcToken: 'federated-token' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
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
                    assert.strictEqual(init.redirect, 'error',
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
