import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #141: a vSphere service connection whose server URL is fundamentally unparseable
// (not merely disallowed-charset, unlike VsphereServerInvalidCharsetReject) must fail
// closed -- exercises the outer catch: even after the `https://` prefix fallback,
// `new URL()` itself rejects the value before the hostname charset regex ever runs.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'validate');
tr.setInput('provider', 'vsphere');
tr.setInput('environmentServiceNameVSphere', 'vsphere');
tr.setInput('templatePath', '.');

// A single space is truthy (so getEndpointUrl's required check passes) but makes
// even `https:// ` unparseable as a URL.
process.env['ENDPOINT_URL_vsphere'] = ' ';
process.env['ENDPOINT_AUTH_PARAMETER_vsphere_USERNAME'] = 'admin@vsphere.local';
process.env['ENDPOINT_AUTH_PARAMETER_vsphere_PASSWORD'] = 'hunter2';

const a: ma.TaskLibAnswers = {
  which: { packer: 'packer' },
  checkPath: { packer: true }
};

tr.setAnswers(a);
tr.run();
