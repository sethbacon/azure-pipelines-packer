import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// Finding 0 of #342: the checkpoint API response was validated only for
// truthiness ("!data.current_version"), never type, so a body where
// current_version is present but NOT a string -- e.g. a number -- passed the
// old guard and would have flowed downstream as a version string. Contrast
// with HashiCorpLatestCheckpointInvalidResponseFail, which covers the field
// being absent entirely; this covers it being the wrong JSON type.
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
            return { current_version: 20260101 }; // malformed: number, not a string
        }
        throw new Error('Unexpected fetchJson URL: ' + url);
    },
    fetchText: async (url: string) => { throw new Error('Should not fetch SHA256SUMS when the checkpoint response is type-confused: ' + url); }
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_toolName: string, _version: string) => null,
    downloadTool: async () => { throw new Error('Should not download when the checkpoint response is type-confused'); },
    extractZip: async () => { throw new Error('Should not extract when the checkpoint response is type-confused'); },
    cacheDir: async () => { throw new Error('Should not cache when the checkpoint response is type-confused'); },
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
