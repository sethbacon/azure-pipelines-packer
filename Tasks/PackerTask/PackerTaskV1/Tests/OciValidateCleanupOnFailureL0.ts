import tl = require('azure-pipelines-task-lib/task');
import path = require('path');
import fs = require('fs');
import os = require('os');
import { ParentCommandHandler } from '../src/parent-handler';

// #336 finding 4: the only existing cleanup-proving fixture for a credentialed
// provider (OciValidateCleanupSuccess/L0) drives the SUCCESS path exclusively --
// when packer's own exec rejects (non-zero exit), that script's catch block
// reports Failed on the error message alone, without checking whether cleanup
// actually ran. This is the companion FAILURE-path version: ParentCommandHandler
// .execute()'s try/finally is supposed to guarantee cleanupTempFiles() and
// clearTrackedVariables() run even when the packer command itself throws --
// prove that guarantee holds, not just that a rejection was reported.
tl.setResourcePath(path.join(__dirname, '..', 'task.json'));

function ociKeyFiles(): string[] {
    return fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('oci-keyfile-') && f.endsWith('.pem'));
}

async function run() {
    const before = new Set(ociKeyFiles());
    let packerCommandThrew = false;
    try {
        const parent = new ParentCommandHandler();
        await parent.execute('oci', 'validate');
    } catch {
        // Expected: the mocked packer exec exits non-zero, so ToolRunner.execAsync
        // rejects. The interesting assertion is what happens to cleanup below, not
        // this rejection itself.
        packerCommandThrew = true;
    }

    const after = ociKeyFiles();
    const newFilesStillPresent = after.filter((f) => !before.has(f));
    const envCleared = process.env['PKR_VAR_oci_key_file'] === undefined
        && process.env['PKR_VAR_oci_tenancy_ocid'] === undefined
        && process.env['PKR_VAR_oci_fingerprint'] === undefined;

    if (packerCommandThrew && envCleared && newFilesStillPresent.length === 0) {
        tl.setResult(tl.TaskResult.Succeeded, 'Packer command failed as expected, and env vars were still cleared and the temp key file still removed.');
    } else {
        tl.setResult(tl.TaskResult.Failed, 'Cleanup incomplete after a failing execute(): ' + JSON.stringify({
            packerCommandThrew,
            envCleared,
            leakedTempFiles: newFilesStillPresent
        }));
    }
}

run();
