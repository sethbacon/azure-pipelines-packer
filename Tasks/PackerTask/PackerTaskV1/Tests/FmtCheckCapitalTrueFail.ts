import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #331: `fmtCheck: true` written unquoted in pipeline YAML reaches the task as the
// string 'True'. BOTH command shapes are registered below and the non-check shape
// SUCCEEDS, so this test cannot pass merely because an unregistered command errored:
// the only way the task fails is if 'True' was honored and `-check -diff` ran.
// A parser comparing against the lowercase literal reads 'True' as false, drops the
// check, and the formatting diff ships unnoticed.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'fmt');
tr.setInput('provider', 'none');
tr.setInput('templatePath', '.');
tr.setInput('fmtCheck', 'True');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        // Check mode honored -> formatting diff -> non-zero -> task fails (expected).
        'packer fmt -check -diff .': { code: 3, stdout: 'would reformat template.pkr.hcl' },
        // Check mode silently dropped -> plain fmt -> success -> task passes (the defect).
        'packer fmt .': { code: 0, stdout: '' }
    }
};

tr.setAnswers(a);
tr.run();
