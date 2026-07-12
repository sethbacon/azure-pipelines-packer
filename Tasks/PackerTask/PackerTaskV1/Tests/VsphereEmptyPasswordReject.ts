import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #74: vSphere with no password configured must fail closed (like AWS/GCP/OCI)
// rather than silently proceeding with server+user but no credential.
// getEndpointAuthorizationParameter(..., false) itself throws for an unset/empty
// value (#141) -- server and user are present; the password parameter is
// intentionally omitted so that throw is what this test exercises.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'validate');
tr.setInput('provider', 'vsphere');
tr.setInput('environmentServiceNameVSphere', 'vsphere');
tr.setInput('templatePath', '.');

process.env['ENDPOINT_URL_vsphere'] = 'https://vcenter.example.com/';
process.env['ENDPOINT_AUTH_PARAMETER_vsphere_USERNAME'] = 'admin@vsphere.local';
// Password deliberately omitted -> must fail closed.

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true }
};

tr.setAnswers(a);
tr.run();
