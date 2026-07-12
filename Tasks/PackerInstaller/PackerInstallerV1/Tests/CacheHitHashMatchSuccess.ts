import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #136: a cache hit whose recorded sidecar hash MATCHES the cached binary's actual
// (mocked) hash must succeed -- the common case, exercised explicitly here rather
// than only implicitly via CachedInstallSuccess (which never mocks existsSync, so it
// only ever exercises the "no sidecar yet" fail-open branch).
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'hashicorp');

tr.registerMock('os', {
  type: () => 'Linux',
  arch: () => 'x64'
});

tr.registerMock('./http-client', {
  fetchJson: async (url: string) => { throw new Error('Should not fetch on cache hit: ' + url); },
  fetchText: async (url: string) => { throw new Error('Should not fetch on cache hit: ' + url); }
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('./gpg-verifier', {
  verifyGpgSignature: async () => { throw new Error('Should not verify on cache hit'); }
});

const MATCHING_HASH = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

tr.registerMock('fs', {
  chmodSync: (_path: string, _mode: string) => { },
  existsSync: (filePath: string) => filePath === '/tmp/packer-cached/packer.sha256',
  readFileSync: (filePath: string, _encoding?: string) => {
    if (filePath === '/tmp/packer-cached/packer.sha256') {
      return MATCHING_HASH;
    }
    return Buffer.from('current-binary-content');
  },
  writeFileSync: (_path: string, _data: string) => { throw new Error('Should not write a new hash when one already matches'); }
});

tr.registerMock('crypto', {
  randomUUID: () => 'test-uuid-1234',
  createHash: (_algorithm: string) => ({
    update: (_data: unknown) => ({
      digest: (_encoding: string) => MATCHING_HASH
    })
  })
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
  findLocalTool: (_toolName: string, _version: string) => '/tmp/packer-cached',
  downloadTool: async () => { throw new Error('Should not download on cache hit'); },
  extractZip: async () => { throw new Error('Should not extract on cache hit'); },
  cacheDir: async () => { throw new Error('Should not cache on cache hit'); },
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
