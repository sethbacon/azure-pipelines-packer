import tl = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerAzureRM } from '../src/azure-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

async function run() {
    try {
        const handler = new PackerCommandHandlerAzureRM();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', 'AzureRM');
        await handler.handleProvider(cmd);

        const ok = process.env['ARM_CLIENT_ID'] === 'spid'
            && process.env['ARM_CLIENT_SECRET'] === 'spkey'
            && process.env['ARM_TENANT_ID'] === 'tenant'
            && process.env['ARM_SUBSCRIPTION_ID'] === 'sub-123';
        if (ok) {
            tl.setResult(tl.TaskResult.Succeeded, 'Azure SP env injected.');
        } else {
            tl.setResult(tl.TaskResult.Failed, 'Azure SP env not injected: ' + JSON.stringify({
                clientId: process.env['ARM_CLIENT_ID'],
                tenant: process.env['ARM_TENANT_ID'],
                sub: process.env['ARM_SUBSCRIPTION_ID']
            }));
        }
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
