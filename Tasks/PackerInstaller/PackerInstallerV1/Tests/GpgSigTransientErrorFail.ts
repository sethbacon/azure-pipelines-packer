import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #106: a TRANSIENT .sig fetch failure (5xx/network -- anything other than a genuine
// 404) must remain FATAL even with requireGpgSignature=false. Only a real "not
// published" (404, surfaced as fetchBufferAllow404 resolving to null) may downgrade to
// a warning. Uses the REAL gpg-verifier; only its fetchBufferAllow404 dependency is
// made to throw, simulating a 5xx that survived http-client's own retries.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://artifacts.example.com/hashicorp/packer');
tr.setInput('requireGpgSignature', 'false');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64' });

const EXPECTED_SHA256 = 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233';

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Mirror path should not call fetchJson: ' + url); },
    fetchTextAllow404: async (_url: string) => `${EXPECTED_SHA256}  packer_1.12.0_linux_amd64.zip\n`,
    // .sig fetch fails with a transient error (not a 404) -> must stay fatal even
    // though requireGpgSignature=false.
    fetchBufferAllow404: async (_url: string) => { throw new Error('Failed to fetch .sig: HTTP 503'); }
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    readFileSync: (_p: string) => Buffer.from('fake-zip-content')
});
tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => null,
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async () => { throw new Error('Should not extract when a transient GPG fetch error is treated as fatal'); },
    cacheDir: async () => { throw new Error('Should not cache when a transient GPG fetch error is treated as fatal'); },
    cleanVersion: (v: string) => v,
    prependPath: (_p: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
