import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// variableFiles had zero working-directory containment (unlike fixOutputFile/
// hclOutputFile/manifestFile, which already used isWithinWorkingDirectory).
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'validate');
tr.setInput('provider', 'none');
tr.setInput('templatePath', 'template.json');
tr.setInput('workingDirectory', 'DummyWorkingDirectory');
// Escapes the working directory -- must be rejected before packer validate runs.
tr.setInput('variableFiles', '../../evil.pkrvars.hcl');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer validate -var-file=../../evil.pkrvars.hcl template.json': { code: 0, stdout: '' }
    }
};

tr.setAnswers(a);
tr.run();
