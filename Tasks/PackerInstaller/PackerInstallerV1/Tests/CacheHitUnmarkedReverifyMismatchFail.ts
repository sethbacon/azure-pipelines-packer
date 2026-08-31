import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #136: a tool-cache hit with NO recorded integrity hash (cached before the check
// existed, or by a job that ran with verification disabled) used to be trusted
// outright. It is now escalated: the release is re-downloaded through the SAME source
// and verification path a fresh install would use, and the cached binary must byte-
// match the freshly verified one. Here it does not -- the cache entry was never the
// release it claims to be -- so the task fails closed rather than running it.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'hashicorp');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

const FRESH_HASH = 'a'.repeat(64);
const CACHED_HASH = 'b'.repeat(64);

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Unexpected fetchJson: ' + url); },
    downloadToFile: async () => { },
    // The freshly downloaded zip verifies cleanly against the published SHA256SUMS...
    fetchText: async (_url: string) => `${CACHED_HASH}  packer_1.12.0_linux_amd64.zip\n`
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('./gpg-verifier', { verifyGpgSignature: async () => { } });

tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    // No integrity hash was ever recorded for this cache entry.
    existsSync: (_p: string) => false,
    readFileSync: (p: string) => Buffer.from(String(p).includes('fresh') ? 'fresh-binary' : 'cached-binary'),
    writeFileSync: (_p: string, _d: string) => { },
    renameSync: (_a: string, _b: string) => { },
    unlinkSync: (_p: string) => { }
});

tr.registerMock('crypto', {
    randomUUID: () => 'test-uuid-1234',
    createHash: (_algorithm: string) => {
        let seen = '';
        const h = {
            update(data: unknown) { seen = String(data); return h; },
            digest: (_encoding: string) => (seen === 'fresh-binary' ? FRESH_HASH : CACHED_HASH)
        };
        return h;
    }
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => '/tmp/packer-cached',
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async (_z: string) => '/tmp/packer-fresh',
    cacheDir: async () => { throw new Error('must not re-cache on a cache hit'); },
    cleanVersion: (v: string) => v,
    prependPath: (_p: string) => { }
});

const a: ma.TaskLibAnswers = {
    'find': {
        '/tmp/packer-cached': ['/tmp/packer-cached/packer'],
        '/tmp/packer-fresh': ['/tmp/packer-fresh/packer']
    }
};
tr.setAnswers(a);
tr.run();
