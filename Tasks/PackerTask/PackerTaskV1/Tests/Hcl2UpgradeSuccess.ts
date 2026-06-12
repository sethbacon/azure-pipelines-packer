import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'hcl2_upgrade');
tr.setInput('provider', 'none');
tr.setInput('templatePath', 'template.json');
tr.setInput('hclOutputFile', 'out.pkr.hcl');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer hcl2_upgrade -output-file=out.pkr.hcl template.json': { code: 0, stdout: '' }
    }
};

tr.setAnswers(a);
tr.run();
