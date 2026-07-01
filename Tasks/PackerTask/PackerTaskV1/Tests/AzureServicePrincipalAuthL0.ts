import tl = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerAzureRM } from '../src/azure-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

async function run() {
    try {
        const handler = new PackerCommandHandlerAzureRM();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', 'AzureRM');
        await handler.handleProvider(cmd);

        const ok = process.env['PKR_VAR_arm_client_id'] === 'spid'
            && process.env['PKR_VAR_arm_client_secret'] === 'spkey'
            && process.env['PKR_VAR_arm_tenant_id'] === 'tenant'
            && process.env['PKR_VAR_arm_subscription_id'] === 'sub-123';
        if (ok) {
            tl.setResult(tl.TaskResult.Succeeded, 'Azure SP Packer variables injected.');
        } else {
            tl.setResult(tl.TaskResult.Failed, 'Azure SP Packer variables not injected: ' + JSON.stringify({
                clientId: process.env['PKR_VAR_arm_client_id'],
                tenant: process.env['PKR_VAR_arm_tenant_id'],
                sub: process.env['PKR_VAR_arm_subscription_id']
            }));
        }
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
