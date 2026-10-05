import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as openpgp from 'openpgp';
import * as httpClient from '../src/http-client';
import { verifyGpgSignature } from '../src/gpg-verifier';

/**
 * The embedded HashiCorp certificate must verify every release signed with this
 * key, not only the ones signed since HashiCorp last re-certified it.
 *
 * OpenPGP asks whether a key was valid when a signature was MADE, and the answer
 * comes from the self-signature the key carried at that time. HashiCorp
 * re-certified this key on 2026-02-18 and now publishes it with the new
 * self-signature only. Embedding that publication on its own rejected every
 * release signed earlier ("Could not find valid self-signature in key
 * 34365d9472d7468f: Signature creation time is in the future"), so a pipeline
 * pinned to an older Packer could not be installed with verification on.
 *
 * One row per self-signature generation. Each replays a real SHA256SUMS and its
 * real detached signature, as served by releases.hashicorp.com, through the
 * production verifyGpgSignature() and the real embedded key. A row that starts
 * failing after the key is updated means its generation was dropped: a new
 * publication is ADDED to src/hashicorp-gpg-key.ts, never pasted over it (its
 * header says how, and why the obvious tools lose a generation).
 */
const RECERTIFIED = Date.parse('2026-02-18T00:00:00Z');

const GENERATIONS: { release: string; selfSignature: string; signedBeforeRecertification: boolean }[] = [
    { release: '1.11.2', selfSignature: '2021-04-19', signedBeforeRecertification: true },
    { release: '1.16.1', selfSignature: '2026-02-18', signedBeforeRecertification: false },
];

describe('embedded HashiCorp key verifies releases from every self-signature generation', function () {
    this.timeout(15000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stub the one network call
    const client = httpClient as any;
    const originalFetchBufferAllow404 = client.fetchBufferAllow404;
    afterEach(() => { client.fetchBufferAllow404 = originalFetchBufferAllow404; });

    for (const row of GENERATIONS) {
        const name = `packer_${row.release}_SHA256SUMS`;
        const signatureUrl = `https://releases.hashicorp.com/packer/${row.release}/${name}.sig`;
        const read = () => ({
            sums: fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'),
            signature: new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.sig`))),
        });

        it(`packer ${row.release} is signed under the ${row.selfSignature} self-signature`, async () => {
            // Without this the row could name a generation its fixture does not
            // belong to, and keep passing while that generation went untested.
            const { packets } = await openpgp.readSignature({ binarySignature: read().signature });
            const created = packets[0].created as Date;
            assert.strictEqual(created.getTime() < RECERTIFIED, row.signedBeforeRecertification, `signed ${created.toISOString()}`);
        });

        it(`verifies the real packer ${row.release} SHA256SUMS`, async () => {
            const { sums, signature } = read();
            client.fetchBufferAllow404 = async () => signature;
            assert.strictEqual(await verifyGpgSignature(sums, signatureUrl, true), true);
        });

        it(`still rejects packer ${row.release} SHA256SUMS with one checksum altered`, async () => {
            const { sums, signature } = read();
            client.fetchBufferAllow404 = async () => signature;
            const altered = (sums[0] === '0' ? '1' : '0') + sums.slice(1);
            await assert.rejects(verifyGpgSignature(altered, signatureUrl, true), /GPG signature verification failed/);
        });
    }
});
