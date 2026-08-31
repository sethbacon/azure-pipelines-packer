import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #339: gcpServiceAccountEmail is interpolated into the WIF impersonation URL.
// 'not-an-email' passes the generic identity-field charset (letters and
// hyphens are allowed there) but is not shaped like
// <account-id>@<project-id>.iam.gserviceaccount.com -- it must now be rejected
// by the field-specific pattern.
const tp = path.join(__dirname, 'GcpWifValidationOnlyL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'gcp');
tr.setInput('environmentServiceNameGCP', 'GCP');
tr.setInput('environmentAuthSchemeGCP', 'WorkloadIdentityFederation');
tr.setInput('gcpProjectNumber', '123456789012');
tr.setInput('gcpWorkloadIdentityPoolId', 'my-pool');
tr.setInput('gcpWorkloadIdentityProviderId', 'my-provider');
tr.setInput('gcpServiceAccountEmail', 'not-an-email');

import pipelineTaskAdo = require('@4cloudguru/pipeline-task-ado');

tr.registerMock('@4cloudguru/pipeline-task-ado', {
    ...pipelineTaskAdo,
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-gcp-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
