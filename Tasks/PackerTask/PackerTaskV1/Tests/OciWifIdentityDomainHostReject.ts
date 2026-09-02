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
// A look-alike: the Oracle realm appears in the host, but not as its suffix.
// The endsWith + length check is what rejects this.
tr.setInput('ociWifIdentityDomainUrl', 'https://idcs-0123456789abcdef0123456789abcdef.identity.oraclecloud.com.evil.example');
tr.setInput('ociWifClientId', 'example-client-id');

import pipelineTaskAdo = require('@4cloudguru/pipeline-task-ado');

tr.registerMock('@4cloudguru/pipeline-task-ado', {
    ...pipelineTaskAdo,
    generateIdToken: (_serviceConnectionId: string) => Promise.resolve('mock-oci-oidc-jwt-12345')
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
