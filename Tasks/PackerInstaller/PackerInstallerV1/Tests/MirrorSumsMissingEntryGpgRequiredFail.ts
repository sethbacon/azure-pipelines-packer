import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #338: the mirror publishes a SUMS that does not list our artifact, and the
// operator opted out of checksums but left requireGpgSignature enabled.
//
// The signature verified a document that says nothing about this zip, so the
// install must FAIL rather than proceed with a toggle that reads as enforced
// while protecting nothing. Mirrors MirrorSumsMissingGpgRequiredFail, which
// makes the same assertion for a wholly-absent SUMS file.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://artifacts.example.com/hashicorp/packer');
tr.setInput('mirrorAllowedHosts', 'artifacts.example.com');
tr.setInput('requireChecksum', 'false');
// requireGpgSignature deliberately LEFT AT ITS DEFAULT (true).

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Mirror path should not call fetchJson: ' + url); },
    fetchTextAllow404: async (_url: string) =>
        'aaaaaaaa00112233aaaaaaaa00112233aaaaaaaa00112233aaaaaaaa00112233  packer_1.12.0_darwin_arm64.zip\n',
    downloadToFile: async () => { }
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
