import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #65 (the sibling branch the first fix missed): the mirror publishes NO SHA256SUMS
// and the operator has turned requireChecksum off -- but requireGpgSignature is still
// on (its default). The SHA256SUMS file IS what the detached .sig signs, so "no SUMS"
// also means "no signature to verify": installing here would hand the operator a
// binary with neither a checksum nor a signature while the GPG toggle sat enabled and
// completely inert. Must FAIL closed.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://artifacts.example.com/hashicorp/packer');
tr.setInput('mirrorAllowedHosts', 'artifacts.example.com');
tr.setInput('requireChecksum', 'false');
// requireGpgSignature deliberately NOT set -> defaults to true.

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Mirror path should not call fetchJson: ' + url); },
    // No SHA256SUMS published -> 404 -> null.
    fetchTextAllow404: async (_url: string) => null,
    downloadToFile: async () => { }
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('./gpg-verifier', {
    verifyGpgSignature: async () => { throw new Error('must not reach GPG verification: there is no SHA256SUMS to verify'); }
});
tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    readFileSync: (_p: string) => Buffer.from('fake-zip-content'),
    unlinkSync: (_p: string) => { }
});
tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => null,
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async (_z: string) => { throw new Error('must not extract an unverified artifact'); },
    cacheDir: async (_s: string, _t: string, _v: string) => '/tmp/packer-cached',
    cleanVersion: (v: string) => v,
    prependPath: (_p: string) => { }
});

const a: ma.TaskLibAnswers = { 'find': { '/tmp/packer-cached': ['/tmp/packer-cached/packer'] } };
tr.setAnswers(a);
tr.run();
