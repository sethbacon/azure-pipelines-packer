import tasks = require('azure-pipelines-task-lib/task');
import { ParentCommandHandler } from './parent-handler';
import path = require('path');

async function run() {
    tasks.setResourcePath(path.join(__dirname, '..', 'task.json'));

    const parentHandler = new ParentCommandHandler();

    // Register process-level cleanup as defense-in-depth for unexpected termination
    const cleanup = () => parentHandler.emergencyCleanup();
    // Registering a listener for SIGTERM/SIGINT suppresses Node's default
    // terminate-on-signal behavior, so re-raise the signal (with the listener
    // removed first, restoring default disposition) after cleanup runs --
    // otherwise pipeline cancellation could leave this process lingering
    // instead of terminating promptly (#106). Kept separate from `cleanup`
    // (used with no arguments below) since it needs the signal name to re-raise.
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
        await parentHandler.execute(tasks.getInput("provider") || "none", tasks.getInput("command", true)!);
        tasks.setResult(tasks.TaskResult.Succeeded, "");
    } catch (error) {
        tasks.setResult(tasks.TaskResult.Failed, error instanceof Error ? error.message : String(error));
    } finally {
        process.removeListener('SIGTERM', handleTerminationSignal);
        process.removeListener('SIGINT', handleTerminationSignal);
    }
}

void run();
