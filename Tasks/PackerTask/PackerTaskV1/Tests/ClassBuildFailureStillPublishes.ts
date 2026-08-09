import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// CLASS ROW — #202: the boundary crossing must not be DROPPED by a rejecting
// exec. A multi-builder template where one builder fails exits non-zero while
// the manifest post-processor has ALREADY recorded the artifacts the other
// builders created. The task must still fail, but artifactId/manifestFilePath
// have to be published first so a cleanup/deregistration step can find the
// orphans.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-class-buildfail-'));
fs.writeFileSync(
    path.join(workDir, 'manifest.json'),
    JSON.stringify({ builds: [{ name: 'succeeded-builder', artifact_id: 'ami-partial-0001' }] })
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
    exec: { 'packer build .': { code: 1, stdout: 'Build "second" errored.' } },
};

tr.setAnswers(a);
tr.run();
