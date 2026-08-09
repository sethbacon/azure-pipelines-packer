import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// CLASS ROW — #101 (size half): the manifest is template-controlled content, so
// it must be size-bounded BEFORE being buffered whole and JSON.parse'd. Over the
// cap the task warns and publishes nothing rather than reading it in.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-class-bigmanifest-'));
// One byte over BasePackerCommandHandler.MANIFEST_MAX_BYTES (5 MiB).
fs.writeFileSync(path.join(workDir, 'manifest.json'), Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));

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
