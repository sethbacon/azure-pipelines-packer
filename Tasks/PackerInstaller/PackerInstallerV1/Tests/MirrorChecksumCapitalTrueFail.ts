import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #331: `requireChecksum: true` written unquoted in pipeline YAML reaches the task
// as the string 'True'. Every mock below is the permissive set from
// MirrorChecksumOptOutSuccess — extract and cache both succeed — so the ONLY thing
// that can fail this install is the switch being honored. A parser that compares
// against the lowercase literal reads 'True' as false, skips verification, and this
// install succeeds; the fail-closed contract says it must not.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://artifacts.example.com/hashicorp/packer');
tr.setInput('mirrorAllowedHosts', 'artifacts.example.com');
tr.setInput('requireChecksum', 'True');
tr.setInput('requireGpgSignature', 'false');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Mirror path should not call fetchJson: ' + url); },
    // No SHA256SUMS published -> 404 -> null. With the switch honored there is
    // nothing to verify against, so the install must fail closed.
    fetchTextAllow404: async (_url: string) => null,
    downloadToFile: async () => { }
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('./gpg-verifier', { verifyGpgSignature: async () => { /* opted out above */ } });
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
