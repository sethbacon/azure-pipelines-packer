import tl = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerVSphere } from '../src/vsphere-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

async function run() {
    try {
        const handler = new PackerCommandHandlerVSphere();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', 'vsphere');
        await handler.handleProvider(cmd);

        const ok = process.env['PKR_VAR_vsphere_server'] === 'vcenter.example.com'
            && process.env['PKR_VAR_vsphere_user'] === 'admin@vsphere.local'
            && process.env['PKR_VAR_vsphere_password'] === 'pw';
        if (ok) {
            tl.setResult(tl.TaskResult.Succeeded, 'vSphere env injected.');
        } else {
            tl.setResult(tl.TaskResult.Failed, 'vSphere env not injected: ' + JSON.stringify({
                server: process.env['PKR_VAR_vsphere_server'],
                user: process.env['PKR_VAR_vsphere_user']
            }));
        }
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
