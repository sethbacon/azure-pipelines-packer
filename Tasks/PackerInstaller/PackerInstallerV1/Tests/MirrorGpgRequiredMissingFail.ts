import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #65: the mirror path now honors requireGpgSignature (previously the toggle was
// inert on this path). With requireGpgSignature=true (default) and the .sig
// unavailable, the install must FAIL. Uses the REAL gpg-verifier; only its
// fetchBuffer dependency (the .sig fetch) is made to fail.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

const EXPECTED_SHA256 = 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233';

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://artifacts.example.com/hashicorp/packer');
// requireGpgSignature left unset -> defaults to true (fail-closed).

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Mirror path should not call fetchJson: ' + url); },
    fetchTextAllow404: async (_url: string) => `${EXPECTED_SHA256}  packer_1.12.0_linux_amd64.zip\n`,
    // .sig unavailable -> real gpg-verifier with requireGpg=true must throw.
    fetchBuffer: async (_url: string) => { throw new Error('Failed to fetch .sig: HTTP 404'); }
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('fs', {
    chmodSync: (_p: string, _m: string) => { },
    readFileSync: (_p: string) => Buffer.from('fake-zip-content')
});
tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => null,
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async () => { throw new Error('Should not extract when required GPG verification cannot be performed'); },
    cacheDir: async () => { throw new Error('Should not cache when required GPG verification cannot be performed'); },
    cleanVersion: (v: string) => v,
    prependPath: (_p: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
