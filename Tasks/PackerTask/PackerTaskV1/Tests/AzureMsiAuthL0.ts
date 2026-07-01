import tl = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerAzureRM } from '../src/azure-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

async function run() {
    try {
        const handler = new PackerCommandHandlerAzureRM();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', 'AzureRM');
        await handler.handleProvider(cmd);

        // packer-plugin-azure's UseMSI() fallback requires client_secret, client_jwt,
        // client_cert_path, tenant_id, and the OIDC request fields to ALL be unset.
        // subscription_id may still be set alongside MSI to pin the subscription.
        const ok = process.env['PKR_VAR_arm_subscription_id'] === 'sub-789'
            && process.env['PKR_VAR_arm_tenant_id'] === undefined
            && process.env['PKR_VAR_arm_client_id'] === undefined
            && process.env['PKR_VAR_arm_client_secret'] === undefined
            && process.env['PKR_VAR_arm_client_jwt'] === undefined;
        if (ok) {
            tl.setResult(tl.TaskResult.Succeeded, 'Azure MSI leaves UseMSI() fallback fields unset.');
        } else {
            tl.setResult(tl.TaskResult.Failed, 'Azure MSI injected a field that would disable the plugin MSI fallback: ' + JSON.stringify({
                sub: process.env['PKR_VAR_arm_subscription_id'],
                tenant: process.env['PKR_VAR_arm_tenant_id'],
                clientId: process.env['PKR_VAR_arm_client_id'],
                secret: process.env['PKR_VAR_arm_client_secret'],
                jwt: process.env['PKR_VAR_arm_client_jwt']
            }));
        }
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
