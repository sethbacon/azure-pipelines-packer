import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { downloadToFile } from '../src/http-client';

/**
 * CLASS TEST -- network-retry coverage.
 *
 * This extension's half of the class reported as azure-pipelines-terraform#879:
 * "a network operation that can fail transiently is issued WITHOUT the module's
 * retry wrapper, while sibling operations in the same file use it." No issue was
 * filed against this repo. downloadToFile was found by running the network-retry
 * signature here after the terraform half closed -- fetchJson, fetchText and
 * fetchBuffer* were all wrapped in withRetry and the largest, longest request the
 * installer makes was not.
 *
 * The three rows below are the retry-SAFETY properties, which matter more than
 * the retry itself: wrapping a download in a retry loop without them turns one
 * bug into a worse one.
 */

describe('network retry coverage (class test, azure-pipelines-terraform#879)', function () {
    this.timeout(30000);

    let destDir: string;
    let destPath: string;

    beforeEach(() => {
        destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packer-network-retry-'));
        destPath = path.join(destDir, 'out.bin');
    });

    afterEach(() => {
        fs.rmSync(destDir, { recursive: true, force: true });
    });

    it('retries a transient failure and succeeds on a later attempt', async () => {
        const originalFetch = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            return calls < 3 ? new Response('boom', { status: 503 }) : new Response('payload', { status: 200 });
        }) as unknown as typeof globalThis.fetch;
        try {
            await downloadToFile('https://artifacts.example.com/x.zip', destPath, 5000, async () => { /* allowed */ });
            assert.strictEqual(calls, 3, 'expected 2 failed attempts then a 3rd that succeeds');
            assert.strictEqual(fs.readFileSync(destPath, 'utf8'), 'payload');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('never retries an egress-authorization rejection (a deterministic security decision, not a transient one)', async () => {
        const originalFetch = globalThis.fetch;
        let fetchCalls = 0;
        let authCalls = 0;
        globalThis.fetch = (async () => { fetchCalls++; return new Response('payload', { status: 200 }); }) as unknown as typeof globalThis.fetch;
        try {
            await assert.rejects(
                downloadToFile('https://artifacts.example.com/x.zip', destPath, 5000, async () => {
                    authCalls++;
                    throw new Error('IS_PRIVATE:blocked-host');
                }),
                /IS_PRIVATE:blocked-host/,
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
        // withRetry treats any non-HttpError as transient, so an unclassified
        // rejection here would be retried -- handing a DNS-rebinding host three
        // chances per run to flip from rejected to allowed.
        assert.strictEqual(authCalls, 1, 'an authorization rejection must never be retried');
        assert.strictEqual(fetchCalls, 0, 'fetch must never be reached once isHostAllowed rejects');
        assert.ok(!fs.existsSync(destPath), 'a rejected download must leave no file behind');
    });

    it('starts each retry attempt from a clean destination, never resuming into a prior attempt bytes', async () => {
        const originalFetch = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            if (calls === 1) {
                fs.writeFileSync(destPath, 'PARTIAL-GARBAGE-FROM-ATTEMPT-1');
                return new Response('boom', { status: 503 });
            }
            return new Response('payload', { status: 200 });
        }) as unknown as typeof globalThis.fetch;
        try {
            await downloadToFile('https://artifacts.example.com/x.zip', destPath, 5000, async () => { /* allowed */ });
            assert.strictEqual(
                fs.readFileSync(destPath, 'utf8'),
                'payload',
                'the successful attempt must not be appended to, or interleaved with, the failed one',
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
