import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// #339: a variableFiles entry that only stays inside workingDirectory
// LEXICALLY, via an in-tree symlink, must still be rejected -- proves the new
// call site uses the real realpath-based isWithinWorkingDirectory helper, not
// a hand-rolled lexical-only check.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-varfiles-symlink-'));
const workDir = path.join(root, 'work');
const outside = path.join(root, 'outside');
fs.mkdirSync(workDir);
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, 'secret.pkrvars.hcl'), 'secret = "leaked"');
fs.symlinkSync(outside, path.join(workDir, 'link'), 'junction');

const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'validate');
tr.setInput('provider', 'none');
tr.setInput('templatePath', 'template.json');
tr.setInput('workingDirectory', workDir);
tr.setInput('variableFiles', 'link/secret.pkrvars.hcl');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer validate -var-file=link/secret.pkrvars.hcl template.json': { code: 0, stdout: '' }
    }
};

tr.setAnswers(a);
tr.run();
