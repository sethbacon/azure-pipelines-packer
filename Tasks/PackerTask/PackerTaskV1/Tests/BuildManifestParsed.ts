import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// #80: the manifest happy-path — a valid Packer manifest post-processor file
// inside the working directory must set the artifactId and manifestFilePath output
// variables. A real temp working directory + manifest.json is created so the
// (unmocked) fs read and within-working-directory realpath check run for real.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-manifest-ok-'));
fs.writeFileSync(
    path.join(workDir, 'manifest.json'),
    JSON.stringify({ builds: [{ name: 'first', artifact_id: 'first-id' }, { name: 'last', artifact_id: 'ami-0123456789' }] })
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
