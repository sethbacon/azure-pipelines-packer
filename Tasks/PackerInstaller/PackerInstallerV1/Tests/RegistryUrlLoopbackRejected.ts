import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #330, the pinned-version leg. With an explicit version there is no version
// resolution, so the FIRST request is the info fetch against registryUrl itself --
// still before any download_url exists. A registryUrl on a loopback address must be
// refused here too, which is why the guard belongs in getValidatedRegistryUrl()
// rather than at either individual call site.
//
// registryAllowedHosts is deliberately left unset: the baseline refusal of
// private/reserved addresses must hold without the operator configuring anything.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'registry');
tr.setInput('registryUrl', 'https://127.0.0.1:9000/artifactory');
tr.setInput('registryMirrorName', 'hashicorp');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64' });

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Refused host must not be fetched: ' + url); },
    fetchText: async (url: string) => { throw new Error('Refused host must not be fetched: ' + url); },
    fetchTextAllow404: async (url: string) => { throw new Error('Refused host must not be fetched: ' + url); },
    downloadToFile: async (url: string) => { throw new Error('Refused host must not be downloaded: ' + url); }
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => null,
    cleanVersion: (v: string) => v,
    prependPath: (_p: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
