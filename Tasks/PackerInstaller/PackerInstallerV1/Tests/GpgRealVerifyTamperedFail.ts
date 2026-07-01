import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import * as openpgp from 'openpgp';

// Same real (unmocked) gpg-verifier.ts path as GpgRealVerifySuccess, but the
// SHA256SUMS content served to the installer does not match what was signed
// -- the real openpgp verify must reject it.
async function main() {
    const SIGNED_SHA256SUMS = 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233  packer_1.12.0_linux_amd64.zip\n';
    const TAMPERED_SHA256SUMS = 'ffffffff00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233  packer_1.12.0_linux_amd64.zip\n';

    const { privateKey, publicKey } = await openpgp.generateKey({
        type: 'rsa',
        rsaBits: 2048,
        userIDs: [{ name: 'Test Signer' }],
        format: 'armored'
    });
    const signingKey = await openpgp.readPrivateKey({ armoredKey: privateKey });
    // Sign the ORIGINAL content...
    const signatureBytes = await openpgp.sign({
        message: await openpgp.createMessage({ text: SIGNED_SHA256SUMS }),
        signingKeys: signingKey,
        detached: true,
        format: 'binary'
    });

    const tp = path.join(__dirname, 'RunInstaller.js');
    const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

    tr.setInput('packerVersion', '1.12.0');
    tr.setInput('downloadSource', 'hashicorp');

    tr.registerMock('os', {
        type: () => 'Linux',
        arch: () => 'x64'
    });

    tr.registerMock('./http-client', {
        fetchJson: async (url: string) => { throw new Error('Should not fetchJson on hashicorp path: ' + url); },
        fetchText: async (url: string) => {
            // ...but serve TAMPERED content alongside the original signature.
            if (url.endsWith('SHA256SUMS')) return TAMPERED_SHA256SUMS;
            throw new Error('Unexpected fetchText URL: ' + url);
        },
        fetchBuffer: async (url: string) => {
            if (url.endsWith('.sig')) return signatureBytes as Uint8Array;
            throw new Error('Unexpected fetchBuffer URL: ' + url);
        }
    });

    tr.registerMock('./hashicorp-gpg-key', { HASHICORP_GPG_PUBLIC_KEY: publicKey });

    tr.registerMock('azure-pipelines-tool-lib/tool', {
        findLocalTool: (_toolName: string, _version: string) => null,
        downloadTool: async (_url: string, _fileName: string) => '/tmp/packer.zip',
        extractZip: async () => { throw new Error('Should not extract when GPG verification fails'); },
        cacheDir: async () => { throw new Error('Should not cache when GPG verification fails'); },
        cleanVersion: (version: string) => version,
        prependPath: (_toolPath: string) => { }
    });

    const a: ma.TaskLibAnswers = {};
    tr.setAnswers(a);
    tr.run();
}

main();
