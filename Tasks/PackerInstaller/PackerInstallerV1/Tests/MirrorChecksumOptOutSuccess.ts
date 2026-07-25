import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #68: with requireChecksum=false and no SHA256SUMS published, the mirror install
// SUCCEEDS but must emit the "installed WITHOUT any local integrity verification" warning.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://artifacts.example.com/hashicorp/packer');
tr.setInput('mirrorAllowedHosts', 'artifacts.example.com');
tr.setInput('requireChecksum', 'false');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Mirror path should not call fetchJson: ' + url); },
    // No SHA256SUMS published -> 404 -> null.
    fetchTextAllow404: async (_url: string) => null,
    downloadToFile: async () => { }
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('./gpg-verifier', { verifyGpgSignature: async () => { /* not reached: SUMS absent */ } });
tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    readFileSync: (_p: string) => Buffer.from('fake-zip-content')
});
tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => null,
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async (_z: string) => '/tmp/packer-extracted',
    cacheDir: async (_s: string, _t: string, _v: string) => '/tmp/packer-cached',
    cleanVersion: (v: string) => v,
    prependPath: (_p: string) => { }
});

const a: ma.TaskLibAnswers = { 'find': { '/tmp/packer-cached': ['/tmp/packer-cached/packer'] } };
tr.setAnswers(a);
tr.run();
