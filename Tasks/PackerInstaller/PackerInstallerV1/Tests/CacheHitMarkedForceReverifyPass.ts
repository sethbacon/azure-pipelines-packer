import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// forceOnlineReverification=true, and the recorded sidecar hash EXISTS AND MATCHES —
// distinct from CacheHitUnmarkedReverifyMismatchFail/CacheHitHashMatchSuccess, where
// either there is no sidecar or a match is trusted without escalation. The point of
// this fixture is that a passing sidecar must NOT be trusted when forced: the
// download path must still run, and it must still succeed on a genuine byte match.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'hashicorp');
tr.setInput('forceOnlineReverification', 'true');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

const MATCHING_HASH = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Unexpected fetchJson: ' + url); },
    fetchText: async (_url: string) => `${MATCHING_HASH}  packer_1.12.0_linux_amd64.zip\n`
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('./gpg-verifier', { verifyGpgSignature: async () => { } });

tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    existsSync: (filePath: string) => filePath === '/tmp/packer-cached/packer.sha256', // sidecar EXISTS
    readFileSync: (p: string) => {
        if (p === '/tmp/packer-cached/packer.sha256') {
            return MATCHING_HASH; // and MATCHES the cached binary's content below
        }
        // Both the cached and freshly-extracted binary read the SAME bytes here — a
        // genuine byte match, which is the point (the escalation must still succeed).
        return Buffer.from('shared-binary');
    },
    writeFileSync: (p: string, _d: string) => {
        console.log('MARKER_WRITTEN:' + p);
    },
    renameSync: (_a: string, _b: string) => { },
    unlinkSync: (_p: string) => { }
});

tr.registerMock('crypto', {
    randomUUID: () => 'test-uuid-1234',
    createHash: (_algorithm: string) => {
        let seen = '';
        const h = {
            update(data: unknown) { seen = String(data); return h; },
            digest: (_encoding: string) => (seen === 'shared-binary' ? MATCHING_HASH : 'ffffffff'.repeat(8))
        };
        return h;
    }
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => '/tmp/packer-cached',
    downloadTool: async (url: string, _fileName: string) => {
        console.log('REVERIFY_DOWNLOAD_CALLED:' + url);
        return '/tmp/packer.zip';
    },
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
