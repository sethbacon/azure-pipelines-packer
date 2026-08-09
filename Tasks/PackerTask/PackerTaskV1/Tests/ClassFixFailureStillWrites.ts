import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// CLASS ROW — #203: `packer fix` prints the fixed template and then exits
// non-zero merely because its own default post-fix -validate check still fails.
// The already-buffered stdout must still be written to fixOutputFile (the raw
// CLI equivalent, `packer fix t.json > fixed.json`, keeps it) and fixFilePath
// must still be exported -- while the task itself still fails.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-class-fixfail-'));

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
    exec: { 'packer fix template.json': { code: 1, stdout: '{"fixed": true, "validated": false}' } },
};

tr.setAnswers(a);
tr.run();
