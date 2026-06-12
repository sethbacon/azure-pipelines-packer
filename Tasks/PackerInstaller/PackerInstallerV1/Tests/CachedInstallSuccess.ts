import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

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

tr.registerMock('fs', {
    chmodSync: (_path: string, _mode: string) => { },
    readFileSync: (_path: string) => Buffer.from('fake-zip-content')
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    // Cache hit — returns a cached path so download/verify are skipped entirely
    findLocalTool: (_toolName: string, _version: string) => '/tmp/packer-cached',
    downloadTool: async (_url: string, _fileName: string) => { throw new Error('Should not download on cache hit'); },
    extractZip: async (_zipPath: string) => { throw new Error('Should not extract on cache hit'); },
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
