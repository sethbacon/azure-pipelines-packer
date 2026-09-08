import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #1105 class row: customCommand is a free-form argument string that can carry
// a URL with userinfo. The credential must be registered with the masker BEFORE
// any line that could show it is written -- task-lib's own debug line at read
// time, the per-argument debug lines, the [command] echo -- so the agent masks
// every one of them at runtime.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'custom');
tr.setInput('provider', 'none');
tr.setInput('customCommand', 'init -var plugin_mirror=https://svc:CUSTOM-TOKEN-xyz@mirror.example.com/plugins');
tr.setInput('commandOptions', '');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer init -var plugin_mirror=https://svc:CUSTOM-TOKEN-xyz@mirror.example.com/plugins': { code: 0, stdout: '' }
    }
};
tr.setAnswers(a);
tr.run();
