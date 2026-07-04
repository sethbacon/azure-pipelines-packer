import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'validate');
tr.setInput('provider', 'vsphere');
tr.setInput('environmentServiceNameVSphere', 'vsphere');
tr.setInput('templatePath', '.');

// #110: an IPv6 literal host survives URL parsing but fails the vCenter
// hostname[:port] charset validator -- must fail closed rather than inject an
// unvalidated value into PKR_VAR_vsphere_server. (A documented limitation,
// not a regression target: real vCenter endpoints are overwhelmingly
// hostnames/IPv4.)
process.env['ENDPOINT_URL_vsphere'] = 'https://[::1]:443/sdk';
process.env['ENDPOINT_AUTH_PARAMETER_vsphere_USERNAME'] = 'admin@vsphere.local';
process.env['ENDPOINT_AUTH_PARAMETER_vsphere_PASSWORD'] = 'pw';

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true }
};

tr.setAnswers(a);
tr.run();
