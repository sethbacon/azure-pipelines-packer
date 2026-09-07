import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'registry');
// azure-pipelines-terraform#1105 finding 1 (class): registryUrl may carry
// basic-auth userinfo here (a supported pattern), and task-lib's getInput()
// debug-logs every input raw at READ time -- before anything can mask it. The
// read goes through the package's silent reader; the run fails later (throwing
// client mock / unresolvable host) and the assertion is only that the credential
// never reaches a log-visible line.
tr.setInput('registryUrl', 'https://svc:PAT-s3cr3t-value@registry.example.com');
tr.setInput('registryMirrorName', 'packer');
tr.setInput('registryAllowedHosts', 'registry.example.com');

tr.registerMock('os', {
    type: () => 'Linux',
    arch: () => 'x64'
});

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('client mock: the run stops here (URL deliberately not echoed)'); },
    fetchText: async (url: string) => { throw new Error('client mock: the run stops here (URL deliberately not echoed)'); }
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
