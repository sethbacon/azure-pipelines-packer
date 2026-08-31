import tasks = require('azure-pipelines-task-lib/task');
import { ParentCommandHandler } from './parent-handler';
import path = require('path');

async function run() {
    // Finding 2 of #342: everything from here down to the first `await` runs
    // synchronously, so a throw anywhere in it previously bypassed this task's
    // own cleanup/Failed-result path entirely -- the process.on(...)
    // registrations below did not exist yet at that instant. ParentCommandHandler
    // construction, the cleanup/handleTerminationSignal definitions, and all four
    // registrations now happen FIRST, before tasks.setResourcePath(...) or
    // anything else that could throw, so the narrow early-startup window is
    // covered too. ParentCommandHandler's constructor is a pure field
    // initializer (no side effects), and neither handleTerminationSignal nor the
    // uncaughtException/unhandledRejection handlers use tasks.loc(...) -- both
    // work identically whether or not setResourcePath has run yet.
    const parentHandler = new ParentCommandHandler();

    // Register process-level cleanup as defense-in-depth for unexpected termination.
    //
    // Residual risk (#336): SIGTERM/SIGINT/uncaughtException/unhandledRejection are
    // the only termination paths this process can intercept. None of them fire on
    // SIGKILL, an agent out-of-memory kill, or the underlying container/VM being
    // torn down mid-job -- on any of those, cleanup()/emergencyCleanup() never runs
    // and the OIDC JWT / GCP credentials JSON / OCI private-key temp file this job
    // wrote is left on disk. Writing under Agent.TempDirectory (rather than a bare
    // os.tmpdir()) only helps if the agent's own temp-directory purge is actually
    // configured to run between jobs -- true by default for Microsoft-hosted
    // agents, but NOT guaranteed on a self-hosted agent, where a killed job's
    // credential files can persist indefinitely for the next job (or a co-tenant
    // one) on that same machine to read. Operators of self-hosted/persistent
    // agents should configure their own periodic temp-directory purge (or a
    // per-job ephemeral/containerized agent) as a compensating control; this task
    // has no mechanism of its own to sweep a PRIOR run's leftover credential files
    // at startup.
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

    tasks.setResourcePath(path.join(__dirname, '..', 'task.json'));

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
