import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #161/#201: with mirrorAllowedHosts set, a public mirror host that is not on the
// list is refused, and the message names both the host and the allowlist so the
// operator can see what to add. The counterpart to MirrorPrivateHostRejected:
// that one covers the private-address branch, this one the allowlist branch.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://artifacts.example.com/hashicorp/packer');
tr.setInput('mirrorAllowedHosts', 'mirror.corp.example.net');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64' });

tr.registerMock('./http-client', {
  fetchJson: async (url: string) => { throw new Error('Refused host must not be fetched: ' + url); },
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
