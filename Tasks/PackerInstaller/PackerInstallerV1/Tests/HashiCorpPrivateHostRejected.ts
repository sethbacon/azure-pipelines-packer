import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #334: unlike mirrorBaseUrl/registryUrl, releases.hashicorp.com is a compile-time
// constant -- there is no operator input to point it at a literal private IP the
// way MirrorPrivateHostRejected/RegistryUrlPrivateHostRejected do. The only way to
// reach the isPrivate refusal for a fixed hostname is a resolved DNS answer landing
// on a private/link-local address -- the same shape assertEgressHostAllowed would
// see from a poisoned resolver or a redirect hop steering the download internally.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'hashicorp');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('dns', {
    promises: {
        lookup: async (_host: string, _opts: unknown) => [{ address: '10.0.0.5', family: 4 }]
    }
});

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Refused host must not be fetched: ' + url); },
    fetchText: async (url: string) => { throw new Error('Refused host must not be fetched: ' + url); },
    downloadToFile: async (url: string) => { throw new Error('Refused host must not be downloaded: ' + url); }
});

tr.registerMock('undici', { ProxyAgent: class { } });
tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_t: string, _v: string) => null,
    cleanVersion: (v: string) => v,
    prependPath: (_p: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
