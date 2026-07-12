import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'registry');
// Plain HTTP must be rejected before any network access (#139).
tr.setInput('registryUrl', 'http://registry.example.com');
tr.setInput('registryMirrorName', 'packer');

tr.registerMock('os', {
    type: () => 'Linux',
    arch: () => 'x64'
});

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Should not fetch with an insecure registryUrl: ' + url); },
    fetchText: async (url: string) => { throw new Error('Should not fetch with an insecure registryUrl: ' + url); }
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_toolName: string, _version: string) => null,
    downloadTool: async () => { throw new Error('Should not download with an insecure registryUrl'); },
    extractZip: async () => { throw new Error('Should not extract'); },
    cacheDir: async () => { throw new Error('Should not cache'); },
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
