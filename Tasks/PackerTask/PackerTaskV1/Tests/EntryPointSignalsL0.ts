import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import tasks = require('azure-pipelines-task-lib/task');
import { ParentCommandHandler } from '../src/parent-handler';
import { BasePackerCommandHandler } from '../src/base-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';
import { writeSecretFile, EnvironmentVariableHelper } from '@4cloudguru/pipeline-task-ado';

/**
 * CLASS TEST — "the declared task.json execution entry point is never loaded by
 * any test" (#189), for PackerTaskV1's src/index.ts.
 *
 * src/index.ts is the file task.json's Node24/Node20_1 handlers point the ADO
 * agent at. It was excluded from the coverage metric (.nycrc.json) and executed
 * by nothing: Tests/RunCommand.ts re-implemented it instead of running it, so
 * the four abnormal-termination listeners registered here — the documented
 * defense-in-depth backstop that scrubs on-disk credential temp files (OIDC
 * .jwt, GCP/OCI JSON/PEM) when a pipeline is cancelled or the process crashes —
 * had no test at all. Only the ParentCommandHandler.emergencyCleanup() they
 * call was covered, in isolation.
 *
 * RunCommand.ts now delegates to the real src/index.ts, which covers the normal
 * path. This suite covers the part a mock-runner run can never reach: the
 * listeners themselves. It is table-driven over the FOUR registered events
 * rather than one test for the reported one, because the defect that reopened
 * these issues is a per-site test passing while its sibling is broken —
 * dropping cleanup() from exactly one of the four listeners must go red here.
 *
 * A real cross-process spawn + child.kill(signal) was rejected for the reason
 * the sibling azure-pipelines-terraform repo documents in its own
 * Tests/SignalHandlerL0.ts: on Windows, kill('SIGTERM') hard-terminates via
 * TerminateProcess without ever invoking the registered listener, so a spawn
 * version could only be verified on Linux. Instead this drives the REAL,
 * unmodified index.ts in-process (reloaded fresh through the require cache per
 * test) against a REAL tracked temp file written by the REAL writeSecretFile().
 * Two seams are stubbed, both unavoidable in-process: ParentCommandHandler.
 * prototype.execute (so no packer binary/cloud call is needed, and so it stays
 * pending — a signal arriving mid-run is the realistic cancellation case) and
 * process.kill/process.exit (so re-raising does not kill the mocha process; the
 * calls are captured and asserted instead).
 */
describe('index.ts abnormal-termination listeners — emergency cleanup then terminate (#189)', function () {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monkeypatch shared modules for the duration of each test
    const t = tasks as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = process as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pch = ParentCommandHandler.prototype as any;
    const origGetInput = tasks.getInput;
    const origKill = process.kill.bind(process);
    const origExit = process.exit.bind(process);
    const origExecute = ParentCommandHandler.prototype.execute;
    const indexModulePath = require.resolve('../src/index');
    const TRACKED_EVENTS = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'] as const;
    const TRACKED_ENV_VAR = 'PACKER_ENTRYPOINT_SIGNAL_TEST';

    let scratchDir: string;
    let credentialFile: string;
    let killCalls: Array<{ pid: number; signal: string }>;
    let exitCalls: number[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let listenerSnapshots: Map<string, any[]>;

    /** Concrete handler exposing the protected temp-file array. */
    class HangingTestHandler extends BasePackerCommandHandler {
        public async handleProvider(_command: PackerAuthorizationCommandInitializer): Promise<void> { /* not exercised */ }
        public trackTemp(target: string): void { this.tempFiles.push(target); }
    }

    beforeEach(() => {
        scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packer-entrypoint-'));
        credentialFile = path.join(scratchDir, 'fake-credential.json');
        killCalls = [];
        exitCalls = [];

        // Snapshot every listener on the events index.ts registers, so this
        // test's own registrations can be fully undone afterwards regardless of
        // what mocha or an earlier test file already had attached.
        listenerSnapshots = new Map();
        for (const event of TRACKED_EVENTS) {
            listenerSnapshots.set(event, [...p.listeners(event)]);
        }

        t.getInput = () => 'test-value';

        p.kill = (pid: number, signal?: string | number) => {
            killCalls.push({ pid, signal: String(signal ?? 'SIGTERM') });
            return true;
        };
        p.exit = (code?: number) => { exitCalls.push(code ?? 0); };

        // Replace execute() with one that writes+tracks a real credential temp
        // file on a real handler instance and then never resolves, standing in
        // for a packer command still running when termination arrives.
        pch.execute = function (): Promise<number> {
            writeSecretFile(credentialFile, 'fake-secret-for-test');
            const handler = new HangingTestHandler();
            handler.trackTemp(credentialFile);
            EnvironmentVariableHelper.setEnvironmentVariable(TRACKED_ENV_VAR, 'sensitive', true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seed the private activeHandler field for this test
            (this as any).activeHandler = handler;
            return new Promise<number>(() => { /* never resolves */ });
        };

        delete require.cache[indexModulePath];
    });

    afterEach(() => {
        t.getInput = origGetInput;
        p.kill = origKill;
        p.exit = origExit;
        pch.execute = origExecute;
        delete require.cache[indexModulePath];
        delete process.env[TRACKED_ENV_VAR];
        EnvironmentVariableHelper.clearTrackedVariables();

        for (const event of TRACKED_EVENTS) {
            p.removeAllListeners(event);
            for (const listener of listenerSnapshots.get(event)!) {
                p.on(event, listener);
            }
        }

        fs.rmSync(scratchDir, { recursive: true, force: true });
    });

    /**
     * index.ts's run() is synchronous up to (and including) the
     * parentHandler.execute(...) call site — every listener is registered and
     * the credential file is on disk before the first await suspends it — so no
     * tick/microtask wait is needed after require().
     */
    function loadIndexAndConfirmHandlerStarted(): void {
        require('../src/index');
        assert.strictEqual(fs.existsSync(credentialFile), true, 'the real writeSecretFile()-tracked credential file must exist once execute() has started');
        assert.strictEqual(process.env[TRACKED_ENV_VAR], 'sensitive', 'the tracked credential env var must be set once execute() has started');
    }

    /**
     * uncaughtException/unhandledRejection are ALSO listened for by mocha's own
     * runner, and process.emit() would fan out to it, deferring via setImmediate
     * and misattributing an "Uncaught Error" to an unrelated later test. Find
     * the ONE listener this fresh require() added (diffed against the pre-load
     * snapshot) and invoke it directly, exactly as Node's internal fatal path
     * would.
     */
    function invokeFreshListener(event: typeof TRACKED_EVENTS[number], ...args: unknown[]): void {
        const before = listenerSnapshots.get(event)!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- listener signatures vary by event
        const fresh = p.listeners(event).find((listener: any) => !before.includes(listener));
        assert.ok(fresh, `index.ts must register a new ${event} listener on load`);
        fresh(...args);
    }

    /**
     * The enumerated sites: every listener src/index.ts registers. `terminates`
     * describes the required post-cleanup disposition — re-raise the signal
     * with the listener removed (SIGTERM/SIGINT, #106) or exit(1) (the error
     * events) — so a row cannot pass merely because cleanup ran.
     */
    const SITES: Array<{
        event: typeof TRACKED_EVENTS[number];
        fire: () => void;
        terminates: () => void;
    }> = [
        {
            event: 'SIGTERM',
            fire: () => { process.emit('SIGTERM', 'SIGTERM'); },
            terminates: () => {
                assert.strictEqual(killCalls.length, 1, 'SIGTERM must be re-raised via process.kill after cleanup');
                assert.strictEqual(killCalls[0].pid, process.pid);
                assert.strictEqual(killCalls[0].signal, 'SIGTERM');
            },
        },
        {
            event: 'SIGINT',
            fire: () => { process.emit('SIGINT', 'SIGINT'); },
            terminates: () => {
                assert.strictEqual(killCalls.length, 1, 'SIGINT must be re-raised via process.kill after cleanup');
                assert.strictEqual(killCalls[0].pid, process.pid);
                assert.strictEqual(killCalls[0].signal, 'SIGINT');
            },
        },
        {
            event: 'uncaughtException',
            fire: () => { invokeFreshListener('uncaughtException', new Error('boom')); },
            terminates: () => {
                assert.deepStrictEqual(exitCalls, [1], 'an uncaught exception must exit(1) after cleanup');
            },
        },
        {
            event: 'unhandledRejection',
            fire: () => { invokeFreshListener('unhandledRejection', new Error('boom'), Promise.resolve()); },
            terminates: () => {
                assert.deepStrictEqual(exitCalls, [1], 'an unhandled rejection must exit(1) after cleanup');
            },
        },
    ];

    for (const site of SITES) {
        it(`${site.event}: index.ts registers a listener that scrubs the tracked credential file and env var, then terminates`, () => {
            loadIndexAndConfirmHandlerStarted();

            const listenersBefore = process.listenerCount(site.event);
            assert.ok(listenersBefore > (listenerSnapshots.get(site.event)!.length), `index.ts must register a ${site.event} listener`);

            site.fire();

            assert.strictEqual(
                fs.existsSync(credentialFile),
                false,
                `emergencyCleanup() must delete the tracked credential temp file when ${site.event} arrives mid-run`,
            );
            assert.strictEqual(
                process.env[TRACKED_ENV_VAR],
                undefined,
                `emergencyCleanup() must clear tracked credential env vars when ${site.event} arrives mid-run`,
            );
            site.terminates();
        });
    }

    it('SIGTERM/SIGINT listeners remove themselves before re-raising, restoring default disposition (#106)', () => {
        loadIndexAndConfirmHandlerStarted();
        const before = process.listenerCount('SIGTERM');
        process.emit('SIGTERM', 'SIGTERM');
        assert.strictEqual(
            process.listenerCount('SIGTERM'),
            before - 1,
            'the handler must removeListener() itself before process.kill, or the re-raise is swallowed and the process lingers',
        );
    });
});
