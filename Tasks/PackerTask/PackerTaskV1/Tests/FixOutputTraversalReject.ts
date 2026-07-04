import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #111: the fix command's fixOutputFile working-directory containment check
// (base-packer-command-handler.ts's fix()) had zero L0 coverage.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'fix');
tr.setInput('provider', 'none');
tr.setInput('templatePath', 'template.json');
tr.setInput('workingDirectory', 'DummyWorkingDirectory');
// Escapes the working directory -- must be rejected before packer fix runs.
tr.setInput('fixOutputFile', '../../evil.json');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer fix template.json': { code: 0, stdout: '{}' }
    }
};

tr.setAnswers(a);
tr.run();
