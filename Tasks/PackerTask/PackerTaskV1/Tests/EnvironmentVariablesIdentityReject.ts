import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

/**
 * #187: `environmentVariables` is applied by `executeCommand()` BEFORE any
 * provider handler runs, and a name that SELECTS an identity used to survive
 * with only a warning -- one that wrongly promised the provider handler would
 * overwrite it. For AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY it never did, and
 * the AWS SDK matches static env credentials strictly before the web-identity
 * token file, so a passthrough silently defeated Workload Identity Federation.
 * Identity-selecting names are now rejected outright.
 */
const tp = path.join(__dirname, 'RunCommand.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'build');
tr.setInput('provider', 'none');
tr.setInput('templatePath', '.');
tr.setInput('environmentVariables', 'AWS_ACCESS_KEY_ID=fake-value\nMY_CUSTOM_BUILD_VAR=hello');

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer build .': { code: 0, stdout: 'Build finished.' }
    }
};

tr.setAnswers(a);
tr.run();
