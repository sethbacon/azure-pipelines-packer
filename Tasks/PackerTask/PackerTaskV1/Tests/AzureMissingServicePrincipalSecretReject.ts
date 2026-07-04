import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #97: A ServicePrincipal-scheme Azure service connection missing its key must
// fail closed rather than proceeding with an undefined credential (which could
// let packer-plugin-azure silently fall through to ambient MSI auth).
const tp = path.join(__dirname, 'AzureServicePrincipalAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'azurerm');
tr.setInput('environmentServiceNameAzureRM', 'AzureRM');

process.env['ENDPOINT_AUTH_SCHEME_AzureRM'] = 'ServicePrincipal';
process.env['ENDPOINT_DATA_AzureRM_SUBSCRIPTIONID'] = 'sub-123';
process.env['ENDPOINT_AUTH_PARAMETER_AzureRM_SERVICEPRINCIPALID'] = 'spid';
// Key deliberately omitted -> must throw, not proceed with an undefined secret.
process.env['ENDPOINT_AUTH_PARAMETER_AzureRM_TENANTID'] = 'tenant';

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
