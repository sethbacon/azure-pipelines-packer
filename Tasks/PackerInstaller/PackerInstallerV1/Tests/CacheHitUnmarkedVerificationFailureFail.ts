import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #136: the unmarked-cache-entry escalation must distinguish "the source cannot be
// REACHED" (degrade to the cached binary with a warning, so offline/air-gapped agents
// keep working) from "the source WAS reached and the material FAILED verification"
// (fail closed -- never fall back to a copy nothing verified). Here the re-download
// succeeds but the SHA256SUMS signature does not verify: a typed VerificationFailure,
// so the task must FAIL even though requireOnlineReverification is off.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'hashicorp');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Unexpected fetchJson: ' + url); },
    downloadToFile: async () => { },
    fetchText: async (_url: string) => `${'c'.repeat(64)}  packer_1.12.0_linux_amd64.zip\n`
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('./gpg-verifier', {
    verifyGpgSignature: async () => {
        // A reachable source serving material that does not verify. The name marker is
        // what isVerificationFailure() keys on across mocked module instances.
        const error = new Error('GPG signature verification failed for SHA256SUMS: bad signature');
        error.name = 'VerificationFailure';
        throw error;
    }
});

tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    existsSync: (_p: string) => false,
    readFileSync: (_p: string) => Buffer.from('cached-binary'),
    writeFileSync: (_p: string, _d: string) => { },
    renameSync: (_a: string, _b: string) => { },
    unlinkSync: (_p: string) => { }
});

tr.registerMock('crypto', {
    randomUUID: () => 'test-uuid-1234',
    createHash: (_algorithm: string) => ({
        update: (_data: unknown) => ({ digest: (_encoding: string) => 'c'.repeat(64) })
    })
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => '/tmp/packer-cached',
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async () => { throw new Error('must not extract material that failed verification'); },
    cacheDir: async () => { throw new Error('must not re-cache on a cache hit'); },
    cleanVersion: (v: string) => v,
    prependPath: (_p: string) => { }
});

const a: ma.TaskLibAnswers = { 'find': { '/tmp/packer-cached': ['/tmp/packer-cached/packer'] } };
tr.setAnswers(a);
tr.run();
