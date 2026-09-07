import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// Class residual (batch-A fold, site 2), mirror source leg: verifyGpgSignature is
// deliberately NOT mocked here (unlike the other mirror fixtures) so the REAL
// permitted-skip branch runs -- the .sig is a genuine 404 and requireGpgSignature
// is false. Before the fix, the function returned void and the caller had no way
// to tell "actually verified" from "permitted skip", so this reached the same
// success path as a real GPG-anchored mirror install with no disclosure at all.
// After the fix, the caller must warn with GpgVerificationSkippedChecksumOnly.
//
// crypto is deliberately left unmocked, same reasoning as HashiCorpGpgOptOutSuccess:
// the real gpg-verifier loads openpgp (needs the full crypto module), so
// EXPECTED_SHA256 is the genuine SHA256 of the mocked zip content.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

const EXPECTED_SHA256 = '012683b6c55e066bdba38d520be4c2126ec5b486ffa75426f611603f09e78eda';

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://artifacts.example.com/hashicorp/packer');
tr.setInput('mirrorAllowedHosts', 'artifacts.example.com');
tr.setInput('requireGpgSignature', 'false');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Mirror path should not call fetchJson: ' + url); },
    fetchTextAllow404: async (url: string) => {
        if (url.includes('SHA256SUMS')) return `${EXPECTED_SHA256}  packer_1.12.0_linux_amd64.zip\n`;
        throw new Error('Unexpected fetchTextAllow404 URL: ' + url);
    },
    // The .sig is genuinely absent (404); the real gpg-verifier warns and returns
    // false rather than throwing, since requireGpgSignature is false.
    fetchBufferAllow404: async (_url: string) => null,
    downloadToFile: async () => { }
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('fs', {
    chmodSync: (_path: string, _mode: string) => { },
    readFileSync: (_path: string) => Buffer.from('fake-zip-content')
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_toolName: string, _version: string) => null,
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async (_zipPath: string) => '/tmp/packer-extracted',
    cacheDir: async (_srcPath: string, _tool: string, _version: string) => '/tmp/packer-cached',
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = { 'find': { '/tmp/packer-cached': ['/tmp/packer-cached/packer'] } };
tr.setAnswers(a);
tr.run();
