import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'registry');
// Every consumer of registryUrl concatenates a fixed API path onto it, so a
// query string in the base would land the intended path inside the query
// string instead of the URL path (azure-pipelines-terraform#1110 finding 2,
// suite-scope residual). Must be rejected before any network access.
tr.setInput('registryUrl', 'https://registry.example.com/?x=');
tr.setInput('registryMirrorName', 'packer');

tr.registerMock('os', {
    type: () => 'Linux',
    arch: () => 'x64'
});

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Should not fetch with a query-carrying registryUrl: ' + url); },
    fetchText: async (url: string) => { throw new Error('Should not fetch with a query-carrying registryUrl: ' + url); }
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_toolName: string, _version: string) => null,
    downloadTool: async () => { throw new Error('Should not download with a query-carrying registryUrl'); },
    extractZip: async () => { throw new Error('Should not extract'); },
    cacheDir: async () => { throw new Error('Should not cache'); },
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
