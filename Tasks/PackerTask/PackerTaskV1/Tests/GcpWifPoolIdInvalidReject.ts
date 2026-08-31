import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #339: gcpWorkloadIdentityPoolId is interpolated into the WIF audience URL.
// 'MyPool' passes the generic identity-field charset (uppercase is allowed
// there) but violates GCP's own pool-ID grammar (4-32 chars, lowercase
// [a-z0-9-] only, per the gcloud SDK reference) -- it must now be rejected by
// the field-specific pattern.
const tp = path.join(__dirname, 'GcpWifValidationOnlyL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'gcp');
tr.setInput('environmentServiceNameGCP', 'GCP');
tr.setInput('environmentAuthSchemeGCP', 'WorkloadIdentityFederation');
tr.setInput('gcpProjectNumber', '123456789012');
tr.setInput('gcpWorkloadIdentityPoolId', 'MyPool');
tr.setInput('gcpWorkloadIdentityProviderId', 'my-provider');
tr.setInput('gcpServiceAccountEmail', 'builder@my-project.iam.gserviceaccount.com');

import pipelineTaskAdo = require('@4cloudguru/pipeline-task-ado');

tr.registerMock('@4cloudguru/pipeline-task-ado', {
    ...pipelineTaskAdo,
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-gcp-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
