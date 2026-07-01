import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'GcpWifAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'gcp');
tr.setInput('environmentServiceNameGCP', 'GCP');
tr.setInput('environmentAuthSchemeGCP', 'WorkloadIdentityFederation');
tr.setInput('gcpProjectNumber', '123456789012');
tr.setInput('gcpWorkloadIdentityPoolId', 'my-pool');
tr.setInput('gcpWorkloadIdentityProviderId', 'my-provider');
tr.setInput('gcpServiceAccountEmail', 'builder@my-project.iam.gserviceaccount.com');

tr.registerMock('./id-token-generator', {
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-gcp-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
