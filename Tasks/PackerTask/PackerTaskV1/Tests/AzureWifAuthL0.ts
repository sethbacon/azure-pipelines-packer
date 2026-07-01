import tl = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerAzureRM } from '../src/azure-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

async function run() {
    try {
        const handler = new PackerCommandHandlerAzureRM();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', 'AzureRM');
        await handler.handleProvider(cmd);

        const ok = process.env['PKR_VAR_arm_client_id'] === 'wif-spid'
            && process.env['PKR_VAR_arm_tenant_id'] === 'wif-tenant'
            && process.env['PKR_VAR_arm_client_jwt'] === 'mock-oidc-jwt-12345'
            && process.env['PKR_VAR_arm_subscription_id'] === 'sub-456'
            && process.env['PKR_VAR_arm_client_secret'] === undefined;
        if (ok) {
            tl.setResult(tl.TaskResult.Succeeded, 'Azure WIF Packer variables injected.');
        } else {
            tl.setResult(tl.TaskResult.Failed, 'Azure WIF Packer variables not injected as expected: ' + JSON.stringify({
                clientId: process.env['PKR_VAR_arm_client_id'],
                tenant: process.env['PKR_VAR_arm_tenant_id'],
                jwt: process.env['PKR_VAR_arm_client_jwt'],
                sub: process.env['PKR_VAR_arm_subscription_id'],
                secret: process.env['PKR_VAR_arm_client_secret']
            }));
        }
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
