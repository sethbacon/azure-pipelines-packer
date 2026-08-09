import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'registry');
tr.setInput('registryUrl', 'https://registry.example.com');
tr.setInput('registryMirrorName', 'packer');
// requireChecksum left unset — must default to fail-closed (true)

tr.registerMock('os', {
    type: () => 'Linux',
    arch: () => 'x64',
    tmpdir: () => '/tmp'
});

// The registry's advertised download_url host is benign; mock dns so the
// default-deny egress check (which resolves the host) passes without a real
// network lookup and the download path is reached.
tr.registerMock('dns', {
    promises: {
        lookup: async (_host: string, _opts: unknown) => [{ address: '203.0.113.10', family: 4 }]
    }
});

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => {
        if (url.includes('/terraform/binaries/packer/versions/1.12.0/linux/amd64')) {
            return {
                download_url: 'https://storage.example.com/signed/packer_1.12.0_linux_amd64.zip?sig=abc',
                sha256: ''
            };
        }
        throw new Error('Unexpected fetchJson URL: ' + url);
    },
    fetchText: async (url: string) => { throw new Error('Registry path should not fetch SHA256SUMS text: ' + url); },
    downloadToFile: async (_url: string, _destPath: string, _timeoutMs: number, isHostAllowed: (hostname: string) => void | Promise<void>) => {
        // The real client authorizes the initial host and every redirect hop
        // through this same callback; exercise it once with the advertised host.
        await isHostAllowed('storage.example.com');
    },
    DOWNLOAD_TIMEOUT_MS: 30000
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('./gpg-verifier', {
    verifyGpgSignature: async () => { throw new Error('Registry path should not GPG-verify'); }
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_toolName: string, _version: string) => null,
    downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
    extractZip: async () => { throw new Error('Should not extract when checksum verification is required and unavailable'); },
    cacheDir: async () => { throw new Error('Should not cache when checksum verification is required and unavailable'); },
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
