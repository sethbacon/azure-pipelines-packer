import tasks = require('azure-pipelines-task-lib/task');
import tools = require('azure-pipelines-tool-lib/tool');
import { ToolRunner } from 'azure-pipelines-task-lib/toolrunner';
import path = require('path');
import * as installer from './packer-installer';

async function configurePacker() {
    const inputVersion = tasks.getInput("packerVersion", true)!;
    const packerPath = await installer.downloadPacker(inputVersion);
    const envPath = process.env['PATH'];

    // Prepend the tools path. Instructs the agent to prepend for future tasks.
    if (envPath && !envPath.startsWith(path.dirname(packerPath))) {
        tools.prependPath(path.dirname(packerPath));
    }
}

async function verifyPacker() {
    console.log(tasks.loc("VerifyPackerInstallation"));
    const packerPath = tasks.which("packer", true);
    const packerTool: ToolRunner = tasks.tool(packerPath);
    packerTool.arg("version");
    return packerTool.exec();
}

async function run() {
    tasks.setResourcePath(path.join(__dirname, '..', 'task.json'));

    try {
        await configurePacker();
        await verifyPacker();
        tasks.setResult(tasks.TaskResult.Succeeded, "");
    } catch (error) {
        tasks.setResult(tasks.TaskResult.Failed, error instanceof Error ? error.message : String(error));
    }
}

void run();
