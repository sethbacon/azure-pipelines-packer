import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #161/#201: a mirrorBaseUrl pointing at a private/link-local address is refused
// BEFORE any request is made, and the operator is told why in the task's own
// localized text. A literal RFC1918 host exercises the numeric classification
// without needing DNS. The assertion in L0.ts reads the rendered message, which
// is what catches a loc key that exists only in the resjson and renders as its
// bare key name.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'mirror');
tr.setInput('mirrorBaseUrl', 'https://10.0.0.5/hashicorp/packer');

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
