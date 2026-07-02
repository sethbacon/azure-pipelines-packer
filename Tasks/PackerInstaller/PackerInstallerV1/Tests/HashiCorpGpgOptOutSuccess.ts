import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #68: with requireGpgSignature=false and the .sig unavailable, the hashicorp install
// SUCCEEDS (SHA256 is still enforced) via the REAL gpg-verifier's downgrade branch.
// gpg-verifier is intentionally NOT mocked; only its fetchBuffer dependency (the .sig
// fetch) is made to fail so the "unavailable && !required -> warn+return" path runs.
// Because the real gpg-verifier loads openpgp (which needs the full crypto module),
// crypto is NOT mocked here -- so EXPECTED_SHA256 is the genuine SHA256 of the mocked
// zip content ('fake-zip-content'), computed by real crypto and matched against SUMS.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

const EXPECTED_SHA256 = '012683b6c55e066bdba38d520be4c2126ec5b486ffa75426f611603f09e78eda';

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'hashicorp');
tr.setInput('requireGpgSignature', 'false');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('hashicorp path should not call fetchJson: ' + url); },
    fetchText: async (url: string) => {
        if (url.endsWith('SHA256SUMS')) return `${EXPECTED_SHA256}  packer_1.12.0_linux_amd64.zip\n`;
        throw new Error('Unexpected fetchText URL: ' + url);
    },
    // The .sig is unavailable; the real gpg-verifier catches this and (requireGpg=false) warns.
    fetchBuffer: async (_url: string) => { throw new Error('Failed to fetch .sig: HTTP 404'); }
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    readFileSync: (_p: string) => Buffer.from('fake-zip-content')
});
// crypto is deliberately left unmocked: the real gpg-verifier loads openpgp, which
// requires the full crypto module (crypto.getHashes). Real crypto computes the SHA256
// of 'fake-zip-content', which equals EXPECTED_SHA256 above.
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
