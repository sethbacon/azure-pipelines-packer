import * as assert from 'assert';
import fs = require('fs');
import { writeSecretFile } from '../src/secure-temp';

/**
 * Direct unit tests for writeSecretFile's fail-closed permission enforcement (#80).
 * writeSecretFile is the sole 0600 enforcement point for every on-disk secret
 * (OIDC token files, GCP creds JSON, OCI key PEM). Its security-relevant branch —
 * throw when chmod fails on non-Windows, swallow-with-debug on Windows — had zero
 * coverage. fs is monkeypatched so no real file is written.
 */
describe('writeSecretFile — fail-closed chmod enforcement', function () {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monkeypatch the shared fs module
    const f = fs as any;
    const origWrite = f.writeFileSync;
    const origChmod = f.chmodSync;
    const origPlatform = process.platform;
    let writeArgs: unknown[] | null;

    beforeEach(() => {
        writeArgs = null;
        f.writeFileSync = (...args: unknown[]) => { writeArgs = args; };
        f.chmodSync = () => { throw new Error('EPERM: operation not permitted'); };
    });

    afterEach(() => {
        f.writeFileSync = origWrite;
        f.chmodSync = origChmod;
        Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    it('creates the file with mode 0600 and the exclusive wx flag', () => {
        f.chmodSync = () => { /* succeed */ };
        writeSecretFile('/tmp/secret-does-not-matter.txt', 'sensitive');
        assert.ok(writeArgs, 'writeFileSync should have been called');
        const options = writeArgs![2] as { mode: number; flag: string };
        assert.strictEqual(options.mode, 0o600, 'must request mode 0600');
        assert.strictEqual(options.flag, 'wx', 'must use the exclusive-create wx flag (O_EXCL)');
    });

    it('re-throws when chmod fails on a non-Windows platform (fail closed)', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        assert.throws(
            () => writeSecretFile('/tmp/secret.txt', 'sensitive'),
            /Failed to set restrictive permissions/
        );
    });

    it('swallows a chmod failure on Windows (NTFS ACLs apply instead)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        assert.doesNotThrow(() => writeSecretFile('/tmp/secret.txt', 'sensitive'));
    });
});
