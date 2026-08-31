import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// Finding 0 of #342: the registry's per-version info response was validated
// only for truthiness ("!data.download_url"), never type, so a body where
// download_url is present but NOT a string -- e.g. a number -- passed the old
// guard and would have flowed downstream into extractUrlTokenSecrets/new URL()
// as a value typed `string` but actually a number. Assert it is rejected with
// the SAME "missing download_url" message a genuinely absent field produces,
// and that no download is ever attempted.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'registry');
tr.setInput('registryUrl', 'https://registry.example.com');
tr.setInput('registryMirrorName', 'packer');

tr.registerMock('os', {
    type: () => 'Linux',
    arch: () => 'x64',
    tmpdir: () => '/tmp'
});

// The registry's advertised download_url host would normally be resolved by
// the default-deny egress check; mock dns so a real network lookup is never
// attempted if the (buggy) code proceeds past the missing type guard.
tr.registerMock('dns', {
    promises: {
        lookup: async (_host: string, _opts: unknown) => [{ address: '203.0.113.10', family: 4 }]
    }
});

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => {
        if (url.includes('/terraform/binaries/packer/versions/1.12.0/linux/amd64')) {
            return {
                download_url: 20260101, // malformed: number, not a string
                sha256: 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233'
            };
        }
        throw new Error('Unexpected fetchJson URL: ' + url);
    },
    fetchText: async (url: string) => { throw new Error('Registry path should not fetch SHA256SUMS text: ' + url); },
    downloadToFile: async () => { throw new Error('Should not download when download_url is type-confused'); },
    DOWNLOAD_TIMEOUT_MS: 30000
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('./gpg-verifier', {
    verifyGpgSignature: async () => { throw new Error('Registry path should not GPG-verify'); }
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_toolName: string, _version: string) => null,
    downloadTool: async () => { throw new Error('Should not download when download_url is type-confused'); },
    extractZip: async () => { throw new Error('Should not extract when download_url is type-confused'); },
    cacheDir: async () => { throw new Error('Should not cache when download_url is type-confused'); },
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
