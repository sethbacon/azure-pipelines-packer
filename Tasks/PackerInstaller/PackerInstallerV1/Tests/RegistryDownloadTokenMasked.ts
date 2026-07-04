import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'registry');
tr.setInput('registryUrl', 'https://registry.example.com');
tr.setInput('registryMirrorName', 'packer');

tr.registerMock('os', {
    type: () => 'Linux',
    arch: () => 'x64'
});

const EXPECTED_SHA256 = 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233';

// A synthetic pre-signed download_url that stacks token parameters from all three
// storage backends (AWS S3, GCS, Azure SAS) so a single run proves every sensitive
// component is registered as a secret while benign params stay visible. Values are
// chosen free of %/&/=/# so their masked form appears verbatim in stdout. Mixing
// schemes in one URL is unrealistic but the extractor is scheme-agnostic, so this is
// purely for coverage.
const AWS_SIGNATURE = 'AWSSIGNATUREtoken1111';        // X-Amz-Signature       -> masked
const AWS_CREDENTIAL = 'AWSCREDENTIALtoken2222';      // X-Amz-Credential      -> masked
const AWS_SECURITY_TOKEN = 'AWSSECURITYtoken3333';    // X-Amz-Security-Token  -> masked
const GOOG_SIGNATURE = 'GOOGSIGNATUREtoken4444';      // X-Goog-Signature      -> masked
const GOOG_CREDENTIAL = 'GOOGCREDENTIALtoken5555';    // X-Goog-Credential     -> masked
const AZURE_SIG = 'AZURESIGtoken6666';                // sig (Azure SAS)       -> masked
const BENIGN_DATE = '20260703T000000Z';              // X-Amz-Date            -> NOT masked
const BENIGN_SIGNED_HEADERS = 'host';                 // X-Amz-SignedHeaders   -> NOT masked

const PRESIGNED_URL =
    'https://storage.example.com/signed/packer_1.12.0_linux_amd64.zip' +
    '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
    `&X-Amz-Credential=${AWS_CREDENTIAL}` +
    `&X-Amz-Date=${BENIGN_DATE}` +
    '&X-Amz-Expires=900' +
    `&X-Amz-SignedHeaders=${BENIGN_SIGNED_HEADERS}` +
    `&X-Amz-Security-Token=${AWS_SECURITY_TOKEN}` +
    `&X-Amz-Signature=${AWS_SIGNATURE}` +
    `&X-Goog-Credential=${GOOG_CREDENTIAL}` +
    `&X-Goog-Signature=${GOOG_SIGNATURE}` +
    `&sig=${AZURE_SIG}`;

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => {
        if (url.includes('/terraform/binaries/packer/versions/1.12.0/linux/amd64')) {
            return {
                download_url: PRESIGNED_URL,
                sha256: EXPECTED_SHA256
            };
        }
        throw new Error('Unexpected fetchJson URL: ' + url);
    },
    fetchText: async (url: string) => { throw new Error('Registry path should not fetch SHA256SUMS text: ' + url); }
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('./gpg-verifier', {
    verifyGpgSignature: async () => { throw new Error('Registry path should not GPG-verify'); }
});

tr.registerMock('fs', {
    chmodSync: (_path: string, _mode: string) => { },
    readFileSync: (_path: string) => Buffer.from('fake-zip-content')
});

tr.registerMock('crypto', {
    randomUUID: () => 'test-uuid-1234',
    createHash: (_algorithm: string) => ({
        update: (_data: unknown) => ({
            digest: (_encoding: string) => EXPECTED_SHA256
        })
    })
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
