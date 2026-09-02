import * as assert from 'assert';

/**
 * The trust-root currency gate's expiry half (#338).
 *
 * check-gpg-key-freshness.cjs compares the embedded HashiCorp key's
 * fingerprint against the published one. A fingerprint match cannot detect
 * expiry -- an expired key keeps its fingerprint, so both sides stay equal
 * right through the lapse while every verified install starts failing.
 *
 * The real embedded key expires in 2030, so a test driven by the actual key
 * exercises only the "ok" branch and would keep passing if the whole check
 * were deleted. These drive the pure decision with synthetic dates instead.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { classifyExpiry, EXPIRY_FAIL_DAYS, EXPIRY_WARN_DAYS } = require('../scripts/check-gpg-key-freshness.cjs');

const NOW = Date.parse('2026-09-02T00:00:00Z');
const DAY = 86400000;
const inDays = (n: number) => new Date(NOW + n * DAY);

describe('embedded GPG key expiry gate', function () {
    const rows: { name: string; expiry: Date | number; verdict: string }[] = [
        // The case the fingerprint check is blind to, and the reason this exists.
        { name: 'already expired', expiry: inDays(-1), verdict: 'fail' },
        { name: 'expired long ago', expiry: inDays(-400), verdict: 'fail' },
        // Inside the fail window: red, but bounded, and rotating clears it.
        { name: 'expires today', expiry: inDays(0), verdict: 'fail' },
        { name: 'just inside the fail window', expiry: inDays(EXPIRY_FAIL_DAYS - 1), verdict: 'fail' },
        { name: 'exactly at the fail boundary', expiry: inDays(EXPIRY_FAIL_DAYS), verdict: 'fail' },
        // Between the boundaries: notice, not failure.
        { name: 'just outside the fail window', expiry: inDays(EXPIRY_FAIL_DAYS + 1), verdict: 'warn' },
        { name: 'exactly at the warn boundary', expiry: inDays(EXPIRY_WARN_DAYS), verdict: 'warn' },
        // Beyond both: silent. This is where the real key sits today.
        { name: 'just outside the warn window', expiry: inDays(EXPIRY_WARN_DAYS + 1), verdict: 'ok' },
        { name: 'the real key horizon (2030)', expiry: inDays(1277), verdict: 'ok' },
        // A key with no expiry is legitimate, not suspicious.
        { name: 'never expires', expiry: Infinity, verdict: 'ok' },
    ];

    for (const row of rows) {
        it(`${row.name} -> ${row.verdict}`, function () {
            assert.strictEqual(classifyExpiry(row.expiry, NOW).verdict, row.verdict);
        });
    }

    it('treats an unreadable expiry as failure, not as validity', function () {
        // "We could not tell" must not read as "it is fine" -- the whole point
        // of the gate is that an unusable trust root is discovered here rather
        // than during an install.
        for (const bad of [NaN, undefined, null, 'soon']) {
            assert.strictEqual(
                classifyExpiry(bad as unknown as Date, NOW).verdict,
                'fail',
                `expiry ${String(bad)} must fail closed`,
            );
        }
    });

    it('reports the remaining days it decided on', function () {
        assert.strictEqual(classifyExpiry(inDays(200), NOW).daysLeft, 200);
        assert.strictEqual(classifyExpiry(inDays(-5), NOW).daysLeft, -5);
    });

    it('names the expiry date in the message, so the log says what to act on', function () {
        assert.ok(
            classifyExpiry(inDays(10), NOW).message.includes('2026-09-12'),
            'the failure message must carry the date',
        );
    });
});
