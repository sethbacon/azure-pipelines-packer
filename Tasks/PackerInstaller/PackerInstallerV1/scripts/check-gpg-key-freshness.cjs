// Compares the embedded HashiCorp GPG public key (src/hashicorp-gpg-key.ts,
// compiled to src/hashicorp-gpg-key.js) against the key HashiCorp currently
// publishes. Run weekly (see .github/workflows/weekly-security.yml) rather
// than per-PR: it depends on an external network fetch and only needs to
// catch a key rotation, not gate every change.
//
// Run `npm run compile` before this script so src/hashicorp-gpg-key.js exists.
// Named .cjs (not .js) so it is tracked by git — the repo's .gitignore excludes
// Tasks/**/*.js build output, which would otherwise drop this file.
const openpgp = require('openpgp');
const { HASHICORP_GPG_PUBLIC_KEY } = require('../src/hashicorp-gpg-key');

const PUBLISHED_KEY_URL = 'https://www.hashicorp.com/.well-known/pgp-key.txt';

// A fingerprint match proves the embedded key is the one HashiCorp publishes.
// It does NOT prove the key is still usable: an expired key keeps its
// fingerprint, so the two keys stay equal right through the expiry and this
// gate stayed green while every install broke (#338).
//
// The break is fail-closed -- openpgp rejects a signature from an expired key,
// so verifySha256/verifyDetached raise a VerificationFailure and the install
// aborts rather than trusting unverified material. The cost is therefore an
// abrupt outage with a misleading message ("signature verification failed"
// reads like tampering, not like an expired trust root), which is exactly the
// kind of thing worth knowing about months ahead instead of on the morning it
// happens.
//
// FAIL_DAYS is deliberately short enough that the red window is bounded and
// acting on it clears it; WARN_DAYS is long enough to be noticed during
// ordinary work. Rotating the embedded key is the remedy for both.
const EXPIRY_FAIL_DAYS = 90;
const EXPIRY_WARN_DAYS = 365;
const MS_PER_DAY = 86400000;

/**
 * Pure expiry decision, separated from the fetch so it can be tested against
 * synthetic dates -- the real key expires in 2030, so a test driven by the
 * actual key could not exercise the branches that matter.
 *
 * @param {Date|number} expirationTime openpgp's getExpirationTime(): a Date, or Infinity for a key that never expires.
 * @param {number} now epoch millis.
 */
function classifyExpiry(expirationTime, now) {
    if (expirationTime === Infinity) {
        return { verdict: 'ok', daysLeft: Infinity, message: 'Embedded key does not expire.' };
    }
    const expiresAt = expirationTime instanceof Date ? expirationTime.getTime() : Number(expirationTime);
    if (!Number.isFinite(expiresAt)) {
        // An unreadable expiry is not evidence of validity. Fail rather than
        // treat "we could not tell" as "it is fine".
        return { verdict: 'fail', daysLeft: NaN, message: 'Could not determine the embedded key\'s expiration time.' };
    }
    const daysLeft = Math.floor((expiresAt - now) / MS_PER_DAY);
    const on = new Date(expiresAt).toISOString().slice(0, 10);
    if (daysLeft < 0) {
        return { verdict: 'fail', daysLeft, message: `Embedded HashiCorp GPG key EXPIRED on ${on}. Signature verification is failing for every install; rotate HASHICORP_GPG_PUBLIC_KEY now.` };
    }
    if (daysLeft <= EXPIRY_FAIL_DAYS) {
        return { verdict: 'fail', daysLeft, message: `Embedded HashiCorp GPG key expires on ${on} (${daysLeft} day(s) away). Rotate HASHICORP_GPG_PUBLIC_KEY before it lapses -- once it does, every verified install fails closed.` };
    }
    if (daysLeft <= EXPIRY_WARN_DAYS) {
        return { verdict: 'warn', daysLeft, message: `Embedded HashiCorp GPG key expires on ${on} (${daysLeft} day(s) away). Plan the rotation.` };
    }
    return { verdict: 'ok', daysLeft, message: `Embedded key valid until ${on} (${daysLeft} day(s) away).` };
}

async function main() {
    const response = await fetch(PUBLISHED_KEY_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${PUBLISHED_KEY_URL}: HTTP ${response.status}`);
    }
    const publishedArmoredKey = await response.text();

    const embeddedKey = await openpgp.readKey({ armoredKey: HASHICORP_GPG_PUBLIC_KEY });
    const publishedKey = await openpgp.readKey({ armoredKey: publishedArmoredKey });

    const embeddedFingerprint = embeddedKey.getFingerprint();
    const publishedFingerprint = publishedKey.getFingerprint();

    console.log(`Embedded key fingerprint:  ${embeddedFingerprint}`);
    console.log(`Published key fingerprint: ${publishedFingerprint}`);

    if (embeddedFingerprint !== publishedFingerprint) {
        console.error(
            `\nHashiCorp's published GPG key (${PUBLISHED_KEY_URL}) no longer matches the ` +
            `key embedded in src/hashicorp-gpg-key.ts. Update HASHICORP_GPG_PUBLIC_KEY with ` +
            `the new key from the URL above.`
        );
        process.exit(1);
    }

    console.log('\nEmbedded GPG key matches the currently published HashiCorp key.');

    // Currency is two questions, not one: is this still the key HashiCorp
    // publishes (above), and is it still valid (below)?
    const expiry = classifyExpiry(await embeddedKey.getExpirationTime(), Date.now());
    if (expiry.verdict === 'fail') {
        console.error(`\n${expiry.message}`);
        process.exit(1);
    }
    if (expiry.verdict === 'warn') {
        // ::warning surfaces in the run summary, so a year's notice is visible
        // without a year of red.
        console.log(`::warning title=HashiCorp GPG key approaching expiry::${expiry.message}`);
    }
    console.log(expiry.message);
}

module.exports = { classifyExpiry, EXPIRY_FAIL_DAYS, EXPIRY_WARN_DAYS };

// Only run when invoked directly, so requiring this file from a test does not
// perform a network fetch or call process.exit.
if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
