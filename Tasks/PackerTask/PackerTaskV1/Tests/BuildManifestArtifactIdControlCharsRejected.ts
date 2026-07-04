import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// #101: a template-controlled artifact_id containing a newline (shell/log
// injection shape, e.g. an attacker-influenced image name embedding
// `\nrm -rf /`) must be rejected, not exported as a pipeline output variable
// that later steps commonly macro-expand into a script.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-manifest-injection-'));
fs.writeFileSync(
    path.join(workDir, 'manifest.json'),
    JSON.stringify({ builds: [{ name: 'last', artifact_id: 'ami-0123\nrm -rf /' }] })
);

const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'build');
tr.setInput('provider', 'none');
tr.setInput('templatePath', '.');
tr.setInput('workingDirectory', workDir);
tr.setInput('manifestFile', 'manifest.json');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer build .': { code: 0, stdout: 'Build finished.' }
    }
};

tr.setAnswers(a);
tr.run();
