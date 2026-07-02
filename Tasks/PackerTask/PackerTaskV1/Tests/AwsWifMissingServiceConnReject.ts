import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #73: AWS Workload Identity Federation with no service connection must fail
// closed (like the static path) instead of requesting an OIDC token for an empty
// service connection id. environmentServiceNameAWS is intentionally unset.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'validate');
tr.setInput('provider', 'aws');
tr.setInput('environmentAuthSchemeAWS', 'WorkloadIdentityFederation');
tr.setInput('templatePath', '.');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true }
};

tr.setAnswers(a);
tr.run();
