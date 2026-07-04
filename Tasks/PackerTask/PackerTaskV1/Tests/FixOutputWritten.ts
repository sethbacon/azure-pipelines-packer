import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// #111: the fix command's in-tree fixOutputFile path (stdout capture -> write
// -> fixFilePath output variable) had zero L0 coverage. A real temp working
// directory is used so the (unmocked) write and within-working-directory
// realpath check run for real, like BuildManifestParsed.ts.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-fix-ok-'));

const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'fix');
tr.setInput('provider', 'none');
tr.setInput('templatePath', 'template.json');
tr.setInput('workingDirectory', workDir);
tr.setInput('fixOutputFile', 'fixed.json');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer fix template.json': { code: 0, stdout: '{"fixed": true}' }
    }
};

tr.setAnswers(a);
tr.run();
