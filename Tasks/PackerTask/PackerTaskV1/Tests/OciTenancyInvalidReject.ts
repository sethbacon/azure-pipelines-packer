import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import crypto = require('crypto');

const tp = path.join(__dirname, 'OciAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'oci');

const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const singleLineKey = (privateKey as string).replace(/\n/g, ' ').trim();

process.env['ENDPOINT_DATA_OCI_PRIVATEKEY'] = singleLineKey;
// Embedded newline: an OCI config/INI-injection-shaped value must be rejected,
// not interpolated into a PKR_VAR_* environment variable.
process.env['ENDPOINT_DATA_OCI_TENANCY'] = 'ocid1.tenancy.oc1..abc\nmalicious=injected';
process.env['ENDPOINT_DATA_OCI_USER'] = 'ocid1.user.oc1..aaaaaaaaexampleuserocid';
process.env['ENDPOINT_DATA_OCI_REGION'] = 'us-ashburn-1';
process.env['ENDPOINT_DATA_OCI_FINGERPRINT'] = 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99';

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
