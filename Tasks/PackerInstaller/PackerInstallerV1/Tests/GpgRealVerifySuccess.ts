import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import * as openpgp from 'openpgp';

// Exercises the REAL gpg-verifier.ts logic (openpgp.readKey/readSignature/
// createMessage/verify) end to end -- unlike every other installer test,
// this one does NOT mock './gpg-verifier'. Only the trust anchor is swapped
// (via a './hashicorp-gpg-key' mock) for a key generated in-test, so the
// verification code path itself is unmodified and unmocked.
async function main() {
    const EXPECTED_SHA256 = 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233';
    const sha256SumsContent = `${EXPECTED_SHA256}  packer_1.12.0_linux_amd64.zip\n`;

    const { privateKey, publicKey } = await openpgp.generateKey({
        type: 'rsa',
        rsaBits: 2048,
        userIDs: [{ name: 'Test Signer' }],
        format: 'armored'
    });
    const signingKey = await openpgp.readPrivateKey({ armoredKey: privateKey });
    const signatureBytes = await openpgp.sign({
        message: await openpgp.createMessage({ text: sha256SumsContent }),
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
            if (url.endsWith('SHA256SUMS')) return sha256SumsContent;
            throw new Error('Unexpected fetchText URL: ' + url);
        },
        fetchBuffer: async (url: string) => {
            if (url.endsWith('.sig')) return signatureBytes as Uint8Array;
            throw new Error('Unexpected fetchBuffer URL: ' + url);
        }
    });

    // Swap the trust anchor for a test-generated key; gpg-verifier.ts itself is
    // untouched and runs its real openpgp verification logic against it.
    tr.registerMock('./hashicorp-gpg-key', { HASHICORP_GPG_PUBLIC_KEY: publicKey });

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
}

main();
