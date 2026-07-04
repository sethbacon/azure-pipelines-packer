import tasks = require('azure-pipelines-task-lib/task');
import fs = require('fs');

/**
 * Write sensitive content to a file with restrictive permissions.
 * Uses mode 0o600 on Unix; on Windows, falls back gracefully since
 * chmod is not supported and NTFS ACLs apply instead.
 *
 * The `wx` flag (O_CREAT | O_EXCL | O_WRONLY) makes the create fail if the
 * path already exists, defeating a pre-planted symlink in a shared, world-
 * writable tmpdir: without O_EXCL an attacker-owned symlink at the target
 * would redirect the write (and the 0600 would land on the symlink's target).
 * Callers embed a randomUUID in every filename, so a legitimate collision is
 * effectively impossible.
 */
export function writeSecretFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, { mode: 0o600, flag: 'wx' });
    try {
        fs.chmodSync(filePath, 0o600);
    } catch (err) {
        if (process.platform !== 'win32') {
            throw new Error(`Failed to set restrictive permissions on ${filePath}: ${err instanceof Error ? err.message : err}`);
        }
        tasks.debug('Skipping chmod on Windows platform (ACLs apply instead).');
    }
}

/**
 * Tightens permissions on an already-existing file to 0o600 -- for content
 * written by a third-party library (e.g. securefiles-common's download) that
 * cannot be routed through writeSecretFile's own create-with-mode path (#103).
 * Same Windows fallback: chmod is a no-op on NTFS, so a platform-specific
 * failure there is swallowed rather than treated as fatal.
 */
export function tightenFilePermissions(filePath: string): void {
    try {
        fs.chmodSync(filePath, 0o600);
    } catch (err) {
        if (process.platform !== 'win32') {
            throw new Error(`Failed to set restrictive permissions on ${filePath}: ${err instanceof Error ? err.message : err}`);
        }
        tasks.debug('Skipping chmod on Windows platform (ACLs apply instead).');
    }
}
