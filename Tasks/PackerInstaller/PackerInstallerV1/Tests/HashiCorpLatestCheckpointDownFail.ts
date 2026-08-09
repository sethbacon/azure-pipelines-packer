import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #78: 'latest' resolution FAILS CLOSED. A checkpoint-API request failure
// (network/timeout/5xx, already retried inside fetchJson) used to fall back to a
// hardcoded FALLBACK_PACKER_VERSION with only a warning, so a caller who asked for
// 'latest' -- often precisely for security currency -- could silently be handed an
// old pinned release in a green build. There is no fallback constant any more: the
// task fails and tells the operator to pin a version or retry.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', 'latest');
tr.setInput('downloadSource', 'hashicorp');

tr.registerMock('os', {
    type: () => 'Linux',
    arch: () => 'x64'
});

const EXPECTED_SHA256 = 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233';

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => {
        if (url.startsWith('https://checkpoint-api.hashicorp.com/')) {
            throw new Error('network down');
        }
        throw new Error('Unexpected fetchJson URL: ' + url);
    },
    // Everything downstream of the resolution is mocked to SUCCEED for the version a
    // stale fallback would have pinned (1.12.0). That is deliberate: if the fallback
    // ever comes back, this fixture installs cleanly and the row goes RED — the test
    // must fail because resolution refused, not because a later step happened to break.
    fetchText: async (url: string) => {
        if (url.includes('/1.12.0/packer_1.12.0_SHA256SUMS')) {
            return `${EXPECTED_SHA256}  packer_1.12.0_linux_amd64.zip\n`;
        }
        throw new Error('Unexpected fetchText URL: ' + url);
    }
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('./gpg-verifier', {
    verifyGpgSignature: async (_sha256SumsContent: string, _signatureUrl: string) => { }
});

tr.registerMock('fs', {
    chmodSync: (_path: string, _mode: string) => { },
    readFileSync: (_path: string) => Buffer.from('fake-zip-content')
});

tr.registerMock('crypto', {
    randomUUID: () => 'test-uuid-1234',
    createHash: (_algorithm: string) => ({
        update: (_data: unknown) => ({
            digest: (_encoding: string) => EXPECTED_SHA256
        })
    })
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_toolName: string, _version: string) => null,
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async (_zipPath: string) => '/tmp/packer-extracted',
    cacheDir: async (_srcPath: string, _tool: string, _version: string) => '/tmp/packer-cached',
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {
    'find': {
        '/tmp/packer-cached': ['/tmp/packer-cached/packer']
    }
};

tr.setAnswers(a);
tr.run();
