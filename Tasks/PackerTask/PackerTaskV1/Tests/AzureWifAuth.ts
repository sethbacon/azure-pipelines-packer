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

tr.registerMock('./id-token-generator', {
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
