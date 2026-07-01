import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'AwsStaticAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'aws');

process.env['ENDPOINT_AUTH_PARAMETER_AWS_USERNAME'] = 'AKIAEXAMPLE';
// Secret access key deliberately omitted: must fail closed, not fall back to
// ambient/instance-profile credentials.

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
