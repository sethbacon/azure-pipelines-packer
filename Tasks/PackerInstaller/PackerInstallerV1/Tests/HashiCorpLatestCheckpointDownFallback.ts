import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #106: a genuine checkpoint-API request failure (network/timeout/5xx) is a transient
// availability blip and still falls back to the pinned FALLBACK_PACKER_VERSION with a
// warning -- this deliberate fail-open is unchanged. Contrast with
// HashiCorpLatestCheckpointInvalidResponseFail, where the API responds but with a
// malformed body (an API-shape regression, not a transient blip), which must NOT
// silently fall back.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', 'latest');
tr.setInput('downloadSource', 'hashicorp');

tr.registerMock('os', {
    type: () => 'Linux',
    arch: () => 'x64'
});

// FALLBACK_PACKER_VERSION is pinned to 1.12.0 in packer-installer.ts.
const EXPECTED_SHA256 = 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233';

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => {
        if (url.startsWith('https://checkpoint-api.hashicorp.com/')) {
            throw new Error('network down');
        }
        throw new Error('Unexpected fetchJson URL: ' + url);
    },
    fetchText: async (url: string) => {
        // Falling back must still resolve to the pinned 1.12.0 SHA256SUMS lookup.
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
