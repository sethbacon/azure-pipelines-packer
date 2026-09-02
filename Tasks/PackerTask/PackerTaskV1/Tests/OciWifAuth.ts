import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'OciWifAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'oci');
tr.setInput('environmentAuthSchemeOCI', 'WorkloadIdentityFederation');
tr.setInput('environmentServiceNameOCI', 'OCI');
tr.setInput('ociWifTenancyOcid', 'ocid1.tenancy.oc1..aaaaaaaaexampletenancyocid');
tr.setInput('ociWifRegion', 'us-ashburn-1');
tr.setInput('ociWifIdentityDomainUrl', 'https://idcs-0123456789abcdef0123456789abcdef.identity.oraclecloud.com');
tr.setInput('ociWifClientId', 'example-client-id');

// import = require() (not a hoisted ES import) so azure-pipelines-task-lib/task.js
// is not required until after every tr.setInput() above -- task.js snapshots the
// input vault from process.env exactly once per process, on its own first
// require, so requiring it any earlier makes every input above invisible to the
// real getInput() the spawned entry point calls.
import pipelineTaskAdo = require('@4cloudguru/pipeline-task-ado');

// Only generateIdToken is faked (no real OIDC network call in a unit test).
// exchangeOidcForUpst deliberately stays REAL -- the entry point stubs global
// fetch instead, so the realm validation, redirect refusal and JSON handling all
// execute rather than being mocked away.
tr.registerMock('@4cloudguru/pipeline-task-ado', {
    ...pipelineTaskAdo,
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-oci-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
