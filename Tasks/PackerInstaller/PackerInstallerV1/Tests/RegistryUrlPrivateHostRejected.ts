import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #330: registryUrl's OWN host was never egress-authorized -- the guard was applied
// only to the download_url the registry hands back. So a registryUrl naming a
// private/link-local/metadata address was fetched with no check at all, and because
// registryUrl explicitly supports basic-auth userinfo, the operator's registry
// credential rode along on that request to the internal host.
//
// This is the version-resolution leg (packerVersion: latest), which reaches the
// network BEFORE any download_url exists -- so the download_url guard cannot
// possibly cover it. Every http-client mock throws, so the test fails loudly if the
// request is made at all rather than passing on a coincidental error.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', 'latest');
tr.setInput('downloadSource', 'registry');
tr.setInput('registryUrl', 'https://169.254.169.254/artifactory');
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
