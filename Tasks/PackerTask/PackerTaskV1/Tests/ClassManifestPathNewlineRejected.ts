import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import fs = require('fs');
import os = require('os');

// CLASS ROW — setVariable('manifestFilePath'). The exported value is the
// RESOLVED manifest path; a working directory whose own name carries a newline
// (legal on POSIX) makes that path control-char-bearing, so the same guard that
// protects artifactId has to reject it here too rather than exporting a value
// that would forge a logging command. POSIX-only: NTFS rejects '\n' in a name,
// so the class test skips this row on Windows.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkr-class-nl\n-'));
fs.writeFileSync(path.join(workDir, 'manifest.json'), JSON.stringify({ builds: [{ artifact_id: 'ami-ok' }] }));

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
