import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'AzureServicePrincipalAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'azurerm');
tr.setInput('environmentServiceNameAzureRM', 'AzureRM');

process.env['ENDPOINT_AUTH_SCHEME_AzureRM'] = 'ServicePrincipal';
process.env['ENDPOINT_DATA_AzureRM_SUBSCRIPTIONID'] = 'sub-123';
process.env['ENDPOINT_AUTH_PARAMETER_AzureRM_SERVICEPRINCIPALID'] = 'spid';
process.env['ENDPOINT_AUTH_PARAMETER_AzureRM_SERVICEPRINCIPALKEY'] = 'spkey';
process.env['ENDPOINT_AUTH_PARAMETER_AzureRM_TENANTID'] = 'tenant';

// The handler now pre-flights `packer inspect` to confirm the template
// DECLARES the variable the credential is injected into (#332). Packer
// silently drops a PKR_VAR_ for an undeclared variable, and for Azure a
// dropped credential leaves UseMSI() true -- the build then authenticates
// as the agent VM's identity. Declaring it here is the success path.
const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer inspect .': { code: 0, stdout: 'var.arm_client_secret: ""\nvar.arm_client_id: ""\n' }
    }
};
tr.setAnswers(a);
tr.run();
