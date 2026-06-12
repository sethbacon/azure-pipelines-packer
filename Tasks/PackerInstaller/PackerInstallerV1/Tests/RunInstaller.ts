import tl = require('azure-pipelines-task-lib/task');
import path = require('path');
import { downloadPacker } from '../src/packer-installer';

// Shared "task under test" entry for the installer mock-runner suites. Each
// scenario file (e.g. HashiCorpSpecificVersionSuccess.ts) sets inputs + mocks
// and then runs this compiled entry via TaskMockRunner.
tl.setResourcePath(path.join(__dirname, '..', 'task.json'));

async function run() {
    try {
        const version = tl.getInput('packerVersion', true)!;
        await downloadPacker(version);
        tl.setResult(tl.TaskResult.Succeeded, 'Packer installed.');
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, error instanceof Error ? error.message : String(error));
    }
}

run();
