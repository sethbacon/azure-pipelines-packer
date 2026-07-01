import tl = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerOCI } from '../src/oci-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';
import fs = require('fs');

async function run() {
    try {
        const handler = new PackerCommandHandlerOCI();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', 'OCI');
        await handler.handleProvider(cmd);

        const keyFile = process.env['PKR_VAR_oci_key_file'];
        const ok = process.env['PKR_VAR_oci_tenancy_ocid'] === 'ocid1.tenancy.oc1..aaaaaaaaexampletenancyocid'
            && process.env['PKR_VAR_oci_user_ocid'] === 'ocid1.user.oc1..aaaaaaaaexampleuserocid'
            && process.env['PKR_VAR_oci_region'] === 'us-ashburn-1'
            && process.env['PKR_VAR_oci_fingerprint'] === 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99'
            && !!keyFile && fs.existsSync(keyFile);
        if (ok) {
            tl.setResult(tl.TaskResult.Succeeded, 'OCI env injected.');
        } else {
            tl.setResult(tl.TaskResult.Failed, 'OCI env not injected: ' + JSON.stringify({
                tenancy: process.env['PKR_VAR_oci_tenancy_ocid'],
                region: process.env['PKR_VAR_oci_region'],
                keyFile
            }));
        }
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
