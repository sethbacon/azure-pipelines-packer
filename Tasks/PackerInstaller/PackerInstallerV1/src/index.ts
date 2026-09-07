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

    // Suite-scope residual of azure-pipelines-terraform#1113 finding 1: this task
    // writes no sensitive temp file, so cleanup() is a deliberate no-op -- the
    // handler is still registered so a cancelled run dies promptly instead of
    // lingering (registering a signal listener suppresses Node's default
    // terminate-on-signal behavior, so the signal must be re-raised with its
    // default disposition after cleanup), and an unawaited rejection anywhere
    // in a helper no longer falls through to Node's default handling with no
    // tasks.setResult call and no deterministic exit code. PackerTaskV1 already
    // carried this pattern; this installer was the one task here without it.
    const cleanup = (): void => { /* No sensitive temp file/state to clean up today. */ };
    const handleTerminationSignal = (signal: NodeJS.Signals) => {
        cleanup();
        process.removeListener(signal, handleTerminationSignal);
        process.kill(process.pid, signal);
    };
    process.on('SIGTERM', handleTerminationSignal);
    process.on('SIGINT', handleTerminationSignal);
    process.on('uncaughtException', (err) => {
        cleanup();
        tasks.setResult(tasks.TaskResult.Failed, `Uncaught exception: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
        cleanup();
        tasks.setResult(tasks.TaskResult.Failed, `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
        process.exit(1);
    });

    try {
        await configurePacker();
        await verifyPacker();
        tasks.setResult(tasks.TaskResult.Succeeded, "");
    } catch (error) {
        tasks.setResult(tasks.TaskResult.Failed, error instanceof Error ? error.message : String(error));
    } finally {
        process.removeListener('SIGTERM', handleTerminationSignal);
        process.removeListener('SIGINT', handleTerminationSignal);
    }
}

void run();
