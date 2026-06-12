import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'plugins');
tr.setInput('provider', 'none');
tr.setInput('pluginsSubCommand', 'install');
tr.setInput('pluginSource', 'github.com/hashicorp/azure');
tr.setInput('pluginVersion', '2.3.0');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer plugins install github.com/hashicorp/azure 2.3.0': { code: 0, stdout: 'Installed plugin.' }
    }
};

tr.setAnswers(a);
tr.run();
