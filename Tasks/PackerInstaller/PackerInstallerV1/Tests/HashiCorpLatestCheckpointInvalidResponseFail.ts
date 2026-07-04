import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #106: the checkpoint API responding successfully but with a body missing
// current_version indicates the API contract itself broke -- not a transient network
// blip -- so this must FAIL rather than silently fall back to FALLBACK_PACKER_VERSION.
// Contrast with HashiCorpLatestCheckpointDownFallback, where the request itself fails.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', 'latest');
tr.setInput('downloadSource', 'hashicorp');

tr.registerMock('os', {
    type: () => 'Linux',
    arch: () => 'x64'
});

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => {
        if (url.startsWith('https://checkpoint-api.hashicorp.com/')) {
            return {}; // malformed: missing current_version
        }
        throw new Error('Unexpected fetchJson URL: ' + url);
    },
    fetchText: async (url: string) => { throw new Error('Should not fetch SHA256SUMS when checkpoint response is invalid: ' + url); }
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_toolName: string, _version: string) => null,
    downloadTool: async () => { throw new Error('Should not download when checkpoint response is invalid'); },
    extractZip: async () => { throw new Error('Should not extract when checkpoint response is invalid'); },
    cacheDir: async () => { throw new Error('Should not cache when checkpoint response is invalid'); },
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
