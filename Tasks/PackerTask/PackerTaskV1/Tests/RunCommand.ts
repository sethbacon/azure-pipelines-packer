import tl = require('azure-pipelines-task-lib/task');
import path = require('path');
import { ParentCommandHandler } from '../src/parent-handler';

// Shared "task under test" entry for command mock-runner suites. Drives the real
// provider dispatch path (index -> parent -> handler -> tool). Each scenario file
// sets inputs + exec answers and runs this compiled entry via TaskMockRunner.
tl.setResourcePath(path.join(__dirname, '..', 'task.json'));

async function run() {
    const parent = new ParentCommandHandler();
    try {
        await parent.execute(tl.getInput('provider') || 'none', tl.getInput('command', true)!);
        tl.setResult(tl.TaskResult.Succeeded, 'Command succeeded.');
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, error instanceof Error ? error.message : String(error));
    }
}

run();
