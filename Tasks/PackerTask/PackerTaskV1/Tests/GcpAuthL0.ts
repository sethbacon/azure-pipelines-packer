import tl = require('azure-pipelines-task-lib/task');
import fs = require('fs');
import { PackerCommandHandlerGCP } from '../src/gcp-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

async function run() {
    try {
        const handler = new PackerCommandHandlerGCP();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', 'GCP');
        await handler.handleProvider(cmd);

        const credsFile = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
        const credsExist = !!credsFile && fs.existsSync(credsFile);
        const creds = credsExist ? JSON.parse(fs.readFileSync(credsFile!, 'utf8')) : {};

        const ok = credsExist
            && creds.type === 'service_account'
            && creds.client_email === 'builder@my-project.iam.gserviceaccount.com'
            && creds.private_key.includes('BEGIN PRIVATE KEY')
            // #72: GOOGLE_PROJECT_ID is dead for packer-plugin-googlecompute and must NOT be set.
            && process.env['GOOGLE_PROJECT_ID'] === undefined;
        if (ok) {
            tl.setResult(tl.TaskResult.Succeeded, 'GCP service-account credentials written and injected.');
        } else {
            tl.setResult(tl.TaskResult.Failed, 'GCP credentials not injected as expected: ' + JSON.stringify({
                credsFile,
                credsExist,
                clientEmail: creds.client_email,
                project: process.env['GOOGLE_PROJECT_ID']
            }));
        }
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
