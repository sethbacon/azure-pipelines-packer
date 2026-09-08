import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'VsphereAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'vsphere');
tr.setInput('vsphereInsecureConnection', 'true');

// A PUBLIC IP literal. Disabling vCenter certificate verification against a
// public destination is the on-path interception the option's own warning
// describes, so the task must refuse rather than warn. Decided without DNS.
process.env['ENDPOINT_URL_vsphere'] = 'https://93.184.216.34/';
process.env['ENDPOINT_AUTH_PARAMETER_vsphere_USERNAME'] = 'admin@vsphere.local';
process.env['ENDPOINT_AUTH_PARAMETER_vsphere_PASSWORD'] = 'pw';

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
