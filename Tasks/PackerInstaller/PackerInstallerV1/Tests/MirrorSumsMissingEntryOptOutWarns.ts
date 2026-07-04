import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #111: same "artifact not listed in SHA256SUMS" condition as
// MirrorSumsMissingEntryFail, but requireChecksum=false must downgrade to a
// warning and still succeed -- the opt-out toggle applies to an unavailable
// entry, not just a wholly-missing SUMS file.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://artifacts.example.com/hashicorp/packer');
tr.setInput('requireChecksum', 'false');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Mirror path should not call fetchJson: ' + url); },
    fetchTextAllow404: async (_url: string) =>
        'aaaaaaaa00112233aaaaaaaa00112233aaaaaaaa00112233aaaaaaaa00112233  packer_1.12.0_darwin_arm64.zip\n'
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('./gpg-verifier', {
    verifyGpgSignature: async () => { /* isolate the checksum path */ }
});

tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    readFileSync: (_p: string) => Buffer.from('fake-zip-content')
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
