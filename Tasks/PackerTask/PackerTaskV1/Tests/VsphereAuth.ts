import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'VsphereAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'vsphere');

process.env['ENDPOINT_URL_vsphere'] = 'https://vcenter.example.com/';
process.env['ENDPOINT_AUTH_PARAMETER_vsphere_USERNAME'] = 'admin@vsphere.local';
process.env['ENDPOINT_AUTH_PARAMETER_vsphere_PASSWORD'] = 'pw';

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
