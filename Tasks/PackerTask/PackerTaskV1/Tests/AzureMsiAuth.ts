import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'AzureMsiAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'azurerm');
tr.setInput('environmentServiceNameAzureRM', 'AzureRM');

process.env['ENDPOINT_AUTH_SCHEME_AzureRM'] = 'ManagedServiceIdentity';
process.env['ENDPOINT_DATA_AzureRM_SUBSCRIPTIONID'] = 'sub-789';
// ADO still exposes a tenantid parameter for MSI-scheme connections; the
// handler must NOT forward it (packer-plugin-azure only falls back to
// Managed Identity when tenant_id, client_secret, client_jwt, and the OIDC
// fields are ALL unset).
process.env['ENDPOINT_AUTH_PARAMETER_AzureRM_TENANTID'] = 'msi-tenant-should-not-be-used';

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
