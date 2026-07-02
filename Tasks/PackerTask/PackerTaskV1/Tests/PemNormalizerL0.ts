import * as assert from 'assert';
import { normalizePem } from '../src/pem-normalizer';

/**
 * Direct unit tests for the OCI private-key PEM normalizer's rejection branches.
 * normalizePem is the crypto-validation gate before the key is written to a temp
 * file and referenced by PKR_VAR_oci_key_file; its malformed-input rejects give
 * clear, deterministic errors and were previously uncovered (#80).
 */
describe('normalizePem — malformed-input rejection', function () {
    it('rejects input with no BEGIN/END markers', () => {
        assert.throws(() => normalizePem('not a pem at all'), /missing header or footer/);
    });

    it('rejects a header/footer label mismatch', () => {
        const pem = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----';
        assert.throws(() => normalizePem(pem), /does not match footer label/);
    });

    it('rejects an empty key body', () => {
        const pem = '-----BEGIN PRIVATE KEY-----\n\n-----END PRIVATE KEY-----';
        assert.throws(() => normalizePem(pem), /empty key body/);
    });

    it('rejects a body with non-base64 characters', () => {
        const pem = '-----BEGIN PRIVATE KEY-----\n!!!not-base64!!!\n-----END PRIVATE KEY-----';
        assert.throws(() => normalizePem(pem), /non-base64 characters/);
    });

    it('rejects a well-formed-but-invalid key that crypto cannot parse', () => {
        // Valid base64, correct markers, but not a real key -> crypto.createPrivateKey throws.
        const pem = '-----BEGIN PRIVATE KEY-----\nQUJDREVGRw==\n-----END PRIVATE KEY-----';
        assert.throws(() => normalizePem(pem), /crypto validation failed/);
    });
});
