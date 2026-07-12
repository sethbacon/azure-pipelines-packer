import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import * as openpgp from 'openpgp';

// Regression test for #137: a detached .sig can carry more than one signature (e.g. a
// signing-key rotation window). This builds a signature from TWO signing keys -- an
// "untrusted" key first, then the trusted HashiCorp-stand-in key second -- so
// result.signatures[0] belongs to a key gpg-verifier.ts's mocked trust anchor cannot
// verify, while result.signatures[1] is genuinely valid. Only checking signatures[0]
// (the pre-#137 behavior) would incorrectly fail this; checking all of them succeeds.
async function main() {
  const EXPECTED_SHA256 = 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233';
  const sha256SumsContent = `${EXPECTED_SHA256}  packer_1.12.0_linux_amd64.zip\n`;

  const { privateKey: untrustedPrivateKey } = await openpgp.generateKey({
    type: 'rsa',
    rsaBits: 2048,
    userIDs: [{ name: 'Untrusted Signer' }],
    format: 'armored'
  });
  const { privateKey: hashicorpPrivateKey, publicKey: hashicorpPublicKey } = await openpgp.generateKey({
    type: 'rsa',
    rsaBits: 2048,
    userIDs: [{ name: 'Test HashiCorp Stand-in' }],
    format: 'armored'
  });

  const untrustedSigningKey = await openpgp.readPrivateKey({ armoredKey: untrustedPrivateKey });
  const hashicorpSigningKey = await openpgp.readPrivateKey({ armoredKey: hashicorpPrivateKey });

  // Order matters: signingKeys[0] (untrusted) must produce result.signatures[0].
  const signatureBytes = await openpgp.sign({
    message: await openpgp.createMessage({ text: sha256SumsContent }),
    signingKeys: [untrustedSigningKey, hashicorpSigningKey],
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
    fetchBufferAllow404: async (url: string) => {
      if (url.endsWith('.sig')) return signatureBytes as Uint8Array;
      throw new Error('Unexpected fetchBufferAllow404 URL: ' + url);
    }
  });

  // Only the HashiCorp stand-in's public key is a trusted verification key --
  // the untrusted signer's signature (index 0) cannot be matched against it.
  tr.registerMock('./hashicorp-gpg-key', { HASHICORP_GPG_PUBLIC_KEY: hashicorpPublicKey });

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
