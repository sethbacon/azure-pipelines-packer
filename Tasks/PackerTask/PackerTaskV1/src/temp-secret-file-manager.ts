import tasks = require('azure-pipelines-task-lib/task');
import fs = require('fs');
import os = require('os');
import path = require('path');
import { randomUUID as uuidV4 } from 'crypto';
import { writeSecretFile, scrubFile } from '@4cloudguru/pipeline-task-ado';
import { SecureFileLoader } from './secure-file-loader';

/**
 * Owns the credential temp-file lifecycle: writing 0600 secret files, tracking
 * them, and scrubbing then unlinking them afterwards. Extracted from
 * BasePackerCommandHandler (#113), which carried this alongside command dispatch
 * and eleven sub-command implementations.
 *
 * The handler COMPOSES this and keeps thin delegating members, rather than
 * callers reaching in. That is not stylistic: `cleanupTempFiles()` is the public
 * contract ParentCommandHandler calls in its finally block and again from
 * emergencyCleanup() on SIGTERM/SIGINT/uncaughtException, so the method has to
 * stay where those callers already find it.
 */
export class TempSecretFileManager {
    private files: string[] = [];
    private secureFileId: string | null = null;

    /**
     * The LIVE tracked-path array, deliberately not a defensive copy.
     *
     * The sibling extension's manager returns a copy here; this one must not.
     * EntryPointSignalsL0's subclass fixture tracks a file by doing
     * `this.tempFiles.push(target)`, and OciWifBranchL0 reads
     * `(handler as any).tempFiles` to locate the written key/config paths. A copy
     * would make the push land in a discarded array and the file would never be
     * cleaned up -- a silent regression in exactly the lifecycle this class owns.
     */
    public get trackedFiles(): string[] {
        return this.files;
    }

    /**
     * Writes `content` to a uniquely-named 0600 temp file (`<prefix>-<uuid>.<ext>`),
     * tracks it for cleanup, and returns the path.
     */
    public writeTracked(prefix: string, ext: string, content: string): string {
        // Prefer Agent.TempDirectory (purged between jobs) over the shared OS
        // tmpdir so an abnormal termination (SIGKILL, hard crash) that skips the
        // finally-block/signal-handler cleanup still gets an agent-provided
        // backstop for these long-lived credential files (#104). Falls back to
        // os.tmpdir() for headless/mock runs (and any run where the variable is
        // unset), which is every existing test -- no behavior change there.
        const baseDir = tasks.getVariable('Agent.TempDirectory') || os.tmpdir();
        const filePath = path.join(baseDir, `${prefix}-${uuidV4()}.${ext}`);
        writeSecretFile(filePath, content);
        this.files.push(filePath);
        return filePath;
    }

    /** Records the downloaded secure var file so cleanup can delete it too. */
    public setSecureFileId(secureFileId: string | null): void {
        this.secureFileId = secureFileId;
    }

    public cleanup(): void {
        for (const filePath of this.files) {
            try {
                if (fs.existsSync(filePath)) {
                    // Scrub (zero-overwrite) before unlinking, uniformly for every
                    // tracked secret temp file -- OIDC/UPST token files, GCP/OCI
                    // credential JSON, PEM keys alike -- so a crash between the
                    // overwrite and the unlink is the only remaining exposure
                    // window, matching TerraformTaskV5's temp-file-manager.ts
                    // (#336). A scrub failure is surfaced but does not skip the
                    // unlink attempt below.
                    try {
                        scrubFile(filePath);
                    } catch (scrubErr) {
                        tasks.warning(`Failed to scrub temp file ${filePath} before deletion: ${scrubErr}`);
                    }
                    fs.unlinkSync(filePath);
                    tasks.debug(`Cleaned up temp file: ${filePath}`);
                }
            } catch (err) {
                // A leftover credential temp file (OIDC token / GCP or OCI key) is
                // a real exposure on a self-hosted agent -- surface it above debug (#104).
                tasks.warning(`Failed to clean up temp file ${filePath}: ${err}`);
            }
        }
        // Reassigned rather than truncated, matching the behaviour this replaced:
        // a caller holding a reference taken BEFORE cleanup keeps seeing the paths
        // it captured, and `trackedFiles` afterwards is a fresh empty array.
        this.files = [];

        if (this.secureFileId) {
            try {
                new SecureFileLoader().deleteSecureFile(this.secureFileId);
            } catch (err) {
                tasks.warning(`Failed to clean up secure file: ${err}`);
            }
            this.secureFileId = null;
        }
    }
}
