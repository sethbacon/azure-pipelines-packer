import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #111: an unrecognized authorization scheme must be rejected with a clear
// error, pinning the negative branch of mapAuthorizationScheme.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'validate');
tr.setInput('provider', 'azurerm');
tr.setInput('environmentServiceNameAzureRM', 'AzureRM');
tr.setInput('templatePath', '.');

process.env['ENDPOINT_AUTH_SCHEME_AzureRM'] = 'certificate';

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true }
};

tr.setAnswers(a);
tr.run();
