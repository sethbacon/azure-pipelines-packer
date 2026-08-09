import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #189, failure half: the real src/index.ts must FAIL CLOSED when the
// post-install `packer version` verification does not succeed — a download that
// produced an unusable binary must not be reported as a successful install.
// Exercises index.ts's catch branch (the one the re-implemented
// Tests/RunInstaller.js entry never covered).
const tp = path.join(__dirname, '..', 'src', 'index.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

const installDir = path.join(path.sep + 'opt', 'hostedtoolcache', 'packer', '1.12.0', 'x64');
const packerPath = path.join(installDir, 'packer');

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'hashicorp');

tr.registerMock('./packer-installer', {
    downloadPacker: async (_version: string) => packerPath
});

tr.registerMock('azure-pipelines-tool-lib/tool', {
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {
    which: { packer: packerPath },
    checkPath: { [packerPath]: true },
    exec: {
        [`${packerPath} version`]: { code: 1, stdout: '', stderr: 'packer: cannot execute binary file' }
    }
};

tr.setAnswers(a);
tr.run();
