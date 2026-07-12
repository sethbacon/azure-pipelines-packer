import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #141: vSphere with no service connection configured at all must fail closed
// (mirrors GcpWifMissingServiceConnReject/AwsWifMissingServiceConnReject).
// environmentServiceNameVSphere is intentionally unset.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'validate');
tr.setInput('provider', 'vsphere');
tr.setInput('templatePath', '.');

const a: ma.TaskLibAnswers = {
  which: { packer: 'packer' },
  checkPath: { packer: true }
};

tr.setAnswers(a);
tr.run();
