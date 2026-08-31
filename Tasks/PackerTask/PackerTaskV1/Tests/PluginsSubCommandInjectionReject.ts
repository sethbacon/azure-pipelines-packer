import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #339: pluginsSubCommand's task.json declaration is `type: pickList`, which is
// a UI-only affordance -- a YAML pipeline can still supply any string, and that
// value flows straight into createBaseCommand(`plugins ${subCommand}`) and then
// packer.ts's toolRunner.line(command.name), which word-splits on whitespace. A
// value like 'install --extra-flag' must be rejected before it ever reaches
// that call, not tokenized into extra argv entries.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'plugins');
tr.setInput('provider', 'none');
tr.setInput('pluginsSubCommand', 'install --extra-flag');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer plugins install --extra-flag': { code: 0, stdout: '' }
    }
};

tr.setAnswers(a);
tr.run();
