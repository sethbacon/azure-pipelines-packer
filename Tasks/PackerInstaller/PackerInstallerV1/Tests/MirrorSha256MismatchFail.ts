import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #69: a genuine hash MISMATCH on the mirror path must always FAIL, even with
// requireChecksum=false (the opt-out only downgrades UNAVAILABLE checksums, never
// a real mismatch). Guards the typed-error classifier against regressions.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

const SUMS_HASH = 'aaaaaaaa00112233aaaaaaaa00112233aaaaaaaa00112233aaaaaaaa00112233';
const ACTUAL_HASH = 'bbbbbbbb00112233bbbbbbbb00112233bbbbbbbb00112233bbbbbbbb00112233';

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://artifacts.example.com/hashicorp/packer');
tr.setInput('requireChecksum', 'false');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Mirror path should not call fetchJson: ' + url); },
    // SUMS published, lists our file with SUMS_HASH...
    fetchTextAllow404: async (_url: string) => `${SUMS_HASH}  packer_1.12.0_linux_amd64.zip\n`
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('./gpg-verifier', { verifyGpgSignature: async () => { /* isolate the checksum path */ } });
tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    readFileSync: (_p: string) => Buffer.from('fake-zip-content')
});
tr.registerMock('crypto', {
    randomUUID: () => 'test-uuid-1234',
    // ...but the downloaded zip hashes to something else -> mismatch.
    createHash: (_a: string) => ({ update: (_d: unknown) => ({ digest: (_e: string) => ACTUAL_HASH }) })
});
tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => null,
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async () => { throw new Error('Should not extract a hash-mismatched binary'); },
    cacheDir: async () => { throw new Error('Should not cache a hash-mismatched binary'); },
    cleanVersion: (v: string) => v,
    prependPath: (_p: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
