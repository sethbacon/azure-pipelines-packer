import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');
import crypto = require('crypto');

// #108: a genuine multi-line PEM (delivered via the REST API / az devops CLI
// rather than the UI passwordbox, which strips newlines) must not make
// tasks.setSecret throw LIB_MultilineSecret before any credential is written.
const tp = path.join(__dirname, 'GcpAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'gcp');
tr.setInput('environmentServiceNameGCP', 'GCP');

process.env['ENDPOINT_AUTH_PARAMETER_GCP_ISSUER'] = 'builder@my-project.iam.gserviceaccount.com';
process.env['ENDPOINT_AUTH_PARAMETER_GCP_AUDIENCE'] = 'https://oauth2.googleapis.com/token';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
process.env['ENDPOINT_AUTH_PARAMETER_GCP_PRIVATEKEY'] = privateKey as string; // genuine multi-line PEM, NOT flattened
process.env['ENDPOINT_DATA_GCP_PROJECT'] = 'my-project';

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
