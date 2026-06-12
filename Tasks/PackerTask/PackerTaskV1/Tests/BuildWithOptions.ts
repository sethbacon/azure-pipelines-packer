import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'build');
tr.setInput('provider', 'none');
tr.setInput('templatePath', './img');
tr.setInput('onlyBuilds', 'amazon-ebs.example');
tr.setInput('force', 'true');
tr.setInput('packerVariables', 'region=us-east-1');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer build -only=amazon-ebs.example -force -var region=us-east-1 ./img': { code: 0, stdout: 'Build finished.' }
    }
};

tr.setAnswers(a);
tr.run();
