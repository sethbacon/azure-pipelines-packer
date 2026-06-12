import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'AwsStaticAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'aws');
tr.setInput('environmentAuthSchemeAWS', 'ServiceConnection');
tr.setInput('awsRegion', 'us-east-1');

process.env['ENDPOINT_AUTH_PARAMETER_AWS_USERNAME'] = 'AKIATEST';
process.env['ENDPOINT_AUTH_PARAMETER_AWS_PASSWORD'] = 'secretkey';

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
