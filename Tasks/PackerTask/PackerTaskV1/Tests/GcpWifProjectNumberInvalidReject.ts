import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #339: gcpProjectNumber is interpolated into the WIF audience URL and, before
// this fix, was validated only by the generic identity-field charset (which
// allows letters). 'not-a-number' passes that generic charset but is not a
// GCP project number (digits only) -- it must now be rejected by the
// field-specific grammar, the same idiom OCID_PATTERN/REGION_PATTERN already
// apply to the OCI handler.
const tp = path.join(__dirname, 'GcpWifValidationOnlyL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'gcp');
tr.setInput('environmentServiceNameGCP', 'GCP');
tr.setInput('environmentAuthSchemeGCP', 'WorkloadIdentityFederation');
tr.setInput('gcpProjectNumber', 'not-a-number');
tr.setInput('gcpWorkloadIdentityPoolId', 'my-pool');
tr.setInput('gcpWorkloadIdentityProviderId', 'my-provider');
tr.setInput('gcpServiceAccountEmail', 'builder@my-project.iam.gserviceaccount.com');

// import = require() (not a hoisted ES import) for the same input-vault-timing
// reason documented in GcpWifAuth.ts.
import pipelineTaskAdo = require('@4cloudguru/pipeline-task-ado');

tr.registerMock('@4cloudguru/pipeline-task-ado', {
    ...pipelineTaskAdo,
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-gcp-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
