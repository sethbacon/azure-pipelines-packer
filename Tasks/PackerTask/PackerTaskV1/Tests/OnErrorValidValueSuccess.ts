import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #339: negative control for OnErrorInjectionReject -- a value that IS one of
// task.json's declared onError options must still pass validateOnError() and
// reach -on-error= unchanged. Without this, a mutation that always throws (not
// just for out-of-band values) would pass the reject test alone.
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'build');
tr.setInput('provider', 'none');
tr.setInput('templatePath', './img');
tr.setInput('onError', 'abort');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer build -on-error=abort ./img': { code: 0, stdout: 'Build finished.' }
    }
};

tr.setAnswers(a);
tr.run();
