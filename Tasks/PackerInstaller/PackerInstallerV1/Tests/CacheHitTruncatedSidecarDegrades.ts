import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #198: a cache-integrity sidecar that exists and is readable but is TRUNCATED (a
// previous run's write was interrupted by a full disk, a cancelled job, a container
// kill) used to be fed straight to verifySha256, producing a ChecksumMismatchError --
// by design never downgradable -- so EVERY later install of that version failed with
// a Sha256VerificationFailed that reads as binary tampering. A malformed record is
// UNVERIFIABLE, not a mismatch: it is now treated exactly like a missing one, which
// escalates to a remote re-verification and, when the source is unreachable (here),
// degrades to a warning instead of bricking the version.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'hashicorp');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Unexpected fetchJson: ' + url); },
    fetchText: async (_url: string) => { throw new Error('getaddrinfo ENOTFOUND releases.hashicorp.com'); }
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('./gpg-verifier', { verifyGpgSignature: async () => { } });

tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    existsSync: (filePath: string) => filePath === '/tmp/packer-cached/packer.sha256',
    readFileSync: (filePath: string, _encoding?: string) => {
        // A torn write: the first 12 characters of a 64-character digest.
        if (filePath === '/tmp/packer-cached/packer.sha256') return 'aabbccddeeff';
        return Buffer.from('cached-binary');
    },
    writeFileSync: (_p: string, _d: string) => { },
    renameSync: (_a: string, _b: string) => { },
    unlinkSync: (_p: string) => { }
});

tr.registerMock('crypto', {
    randomUUID: () => 'test-uuid-1234',
    createHash: (_algorithm: string) => ({
        update: (_data: unknown) => ({ digest: (_encoding: string) => 'd'.repeat(64) })
    })
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => '/tmp/packer-cached',
    // The agent is offline: the escalated re-verification cannot reach the source.
    downloadTool: async () => { throw new Error('getaddrinfo ENOTFOUND releases.hashicorp.com'); },
    extractZip: async () => { throw new Error('must not extract: nothing was downloaded'); },
    cacheDir: async () => { throw new Error('must not re-cache on a cache hit'); },
    cleanVersion: (v: string) => v,
    prependPath: (_p: string) => { }
});

const a: ma.TaskLibAnswers = { 'find': { '/tmp/packer-cached': ['/tmp/packer-cached/packer'] } };
tr.setAnswers(a);
tr.run();
