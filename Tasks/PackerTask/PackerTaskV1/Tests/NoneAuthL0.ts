import tl = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerNone } from '../src/none-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

async function run() {
    try {
        const handler = new PackerCommandHandlerNone();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', '');
        await handler.handleProvider(cmd);
        tl.setResult(tl.TaskResult.Succeeded, 'None provider injects no credentials.');
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
