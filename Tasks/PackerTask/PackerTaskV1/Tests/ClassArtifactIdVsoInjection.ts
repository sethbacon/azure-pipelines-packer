import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// CLASS ROW — setVariable('artifactId') (#101). The manifest is written by the
// build TEMPLATE's manifest post-processor, so its artifact_id is untrusted
// content. A value carrying CR/LF plus a literal `##vso[` payload must not reach
// the output variable: the agent decodes the logging-command escaping, so the
// stored VALUE would keep the raw newline and a later `$(artifactId)` expansion
// (or the log line itself) would carry an attacker-authored logging command.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-class-vso-'));
fs.writeFileSync(
    path.join(workDir, 'manifest.json'),
    JSON.stringify({
        builds: [{ name: 'last', artifact_id: 'ami-0123\n##vso[task.setvariable variable=pwnedByTemplate]1' }],
    })
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
    exec: { 'packer build .': { code: 0, stdout: 'Build finished.' } },
};

tr.setAnswers(a);
tr.run();
