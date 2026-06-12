import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'init');
tr.setInput('provider', 'none');
tr.setInput('templatePath', '.');
tr.setInput('upgradePlugins', 'true');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer init -upgrade .': { code: 0, stdout: 'Installed plugins.' }
    }
};

tr.setAnswers(a);
tr.run();
