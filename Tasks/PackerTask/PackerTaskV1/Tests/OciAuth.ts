import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import crypto = require('crypto');

const tp = path.join(__dirname, 'OciAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'oci');

// Generate a real RSA key so the OCI handler's PEM normalization (which validates
// with crypto.createPrivateKey) succeeds. Service connections often deliver the
// PEM as a single line with spaces, so flatten newlines to spaces to mirror that.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const singleLineKey = (privateKey as string).replace(/\n/g, ' ').trim();

process.env['ENDPOINT_DATA_OCI_PRIVATEKEY'] = singleLineKey;
process.env['ENDPOINT_DATA_OCI_TENANCY'] = 'ocid1.tenancy';
process.env['ENDPOINT_DATA_OCI_USER'] = 'ocid1.user';
process.env['ENDPOINT_DATA_OCI_REGION'] = 'us-ashburn-1';
process.env['ENDPOINT_DATA_OCI_FINGERPRINT'] = 'aa:bb:cc';

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
