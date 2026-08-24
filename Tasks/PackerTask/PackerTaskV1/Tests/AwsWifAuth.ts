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

// import = require() (not a hoisted ES import) so azure-pipelines-task-lib/task.js
// is not required until after every tr.setInput()/process.env assignment above --
// task.js snapshots the input vault from process.env exactly once per process, on
// its own first require, so requiring it any earlier makes every input above
// invisible to the real getInput() the spawned entry point calls.
import pipelineTaskAdo = require('@4cloudguru/pipeline-task-ado');

// Only generateIdToken is faked (no real OIDC network call in a unit test); every
// other export -- EnvironmentVariableHelper/writeSecretFile included -- stays the
// real, published implementation so its actual (shared, static) behavior is
// exercised.
tr.registerMock('@4cloudguru/pipeline-task-ado', {
    ...pipelineTaskAdo,
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-aws-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
