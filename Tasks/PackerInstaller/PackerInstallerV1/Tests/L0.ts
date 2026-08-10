import * as assert from 'assert';
import * as fs from 'fs';
import * as ttm from 'azure-pipelines-task-lib/mock-test';
import * as os from 'os';
import * as path from 'path';
import * as openpgp from 'openpgp';
import { fetchWithTimeout, fetchJson, fetchText, fetchTextAllow404, fetchBuffer, downloadToFile } from '../src/http-client';
import { HASHICORP_GPG_PUBLIC_KEY } from '../src/hashicorp-gpg-key';
import { downloadToolWithTimeout, redactUrl } from '../src/packer-installer';
import { parseAllowedHosts, isRegistryHostAllowed, isPrivateOrLinkLocalHost, resolvesToPrivateOrLinkLocalAddress } from '../src/registry-allowlist';
import tools = require('azure-pipelines-tool-lib/tool');

// Table-driven class test for the egress-authorization defect class
// (#161/#188/#191/#200/#201). Kept in its own file so its three tables stay
// readable; imported for its side effect of registering the suite.
import './EgressAuthorizationL0';

// Table-driven class test for the artifact-trust defect class
// (#65/#78/#136/#198/#204): every path by which a binary becomes trusted, plus the
// failure/edge states of the verification itself. Kept in its own file so its three
// tables stay readable; imported for its side effect of registering the suite.
import './ArtifactTrustL0';
// This extension's half of azure-pipelines-terraform#879: downloadToFile was the
// one network op in this module its siblings' withRetry did not cover.
import './NetworkRetryClassL0';

describe('PackerInstaller Test Suite', function () {

    it('classifies mirror hosts and resolved addresses', async () => {
        assert.deepStrictEqual(parseAllowedHosts(' Mirror.Example.com,\n*.trusted.example '), ['mirror.example.com', '*.trusted.example']);
        assert.ok(isRegistryHostAllowed('mirror.example.com', ['mirror.example.com']));
        assert.ok(isRegistryHostAllowed('cdn.trusted.example', ['*.trusted.example']));
        assert.ok(!isRegistryHostAllowed('evil.example.com', ['*.trusted.example']));

        for (const address of ['localhost', '127.0.0.1', '10.1.2.3', '10.1.2.3:8443', '172.16.0.1', '192.168.1.1', '169.254.1.1', '[::1]', 'fe80::1', 'fc00::1']) {
            assert.ok(isPrivateOrLinkLocalHost(address), `expected private address: ${address}`);
        }
        assert.ok(!isPrivateOrLinkLocalHost('8.8.8.8'));
        assert.ok(await resolvesToPrivateOrLinkLocalAddress('mirror.example.com', async () => [{ address: '10.0.0.8' }]));
        assert.ok(!await resolvesToPrivateOrLinkLocalAddress('public.example.com', async () => [{ address: '8.8.8.8' }]));
    });

    it('streams an allowed mirror response to disk', async () => {
        const originalFetch = globalThis.fetch;
        const destination = path.join(os.tmpdir(), `packer-download-${Date.now()}.zip`);
        globalThis.fetch = async () => new Response('fake-zip-content', { status: 200 });
        try {
            await downloadToFile('https://mirror.example.com/packer.zip', destination, 1000, hostname => {
                assert.strictEqual(hostname, 'mirror.example.com');
            });
            assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'fake-zip-content');
        } finally {
            globalThis.fetch = originalFetch;
            try { fs.unlinkSync(destination); } catch { /* best effort cleanup */ }
        }
    });

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
    // #189: the two scenarios below point the mock runner at ../src/index.js
    // itself, not at the RunInstaller.js re-implementation, so the declared
    // task.json execution entry point is exercised (and measured — it is no
    // longer excluded in .nycrc.json) on both its success and its fail-closed path.
    it('EntryPointInstallSuccess', async () => {
        const tr = new ttm.MockTestRunner(path.join(__dirname, 'EntryPointInstallSuccess.js'));
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'task should have succeeded. errors: ' + tr.errorIssues);
            assert.ok(
                tr.stdout.includes('EntryPoint test: prependPath(' + path.join(path.sep + 'opt', 'hostedtoolcache', 'packer', '1.12.0', 'x64') + ')'),
                'src/index.ts must prepend the install directory to PATH when PATH does not already start with it. stdout: ' + tr.stdout
            );
            assert.ok(
                tr.stdout.includes('Packer v1.12.0'),
                'src/index.ts must run the post-install `packer version` verification. stdout: ' + tr.stdout
            );
        }, tr);
    });
    expectFailure('EntryPointVerifyFail');

    expectSuccess('CachedInstallSuccess');
    expectSuccess('RegistrySpecificVersionSuccess');
    expectSuccess('MirrorCustomUrlSuccess');
    expectSuccess('CacheHitHashMatchSuccess');   // #136: cache-hit re-verification matches recorded hash

    // --- Failure cases ---
    expectFailure('InsecureUrlReject');
    expectFailure('Sha256VerificationFail');
    expectFailure('InvalidVersionFail');
    expectFailure('GpgSignatureRequiredButMissing');
    expectFailure('RegistryEmptySha256Rejected');
    expectFailure('RegistryInsecureDownloadUrlReject');
    expectFailure('RegistryUrlInvalidReject');   // #139: insecure/malformed registryUrl input rejected before any fetch
    expectFailure('CacheHitHashMismatchFail');   // #136: cache-hit re-verification catches local tampering/corruption
    expectFailure('MirrorMissingChecksumFail');
    expectFailure('RegistryMirrorNameInvalidReject');
    expectFailure('MirrorSumsMissingEntryFail');       // #111: SUMS published but our artifact isn't listed in it

    // --- Mirror GPG (now honored) + typed-error classification ---
    expectFailure('MirrorGpgRequiredMissingFail');   // requireGpgSignature default true + .sig missing -> fail
    expectFailure('MirrorSha256MismatchFail');       // genuine mismatch is fatal even with requireChecksum=false

    // --- 'latest' checkpoint resolution fails closed: neither an unreachable API
    // (#78) nor a malformed response (#106) may silently install a pinned version ---
    expectFailure('HashiCorpLatestCheckpointDownFail');
    expectFailure('HashiCorpLatestCheckpointInvalidResponseFail');

    // --- GPG fetch-failure classification: only a genuine 404 may downgrade when
    // requireGpgSignature=false; a transient failure stays fatal (#106) ---
    expectFailure('GpgSigTransientErrorFail');

    // --- Verification opt-out toggles: must skip-and-install WITH a warning ---
    it('MirrorChecksumOptOutSuccess', async () => {
        const tr = new ttm.MockTestRunner(path.join(__dirname, 'MirrorChecksumOptOutSuccess.js'));
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'task should have succeeded');
            assert.ok(
                tr.warningIssues.some((w) => w.includes('WITHOUT any local integrity verification')),
                'must warn that no integrity verification occurred. warnings: ' + tr.warningIssues
            );
        }, tr);
    });

    it('MirrorSumsMissingEntryOptOutWarns', async () => {
        const tr = new ttm.MockTestRunner(path.join(__dirname, 'MirrorSumsMissingEntryOptOutWarns.js'));
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'task should have succeeded');
            assert.ok(
                tr.warningIssues.some((w) => w.includes('is not listed in the mirror\'s SHA256SUMS')),
                'must warn that the artifact was not listed. warnings: ' + tr.warningIssues
            );
        }, tr);
    });

    it('RegistryChecksumOptOutWarns', async () => {
        const tr = new ttm.MockTestRunner(path.join(__dirname, 'RegistryChecksumOptOutWarns.js'));
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'task should have succeeded');
            assert.ok(
                tr.warningIssues.some((w) => w.includes('WITHOUT any local integrity verification')),
                'must warn that no integrity verification occurred. warnings: ' + tr.warningIssues
            );
        }, tr);
    });

    it('HashiCorpGpgOptOutSuccess', async () => {
        const tr = new ttm.MockTestRunner(path.join(__dirname, 'HashiCorpGpgOptOutSuccess.js'));
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'task should have succeeded (SHA256 still enforced)');
            assert.ok(tr.errorIssues.length === 0, 'should have no errors. errors: ' + tr.errorIssues);
        }, tr);
    });

    // --- Registry pre-signed download-URL token masking (#98) ---
    // The registry download_url carries a live storage credential in its query string
    // and tool-lib logs the URL at INFO. Assert every token component is registered as
    // a secret (so the agent masks it) while benign params stay visible.
    it('RegistryDownloadTokenMasked', async () => {
        const tr = new ttm.MockTestRunner(path.join(__dirname, 'RegistryDownloadTokenMasked.js'));
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.succeeded, 'task should have succeeded');
            assert.ok(tr.errorIssues.length === 0, 'should have no errors. errors: ' + tr.errorIssues);
            const maskedTokens = [
                'AWSSIGNATUREtoken1111',   // X-Amz-Signature
                'AWSCREDENTIALtoken2222',  // X-Amz-Credential
                'AWSSECURITYtoken3333',    // X-Amz-Security-Token
                'GOOGSIGNATUREtoken4444',  // X-Goog-Signature
                'GOOGCREDENTIALtoken5555', // X-Goog-Credential
                'AZURESIGtoken6666'        // Azure SAS sig
            ];
            for (const token of maskedTokens) {
                assert.ok(
                    tr.stdout.includes('##vso[task.setsecret]' + token),
                    `expected ##vso[task.setsecret] for token ${token}. stdout: ${tr.stdout}`
                );
            }
            // Benign query parameters must NOT be masked (guards against over-redaction).
            assert.ok(!tr.stdout.includes('##vso[task.setsecret]20260703T000000Z'),
                'benign X-Amz-Date must not be registered as a secret');
            assert.ok(!tr.stdout.includes('##vso[task.setsecret]host'),
                'benign X-Amz-SignedHeaders must not be registered as a secret');
        }, tr);
    });

    // --- Registry download-failure URL/message redaction (#111) ---
    // On a failed download, tool-lib's own exception can embed the full pre-signed
    // URL. redactUrl() plus the exception-message scrub must strip it from the
    // task's final error output before it ever reaches the build log.
    it('RegistryDownloadFailRedacted', async () => {
        const tr = new ttm.MockTestRunner(path.join(__dirname, 'RegistryDownloadFailRedacted.js'));
        await tr.runAsync();
        runValidations(() => {
            assert.ok(tr.failed, 'task should have failed');
            assert.ok(tr.errorIssues.length > 0, 'should have an error issue');
            const SIG_TOKEN = 'SUPERSECRETSIGNATUREtoken9999';
            const PRESIGNED_URL = `https://storage.example.com/signed/packer_1.12.0_linux_amd64.zip?sig=${SIG_TOKEN}`;
            for (const issue of tr.errorIssues) {
                assert.ok(!issue.includes(SIG_TOKEN), `error issue must not contain the raw sig token: ${issue}`);
                assert.ok(!issue.includes(PRESIGNED_URL), `error issue must not contain the raw pre-signed URL: ${issue}`);
            }
        }, tr);
    });

    // --- Real (unmocked) GPG verification ---
    expectSuccess('GpgRealVerifySuccess');
    expectFailure('GpgRealVerifyTamperedFail');
    expectSuccess('GpgMultiSignatureFirstInvalidSuccess');   // #137: valid signature at index > 0 must not be ignored

    it('the embedded HashiCorp public key still parses with the current openpgp version', async () => {
        const key = await openpgp.readKey({ armoredKey: HASHICORP_GPG_PUBLIC_KEY });
        assert.ok(key, 'openpgp.readKey should successfully parse the embedded key');
    });

    // --- Proxy configuration (#140) ---
    function withProxyEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
        const keys = ['AGENT_PROXYURL', 'AGENT_PROXYUSERNAME', 'AGENT_PROXYPASSWORD'] as const;
        const original = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
        for (const k of keys) {
            if (vars[k] === undefined) delete process.env[k];
            else process.env[k] = vars[k];
        }
        return fn().finally(() => {
            for (const k of keys) {
                if (original[k] === undefined) delete process.env[k];
                else process.env[k] = original[k];
            }
        });
    }

    it('buildFetchOptions embeds proxy credentials into the dispatcher URL and masks the password as a secret', async () => {
        await withProxyEnv({
            AGENT_PROXYURL: 'http://proxy.example.com:8080',
            AGENT_PROXYUSERNAME: 'proxyuser',
            AGENT_PROXYPASSWORD: 'super-secret-pw',
        }, async () => {
            const originalFetch = global.fetch;
            const originalWrite = process.stdout.write.bind(process.stdout);
            let stdout = '';
            let capturedDispatcher: unknown;
            global.fetch = (async (_url: string, options?: RequestInit) => {
                capturedDispatcher = (options as { dispatcher?: unknown } | undefined)?.dispatcher;
                return new Response('ok', { status: 200 });
            }) as typeof fetch;
            process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
                stdout += chunk.toString();
                return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
            }) as typeof process.stdout.write;
            try {
                const result = await fetchWithTimeout('https://example.com/start', 1000, async (r) => r.text());
                assert.strictEqual(result, 'ok');
                assert.ok(capturedDispatcher, 'a ProxyAgent dispatcher should have been passed to fetch');
                assert.ok(
                    stdout.includes('##vso[task.setsecret]super-secret-pw'),
                    'the proxy password must be registered as a secret via tasks.setSecret'
                );
            } finally {
                global.fetch = originalFetch;
                process.stdout.write = originalWrite;
            }
        });
    });

    it('buildFetchOptions uses the bare proxy URL (no credential branch) when no username is configured', async () => {
        await withProxyEnv({
            AGENT_PROXYURL: 'http://proxy.example.com:8080',
            AGENT_PROXYUSERNAME: undefined,
            AGENT_PROXYPASSWORD: undefined,
        }, async () => {
            const originalFetch = global.fetch;
            let capturedDispatcher: unknown;
            global.fetch = (async (_url: string, options?: RequestInit) => {
                capturedDispatcher = (options as { dispatcher?: unknown } | undefined)?.dispatcher;
                return new Response('ok', { status: 200 });
            }) as typeof fetch;
            try {
                const result = await fetchWithTimeout('https://example.com/start', 1000, async (r) => r.text());
                assert.strictEqual(result, 'ok');
                assert.ok(capturedDispatcher, 'a ProxyAgent dispatcher should have been passed to fetch even without credentials');
            } finally {
                global.fetch = originalFetch;
            }
        });
    });

    it('fetchWithTimeout aborts a hung request instead of hanging indefinitely', async () => {
        const originalFetch = global.fetch;
        // Simulate a connection that never resolves on its own, but — like real
        // fetch — rejects when its AbortSignal fires.
        global.fetch = ((_url: string, options?: RequestInit) => new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        })) as typeof fetch;
        try {
            await assert.rejects(
                () => fetchWithTimeout('https://example.com/hangs', 50, async () => 'unreachable'),
                /timed out after 50ms/
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('fetchWithTimeout follows an https-to-https redirect', async () => {
        const originalFetch = global.fetch;
        global.fetch = (async (url: string) => {
            if (url === 'https://example.com/start') {
                return new Response(null, { status: 302, headers: { Location: 'https://example.com/final' } });
            }
            return new Response('ok', { status: 200 });
        }) as typeof fetch;
        try {
            const result = await fetchWithTimeout('https://example.com/start', 1000, async (r) => r.text());
            assert.strictEqual(result, 'ok');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('fetchWithTimeout rejects a redirect that downgrades to http://', async () => {
        const originalFetch = global.fetch;
        global.fetch = (async () =>
            new Response(null, { status: 302, headers: { Location: 'http://attacker.example.com/payload' } })
        ) as typeof fetch;
        try {
            await assert.rejects(
                () => fetchWithTimeout('https://example.com/start', 1000, async (r) => r.text()),
                /InsecureUrlRejected/
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('fetchWithTimeout refuses an off-host redirect even when it stays https', async () => {
        const originalFetch = global.fetch;
        global.fetch = (async () =>
            new Response(null, { status: 302, headers: { Location: 'https://evil.example.net/payload' } })
        ) as typeof fetch;
        try {
            await assert.rejects(
                () => fetchWithTimeout('https://example.com/start', 1000, async (r) => r.text()),
                /off-host redirect/
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('fetchWithTimeout aborts a redirect loop after the hop limit', async () => {
        const originalFetch = global.fetch;
        // Always redirect to a same-host URL -> exceeds MAX_REDIRECTS.
        global.fetch = (async () =>
            new Response(null, { status: 302, headers: { Location: 'https://example.com/loop' } })
        ) as typeof fetch;
        try {
            await assert.rejects(
                () => fetchWithTimeout('https://example.com/loop', 1000, async (r) => r.text()),
                /Too many redirects/
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('fetchJson parses a 200 body and rejects a 4xx without retrying', async () => {
        const originalFetch = global.fetch;
        let calls = 0;
        global.fetch = (async () => {
            calls++;
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }) as typeof fetch;
        try {
            const body = await fetchJson<{ ok: boolean }>('https://example.com/meta');
            assert.deepStrictEqual(body, { ok: true });
            assert.strictEqual(calls, 1);
        } finally {
            global.fetch = originalFetch;
        }

        calls = 0;
        global.fetch = (async () => { calls++; return new Response('nope', { status: 404 }); }) as typeof fetch;
        try {
            await assert.rejects(() => fetchJson('https://example.com/meta'));
            assert.strictEqual(calls, 1, '4xx must not be retried');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('fetchText retries a transient 5xx and then succeeds', async () => {
        const originalFetch = global.fetch;
        let calls = 0;
        global.fetch = (async () => {
            calls++;
            return calls === 1
                ? new Response('busy', { status: 503 })
                : new Response('payload', { status: 200 });
        }) as typeof fetch;
        try {
            const text = await fetchText('https://example.com/sums');
            assert.strictEqual(text, 'payload');
            assert.strictEqual(calls, 2, '5xx should trigger exactly one retry here');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('fetchText retries a network error and then gives up after the attempt limit', async () => {
        const originalFetch = global.fetch;
        let calls = 0;
        global.fetch = (async () => { calls++; throw new TypeError('network down'); }) as typeof fetch;
        try {
            await assert.rejects(() => fetchText('https://example.com/sums'), /network down/);
            assert.strictEqual(calls, 3, 'network errors are retried up to the attempt limit');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('fetchTextAllow404 returns null on 404 but text on 200', async () => {
        const originalFetch = global.fetch;
        global.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
        try {
            assert.strictEqual(await fetchTextAllow404('https://example.com/SHA256SUMS'), null);
        } finally {
            global.fetch = originalFetch;
        }

        global.fetch = (async () => new Response('sums-body', { status: 200 })) as typeof fetch;
        try {
            assert.strictEqual(await fetchTextAllow404('https://example.com/SHA256SUMS'), 'sums-body');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('fetchBuffer returns the response bytes', async () => {
        const originalFetch = global.fetch;
        global.fetch = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as typeof fetch;
        try {
            const buf = await fetchBuffer('https://example.com/file.sig');
            assert.deepStrictEqual(Array.from(buf), [1, 2, 3]);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('downloadToolWithTimeout aborts a hung download instead of hanging indefinitely (#105)', async () => {
        const originalDownloadTool = tools.downloadTool;
        // Never resolves, so the race is settled entirely by the timeout branch.
        (tools as unknown as { downloadTool: (url: string, fileName: string) => Promise<string> }).downloadTool =
            () => new Promise<string>(() => { /* intentionally never resolves */ });
        try {
            await assert.rejects(
                () => downloadToolWithTimeout('https://example.com/packer.zip', 'packer.zip', 50),
                /timed out after 50ms/
            );
        } finally {
            (tools as unknown as { downloadTool: typeof originalDownloadTool }).downloadTool = originalDownloadTool;
        }
    });

    // --- redactUrl (#111): the sole control preventing a pre-signed registry
    // download credential from reaching the build log on a failed download. ---
    it('redactUrl strips the entire query string from a well-formed URL', () => {
        assert.strictEqual(
            redactUrl('https://storage.example.com/signed/packer.zip?sig=abc123&X-Amz-Signature=def456'),
            'https://storage.example.com/signed/packer.zip?<redacted>'
        );
    });

    it('redactUrl returns the URL unchanged when it has no query string', () => {
        assert.strictEqual(
            redactUrl('https://storage.example.com/signed/packer.zip'),
            'https://storage.example.com/signed/packer.zip'
        );
    });

    it('redactUrl falls back to a plain split on an unparseable URL', () => {
        assert.strictEqual(redactUrl('not-a-valid-url?sig=abc123'), 'not-a-valid-url');
    });
});
