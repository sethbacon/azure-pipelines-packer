import { describe, it } from 'mocha';
import assert = require('assert');
import { BasePackerCommandHandler } from '../src/base-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

/**
 * CLASS TEST -- prototype-chain lookup in command dispatch.
 *
 * This extension's half of the class reported as azure-pipelines-terraform
 * #884/#897. No issue was filed against this repo; the site was found by running
 * the prototype-safe-lookup signature here after the terraform half closed, and
 * it was byte-for-byte the same shape.
 *
 * `commands['constructor']` on a plain object literal returns Object -- truthy
 * AND callable -- so `if (!fn)` never fires and fn() invokes Object(), returning
 * {} where a number was expected instead of throwing "Invalid command".
 *
 * Mutation-provable: restore the object literal and the constructor row goes red.
 * Note the mutation must be run after deleting any compiled src/*.js, or ts-node
 * resolves the stale .js and the check silently passes against the fixed code.
 */

class ProbeHandler extends BasePackerCommandHandler {
    async handleProvider(_command: PackerAuthorizationCommandInitializer): Promise<void> { /* unreachable in these rows */ }
    protected applyEnvironmentVariables(): void { /* unreachable in these rows */ }
}

describe('command dispatch: prototype-chain lookup class (azure-pipelines-terraform#884/#897)', () => {
    for (const magic of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
        it(`rejects '${magic}' with the invalid-command error rather than resolving an inherited member`, async () => {
            const handler = new ProbeHandler();
            await assert.rejects(
                () => handler.executeCommand(magic),
                (err: Error) => {
                    assert.match(err.message, /^Invalid command: /, `expected the not-found branch, got: ${err.message}`);
                    return true;
                },
            );
        });
    }

    it('still rejects an ordinary unknown command', async () => {
        const handler = new ProbeHandler();
        await assert.rejects(() => handler.executeCommand('definitely-not-a-command'), /^Error: Invalid command: /);
    });

    it('lists the real commands in the error, not inherited members', async () => {
        const handler = new ProbeHandler();
        await assert.rejects(() => handler.executeCommand('nope'), (err: Error) => {
            assert.ok(err.message.includes('build'), 'the valid-command list must survive the Map conversion');
            assert.ok(!err.message.includes('hasOwnProperty'), 'no inherited member may appear in the valid-command list');
            return true;
        });
    });
});
