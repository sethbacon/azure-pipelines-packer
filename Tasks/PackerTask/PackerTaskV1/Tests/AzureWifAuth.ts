import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'AzureWifAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'azurerm');
tr.setInput('environmentServiceNameAzureRM', 'AzureRM');

process.env['ENDPOINT_AUTH_SCHEME_AzureRM'] = 'WorkloadIdentityFederation';
process.env['ENDPOINT_DATA_AzureRM_SUBSCRIPTIONID'] = 'sub-456';
process.env['ENDPOINT_AUTH_PARAMETER_AzureRM_SERVICEPRINCIPALID'] = 'wif-spid';
process.env['ENDPOINT_AUTH_PARAMETER_AzureRM_TENANTID'] = 'wif-tenant';

// import = require() (not a hoisted ES import) so azure-pipelines-task-lib/task.js
// is not required until after every tr.setInput()/process.env assignment above --
// task.js snapshots the input vault from process.env exactly once per process, on
// its own first require, so requiring it any earlier makes every input above
// invisible to the real getInput() the spawned entry point calls.
import pipelineTaskAdo = require('@4cloudguru/pipeline-task-ado');

// Only generateIdToken is faked (no real OIDC network call in a unit test); every
// other export -- EnvironmentVariableHelper included -- stays the real, published
// implementation so its actual (shared, static) behavior is exercised.
tr.registerMock('@4cloudguru/pipeline-task-ado', {
    ...pipelineTaskAdo,
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
