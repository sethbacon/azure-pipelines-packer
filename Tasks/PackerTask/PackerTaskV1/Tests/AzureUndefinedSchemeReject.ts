import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #97: An Azure service connection with no authorization scheme must fail closed
// rather than silently defaulting to Workload Identity Federation (which, via
// packer-plugin-azure's MSI fallback, could authenticate as the agent VM's
// ambient managed identity). Reuses the ServicePrincipal L0 runner, whose
// try/catch fails the task on any thrown error. ENDPOINT_AUTH_SCHEME_AzureRM is
// intentionally unset even though the connection is otherwise fully populated,
// proving the missing scheme alone is enough to fail closed.
const tp = path.join(__dirname, 'AzureServicePrincipalAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'azurerm');
tr.setInput('environmentServiceNameAzureRM', 'AzureRM');

// Scheme deliberately omitted -> must throw, not default to WIF.
process.env['ENDPOINT_DATA_AzureRM_SUBSCRIPTIONID'] = 'sub-123';
process.env['ENDPOINT_AUTH_PARAMETER_AzureRM_SERVICEPRINCIPALID'] = 'spid';
process.env['ENDPOINT_AUTH_PARAMETER_AzureRM_SERVICEPRINCIPALKEY'] = 'spkey';
process.env['ENDPOINT_AUTH_PARAMETER_AzureRM_TENANTID'] = 'tenant';

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
