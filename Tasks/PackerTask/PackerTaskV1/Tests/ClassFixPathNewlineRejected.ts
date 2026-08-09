import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// CLASS ROW — setVariable('fixFilePath'). Same sink shape as manifestFilePath:
// the resolved output path is exported, so a newline-bearing working directory
// must be rejected by the output-variable guard while the file itself is still
// written. POSIX-only (see ClassManifestPathNewlineRejected).
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-class-fixnl\n-'));

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
    exec: { 'packer fix template.json': { code: 0, stdout: '{"fixed": true}' } },
};

tr.setAnswers(a);
tr.run();
