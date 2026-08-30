import * as assert from 'assert';
import * as fs from 'fs';
import pipelineTaskAdo = require('@4cloudguru/pipeline-task-ado');
import { PackerCommandHandlerNone } from '../src/none-packer-command-handler';

/**
 * #336 finding 2: cleanupTempFiles() unlinked tracked credential temp files
 * (OIDC/UPST tokens, GCP/OCI credential JSON, PEM keys) with no prior scrub,
 * leaving the bytes recoverable until the OS overwrites that disk block --
 * unlike TerraformTaskV5's temp-file-manager.ts, which scrubs (zero-overwrites)
 * every tracked secret temp file before unlinking it for exactly this reason.
 *
 * Asserting only "the file no longer exists after cleanup" would pass whether
 * or not scrubFile ever ran, since fs.unlinkSync alone also makes that true --
 * the #1026-class self-fulfilling-test shape. This mocks scrubFile to record,
 * at the moment it is called, whether the file STILL exists on disk -- which
 * is true only if scrub runs before unlink, and false if the ordering were
 * ever reversed.
 */
describe('cleanupTempFiles scrubs credential temp files before unlinking (#336)', function () {
  const originalScrubFile = pipelineTaskAdo.scrubFile;

  afterEach(() => {
    (pipelineTaskAdo as any).scrubFile = originalScrubFile;
  });

  it('calls scrubFile on each tracked temp file while it still exists, then deletes it', () => {
    const scrubCalls: { path: string; existedAtCallTime: boolean }[] = [];
    (pipelineTaskAdo as any).scrubFile = (p: string) => {
      scrubCalls.push({ path: p, existedAtCallTime: fs.existsSync(p) });
    };

    const handler = new PackerCommandHandlerNone();
    const filePath = (handler as any).writeTrackedSecretFile('scrub-test', 'jwt', 'super-secret-oidc-token');
    assert.ok(fs.existsSync(filePath), 'the tracked temp file must exist before cleanup');

    handler.cleanupTempFiles();

    assert.strictEqual(scrubCalls.length, 1, 'scrubFile must be called exactly once for the tracked file');
    assert.strictEqual(scrubCalls[0].path, filePath);
    assert.strictEqual(
      scrubCalls[0].existedAtCallTime, true,
      'scrubFile must run BEFORE unlink, while the file still has content to overwrite',
    );
    assert.strictEqual(fs.existsSync(filePath), false, 'the file must be deleted once cleanup finishes');
  });

  it('still deletes the file when scrubFile itself throws, and warns rather than aborting cleanup', () => {
    const warnings: string[] = [];
    const tasks = require('azure-pipelines-task-lib/task');
    const originalWarning = tasks.warning;
    tasks.warning = (m: string) => { warnings.push(m); };
    (pipelineTaskAdo as any).scrubFile = () => { throw new Error('scrub boom'); };

    try {
      const handler = new PackerCommandHandlerNone();
      const filePath = (handler as any).writeTrackedSecretFile('scrub-fail-test', 'jwt', 'another-secret');

      handler.cleanupTempFiles();

      assert.strictEqual(fs.existsSync(filePath), false, 'unlink must still proceed after a scrub failure');
      assert.ok(warnings.some((w) => w.includes('Failed to scrub temp file')), 'a scrub failure must be surfaced as a warning');
    } finally {
      tasks.warning = originalWarning;
    }
  });
});
