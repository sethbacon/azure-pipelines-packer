import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #334: distinct from CacheHitUnmarkedVerificationFailureFail (GPG signature FAILS),
// this is the source being REACHED but WITHHOLDING the checksum entirely -- the
// hashicorp SHA256SUMS is fetched successfully but does not list our artifact's
// filename, so parseSha256 throws ChecksumUnavailableError. Before #334,
// ChecksumUnavailableError did not extend VerificationFailure, so
// reverifyUnmarkedCacheEntry's `isVerificationFailure(error)` check missed it and
// fell into the SOURCE-UNREACHABLE branch instead -- silently degrading to the
// stale cached binary with only a warning, even though the source was reached and
// simply had no checksum to offer. requireOnlineReverification is left at its
// default (false) specifically to prove this fails closed WITHOUT that opt-in.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'hashicorp');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Unexpected fetchJson: ' + url); },
    // Reachable and well-formed, but lists only an unrelated file -- not our zip.
    fetchText: async (_url: string) =>
        `${'a'.repeat(64)}  packer_1.12.0_darwin_arm64.zip\n`,
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('./gpg-verifier', {
    verifyGpgSignature: async () => { /* isolate the checksum-unavailable path */ },
});

tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    existsSync: (_p: string) => false, // no cache-integrity sidecar -> unmarked reverify path
    readFileSync: (_p: string) => Buffer.from('cached-binary'),
    writeFileSync: (_p: string, _d: string) => { },
    renameSync: (_a: string, _b: string) => { },
    unlinkSync: (_p: string) => { },
});

tr.registerMock('crypto', {
    randomUUID: () => 'test-uuid-5678',
    createHash: (_algorithm: string) => ({
        update: (_data: unknown) => ({ digest: (_encoding: string) => 'c'.repeat(64) }),
    }),
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => '/tmp/packer-cached',
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async () => { throw new Error('must not extract material this run never verified'); },
    cacheDir: async () => { throw new Error('must not re-cache on a cache hit'); },
    cleanVersion: (v: string) => v,
    prependPath: (_p: string) => { },
});

const a: ma.TaskLibAnswers = { 'find': { '/tmp/packer-cached': ['/tmp/packer-cached/packer'] } };
tr.setAnswers(a);
tr.run();
