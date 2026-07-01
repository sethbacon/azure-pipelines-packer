import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'AwsWifAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'aws');
tr.setInput('environmentAuthSchemeAWS', 'WorkloadIdentityFederation');
tr.setInput('environmentServiceNameAWS', 'AWS');
tr.setInput('awsRoleArn', 'arn:aws:iam::123456789012:role/packer-builder');
tr.setInput('awsRegion', 'us-east-1');

tr.registerMock('./id-token-generator', {
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-aws-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
