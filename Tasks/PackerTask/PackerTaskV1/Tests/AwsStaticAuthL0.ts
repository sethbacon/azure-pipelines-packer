import tl = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerAWS } from '../src/aws-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

async function run() {
    try {
        const handler = new PackerCommandHandlerAWS();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', 'AWS');
        await handler.handleProvider(cmd);

        const ok = process.env['AWS_ACCESS_KEY_ID'] === 'AKIATEST'
            && process.env['AWS_SECRET_ACCESS_KEY'] === 'secretkey'
            && process.env['AWS_REGION'] === 'us-east-1';
        if (ok) {
            tl.setResult(tl.TaskResult.Succeeded, 'AWS env injected.');
        } else {
            tl.setResult(tl.TaskResult.Failed, 'AWS env not injected: ' + JSON.stringify({
                id: process.env['AWS_ACCESS_KEY_ID'],
                region: process.env['AWS_REGION']
            }));
        }
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
