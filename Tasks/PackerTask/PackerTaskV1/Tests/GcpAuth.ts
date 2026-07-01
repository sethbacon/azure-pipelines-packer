import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

const tp = path.join(__dirname, 'GcpAuthL0.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('provider', 'gcp');
tr.setInput('environmentServiceNameGCP', 'GCP');

process.env['ENDPOINT_AUTH_PARAMETER_GCP_ISSUER'] = 'builder@my-project.iam.gserviceaccount.com';
process.env['ENDPOINT_AUTH_PARAMETER_GCP_AUDIENCE'] = 'https://oauth2.googleapis.com/token';
// tasks.setSecret() rejects multi-line values; ADO service connections
// deliver a pasted PEM the same way (flattened to a single line), which is
// why the production code can call setSecret() on it directly.
process.env['ENDPOINT_AUTH_PARAMETER_GCP_PRIVATEKEY'] = '-----BEGIN PRIVATE KEY----- fake -----END PRIVATE KEY-----';
process.env['ENDPOINT_DATA_GCP_PROJECT'] = 'my-project';

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
