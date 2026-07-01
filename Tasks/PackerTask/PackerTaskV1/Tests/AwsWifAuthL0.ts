import tl = require('azure-pipelines-task-lib/task');
import fs = require('fs');
import { PackerCommandHandlerAWS } from '../src/aws-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

async function run() {
    try {
        const handler = new PackerCommandHandlerAWS();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', 'AWS');
        await handler.handleProvider(cmd);

        const tokenFile = process.env['AWS_WEB_IDENTITY_TOKEN_FILE'];
        const tokenFileExists = !!tokenFile && fs.existsSync(tokenFile);
        const tokenContents = tokenFileExists ? fs.readFileSync(tokenFile!, 'utf8') : '';

        const ok = process.env['AWS_ROLE_ARN'] === 'arn:aws:iam::123456789012:role/packer-builder'
            && process.env['AWS_REGION'] === 'us-east-1'
            && process.env['AWS_ROLE_SESSION_NAME'] === 'AzureDevOps-Packer'
            && tokenFileExists
            && tokenContents === 'mock-aws-oidc-jwt-12345';
        if (ok) {
            tl.setResult(tl.TaskResult.Succeeded, 'AWS WIF web-identity token file written and injected.');
        } else {
            tl.setResult(tl.TaskResult.Failed, 'AWS WIF not injected as expected: ' + JSON.stringify({
                roleArn: process.env['AWS_ROLE_ARN'],
                region: process.env['AWS_REGION'],
                tokenFileExists
            }));
        }
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
