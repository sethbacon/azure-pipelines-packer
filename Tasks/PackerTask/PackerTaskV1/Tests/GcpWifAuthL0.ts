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
        const tokenFileExists = credsExist && !!creds.credential_source?.file && fs.existsSync(creds.credential_source.file);
        const tokenFileContents = tokenFileExists ? fs.readFileSync(creds.credential_source.file, 'utf8') : '';

        const ok = credsExist
            && creds.type === 'external_account'
            && creds.audience === '//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/my-pool/providers/my-provider'
            && creds.service_account_impersonation_url.includes('builder@my-project.iam.gserviceaccount.com')
            && tokenFileExists
            && tokenFileContents === 'mock-gcp-oidc-jwt-12345'
            // #72: GOOGLE_PROJECT_ID is dead for packer-plugin-googlecompute and must NOT be set.
            && process.env['GOOGLE_PROJECT_ID'] === undefined;
        if (ok) {
            tl.setResult(tl.TaskResult.Succeeded, 'GCP WIF external_account credentials written and injected.');
        } else {
            tl.setResult(tl.TaskResult.Failed, 'GCP WIF credentials not injected as expected: ' + JSON.stringify({
                credsFile, credsExist, audience: creds.audience, tokenFileExists
            }));
        }
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
