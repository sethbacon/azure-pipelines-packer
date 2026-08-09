import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #111: the registry's pre-signed download_url carries a live storage credential in
// its query string. On a download failure, tool-lib's own exception can embed that
// full URL verbatim (its error messages echo the request URL); redactUrl() plus the
// exception-message scrub must strip it before the failure ever reaches the task's
// error output. This is the only coverage of that specific catch block (packer-
// installer.ts's downloadZipFromRegistry, "download_url is a pre-signed URL..." scrub).
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'registry');
tr.setInput('registryUrl', 'https://registry.example.com');
tr.setInput('registryMirrorName', 'packer');

const SIG_TOKEN = 'SUPERSECRETSIGNATUREtoken9999';
const PRESIGNED_URL = `https://storage.example.com/signed/packer_1.12.0_linux_amd64.zip?sig=${SIG_TOKEN}`;

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

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
                download_url: PRESIGNED_URL,
                sha256: 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233'
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
    // Simulate tool-lib's own network-error message echoing the full request URL.
    downloadTool: async (url: string, _fileName: string) => {
        throw new Error(`Failed to download from ${url}: connection reset`);
    },
    extractZip: async () => { throw new Error('Should not extract after a download failure'); },
    cacheDir: async () => { throw new Error('Should not cache after a download failure'); },
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
