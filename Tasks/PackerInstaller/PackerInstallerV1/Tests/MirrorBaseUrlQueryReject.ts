import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// azure-pipelines-terraform#1110 finding 2 (class fix): every mirror request is
// `${mirrorBaseUrl}/<version>/<file>`, so a query string in the base would land
// the intended path inside the query string. Refused at the read, before any
// request; the http-client mock below throws so a missing guard fails for a
// different, visible reason rather than passing.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://mirror.example.com/hashicorp/packer?x=');

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
