import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// #111: end-to-end coverage for the secureVarsFile -> -var-file wiring and its
// deleteSecureFile cleanup branch, previously exercised only through the
// injectable ISecureFileLoader unit test (SecureFileLoaderL0.ts), never
// through the real ParentCommandHandler.execute() dispatch path. Also proves
// the #103 chmod-to-0600 fix landed on the downloaded file before cleanup
// removes it. azure-pipelines-tasks-securefiles-common is mocked via
// registerMock (same lib-mocker mechanism the './id-token-generator' mocks
// already use elsewhere in this suite) so no real secure-file download or
// agent OAuth token is needed.
const varFilePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-securevars-')), 'downloaded.pkrvars.hcl');
fs.writeFileSync(varFilePath, 'dummy_var = "value"\n');

const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'build');
tr.setInput('provider', 'none');
tr.setInput('templatePath', '.');
tr.setInput('secureVarsFile', 'secure-file-id-e2e');

tr.registerMock('azure-pipelines-tasks-securefiles-common/securefiles-common', {
    SecureFileHelpers: class {
        async downloadSecureFile(secureFileId: string): Promise<string> {
            console.log('SECUREFILE_DOWNLOADED:' + secureFileId);
            return varFilePath;
        }
        deleteSecureFile(secureFileId: string): void {
            const mode = (fs.statSync(varFilePath).mode & 0o777).toString(8);
            console.log('SECUREFILE_DELETED:' + secureFileId + ':mode=' + mode);
        }
    }
});

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        [`packer build -var-file=${varFilePath} .`]: { code: 0, stdout: 'Build finished.' }
    }
};

tr.setAnswers(a);
tr.run();
