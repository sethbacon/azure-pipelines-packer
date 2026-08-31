import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #339: onError's task.json declaration is `type: pickList` (UI-only), and
// build() interpolates it straight into `-on-error=${onError}` via tool.arg()
// (a single argv token, so no multi-token injection) with no allowlist check.
// An out-of-band value must be rejected before it reaches packer, not merely
// passed through as an opaque flag value.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'build');
tr.setInput('provider', 'none');
tr.setInput('templatePath', './img');
tr.setInput('onError', 'not-a-real-value');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer build -on-error=not-a-real-value ./img': { code: 0, stdout: 'Build finished.' }
    }
};

tr.setAnswers(a);
tr.run();
