import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #100: hclOutputFile must get the same working-directory containment guard
// as fixOutputFile/manifestFile -- a traversal value must be rejected before
// packer hcl2_upgrade runs, not handed straight through as -output-file.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'hcl2_upgrade');
tr.setInput('provider', 'none');
tr.setInput('templatePath', 'template.json');
tr.setInput('workingDirectory', 'DummyWorkingDirectory');
tr.setInput('hclOutputFile', '../../evil.pkr.hcl');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer hcl2_upgrade -output-file=../../evil.pkr.hcl template.json': { code: 0, stdout: '' }
    }
};

tr.setAnswers(a);
tr.run();
