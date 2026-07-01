import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import crypto = require('crypto');

const tp = path.join(__dirname, 'OciValidateCleanupL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('command', 'validate');
tr.setInput('provider', 'oci');
tr.setInput('templatePath', '.');
tr.setInput('environmentServiceNameOCI', 'OCI');

const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
process.env['ENDPOINT_DATA_OCI_PRIVATEKEY'] = (privateKey as string).replace(/\n/g, ' ').trim();
process.env['ENDPOINT_DATA_OCI_TENANCY'] = 'ocid1.tenancy.oc1..aaaaaaaaexampletenancyocid';
process.env['ENDPOINT_DATA_OCI_USER'] = 'ocid1.user.oc1..aaaaaaaaexampleuserocid';
process.env['ENDPOINT_DATA_OCI_REGION'] = 'us-ashburn-1';
process.env['ENDPOINT_DATA_OCI_FINGERPRINT'] = 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99';

const a: ma.TaskLibAnswers = {
    which: { packer: 'packer' },
    checkPath: { packer: true },
    exec: {
        'packer validate .': { code: 0, stdout: 'The configuration is valid.' }
    }
};

tr.setAnswers(a);
tr.run();
