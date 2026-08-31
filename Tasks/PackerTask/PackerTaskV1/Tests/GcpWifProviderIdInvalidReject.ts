import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #339: gcpWorkloadIdentityProviderId is interpolated into the WIF audience
// URL. 'MyProvider' passes the generic identity-field charset (uppercase is
// allowed there) but violates GCP's provider-ID grammar (same [a-z0-9-]
// resource-ID shape as the pool ID) -- it must now be rejected by the
// field-specific pattern.
const tp = path.join(__dirname, 'GcpWifValidationOnlyL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'gcp');
tr.setInput('environmentServiceNameGCP', 'GCP');
tr.setInput('environmentAuthSchemeGCP', 'WorkloadIdentityFederation');
tr.setInput('gcpProjectNumber', '123456789012');
tr.setInput('gcpWorkloadIdentityPoolId', 'my-pool');
tr.setInput('gcpWorkloadIdentityProviderId', 'MyProvider');
tr.setInput('gcpServiceAccountEmail', 'builder@my-project.iam.gserviceaccount.com');

import pipelineTaskAdo = require('@4cloudguru/pipeline-task-ado');

tr.registerMock('@4cloudguru/pipeline-task-ado', {
    ...pipelineTaskAdo,
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-gcp-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
