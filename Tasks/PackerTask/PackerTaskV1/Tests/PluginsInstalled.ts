import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'plugins');
tr.setInput('provider', 'none');
tr.setInput('pluginsSubCommand', 'installed');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer plugins installed': { code: 0, stdout: '' }
    }
};

tr.setAnswers(a);
tr.run();
