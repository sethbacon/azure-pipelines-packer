import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'build');
tr.setInput('provider', 'none');
tr.setInput('templatePath', '.');
// AWS_REGION is a MANAGED name that merely CONFIGURES an already-chosen identity,
// so it still only warns. Names that SELECT an identity (AWS_ACCESS_KEY_ID and
// friends) are now rejected outright -- see EnvironmentVariablesIdentityReject (#187).
tr.setInput('environmentVariables', 'AWS_REGION=eu-west-1\nMY_CUSTOM_BUILD_VAR=hello');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer build .': { code: 0, stdout: 'Build finished.' }
    }
};

tr.setAnswers(a);
tr.run();
