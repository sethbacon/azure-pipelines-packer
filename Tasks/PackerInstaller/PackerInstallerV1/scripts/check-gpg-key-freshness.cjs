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
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
