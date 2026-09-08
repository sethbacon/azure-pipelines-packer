import tl = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerVSphere } from '../src/vsphere-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

async function run() {
    try {
        const handler = new PackerCommandHandlerVSphere();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', 'vsphere');
        await handler.handleProvider(cmd);

        // Two fixtures share this entry: VsphereAuth uses the public name, and the
        // insecure-connection ones use a private literal, because disabling vCenter
        // certificate verification is honoured only against a private destination
        // (azure-pipelines-terraform#588). Accept either spelling of the server.
        const server = process.env['PKR_VAR_vsphere_server'];
        const ok = (server === 'vcenter.example.com' || server === '10.10.1.5')
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
