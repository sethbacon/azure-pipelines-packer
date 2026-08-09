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

// #197: awsSessionName is deliberately left unset so this exercises the DERIVED
// default. Job context supplies the CloudTrail-pivotable identity of the run.
process.env['SYSTEM_TEAMPROJECT'] = 'Contoso Images';
process.env['BUILD_BUILDID'] = '4242';

// #187: the WIF path must clear static keys inherited from the agent, or the AWS
// SDK matches them BEFORE the web-identity token file and the assertion minted
// below is silently ignored.
process.env['AWS_ACCESS_KEY_ID'] = 'AKIAINHERITEDFROMAGENT';
process.env['AWS_SECRET_ACCESS_KEY'] = 'inherited-secret-from-agent';
process.env['AWS_SESSION_TOKEN'] = 'inherited-session-token';

tr.registerMock('./id-token-generator', {
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-aws-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
