import tl = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerGCP } from '../src/gcp-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

// Companion entrypoint for the GcpWif*InvalidReject scenarios (#339).
//
// GcpWifAuthL0.ts (used by the happy-path GcpWifAuth test) asserts the
// resulting credentials file against a HARDCODED expected audience string, so
// any malformed WIF field -- validated or not -- makes that entrypoint fail,
// for the wrong reason: an audience-mismatch, not a rejected-input error. That
// would make a reject scenario built on it "pass" even under a mutation that
// deletes the new field-specific pattern check, because the audience would
// still fail to match the hardcoded value in GcpWifAuthL0.ts. This entrypoint
// isolates exactly one thing -- did handleProvider() throw -- so the mutation
// can only be caught (or missed) by the validation itself.
async function run() {
    try {
        const handler = new PackerCommandHandlerGCP();
        const cmd = new PackerAuthorizationCommandInitializer('build', '', 'GCP');
        await handler.handleProvider(cmd);
        tl.setResult(tl.TaskResult.Succeeded, 'GCP WIF fields accepted.');
    } catch (error) {
        tl.setResult(tl.TaskResult.Failed, String(error));
    }
}

run();
