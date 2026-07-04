import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #111: the mirror's SHA256SUMS file is published (unlike MirrorMissingChecksumFail,
// which covers the file being entirely absent) but does not list our artifact's
// filename -- distinct ChecksumUnavailableError branch (parseSha256, not the
// fetchTextAllow404 404-branch). requireChecksum left unset -> must default to
// fail-closed (true).
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://artifacts.example.com/hashicorp/packer');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Mirror path should not call fetchJson: ' + url); },
    // SUMS is published but only lists an unrelated file -- not our zip.
    fetchTextAllow404: async (_url: string) =>
        'aaaaaaaa00112233aaaaaaaa00112233aaaaaaaa00112233aaaaaaaa00112233  packer_1.12.0_darwin_arm64.zip\n'
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('./gpg-verifier', {
    verifyGpgSignature: async () => { /* isolate the checksum path */ }
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_toolName: string, _version: string) => null,
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async () => { throw new Error('Should not extract when the artifact is not listed in SHA256SUMS and checksum verification is required'); },
    cacheDir: async () => { throw new Error('Should not cache when the artifact is not listed in SHA256SUMS and checksum verification is required'); },
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
