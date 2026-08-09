import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import crypto = require('crypto');

// #195: an OCI service connection created via the REST API / az devops CLI
// (rather than the UI passwordbox, which strips newlines on paste) delivers a
// genuine multi-line PEM. tasks.setSecret() throws LIB_MultilineSecret on a
// CR/LF-bearing value, so registering the raw key whole aborted the whole OCI
// provider before any credential was written — AND left the raw form
// unregistered. Mirrors GcpMultilinePemAuth.ts.
const tp = path.join(__dirname, 'OciAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'oci');

const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

process.env['ENDPOINT_DATA_OCI_PRIVATEKEY'] = privateKey as string; // genuine multi-line PEM, NOT flattened
process.env['ENDPOINT_DATA_OCI_TENANCY'] = 'ocid1.tenancy.oc1..aaaaaaaaexampletenancyocid';
process.env['ENDPOINT_DATA_OCI_USER'] = 'ocid1.user.oc1..aaaaaaaaexampleuserocid';
process.env['ENDPOINT_DATA_OCI_REGION'] = 'us-ashburn-1';
process.env['ENDPOINT_DATA_OCI_FINGERPRINT'] = 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99';

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
