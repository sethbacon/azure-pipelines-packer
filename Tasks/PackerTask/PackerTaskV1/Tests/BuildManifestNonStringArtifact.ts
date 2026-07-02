import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// #80: type-guard skip branch — when the last build's artifact_id is neither a
// string nor a number, manifestFilePath is still set but artifactId is skipped
// (a template must not be able to inject a structured value as an output var).
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-manifest-badtype-'));
fs.writeFileSync(
    path.join(workDir, 'manifest.json'),
    JSON.stringify({ builds: [{ name: 'last', artifact_id: { nested: 'object' } }] })
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
