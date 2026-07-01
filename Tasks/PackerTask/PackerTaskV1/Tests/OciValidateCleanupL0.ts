import tl = require('azure-pipelines-task-lib/task');
import path = require('path');
import fs = require('fs');
import os = require('os');
import { ParentCommandHandler } from '../src/parent-handler';

// Drives the REAL ParentCommandHandler.execute() path (unlike the direct
// handler.handleProvider() calls the other *Auth(L0) tests use), proving the
// finally-block cleanup guarantee: after a full run, the PKR_VAR_oci_* env
// vars are unset AND the OCI private-key temp file no longer exists on disk.
tl.setResourcePath(path.join(__dirname, '..', 'task.json'));

function ociKeyFiles(): string[] {
    return fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('oci-keyfile-') && f.endsWith('.pem'));
}

async function run() {
    const before = new Set(ociKeyFiles());
    try {
        const parent = new ParentCommandHandler();
        await parent.execute('oci', 'validate');

        const after = ociKeyFiles();
        const newFilesStillPresent = after.filter((f) => !before.has(f));
        const envCleared = process.env['PKR_VAR_oci_key_file'] === undefined
            && process.env['PKR_VAR_oci_tenancy_ocid'] === undefined
            && process.env['PKR_VAR_oci_fingerprint'] === undefined;

        if (envCleared && newFilesStillPresent.length === 0) {
            tl.setResult(tl.TaskResult.Succeeded, 'Env vars cleared and temp key file removed after execute().');
        } else {
            tl.setResult(tl.TaskResult.Failed, 'Cleanup incomplete after execute(): ' + JSON.stringify({
                envCleared,
                leakedTempFiles: newFilesStillPresent
            }));
        }
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
