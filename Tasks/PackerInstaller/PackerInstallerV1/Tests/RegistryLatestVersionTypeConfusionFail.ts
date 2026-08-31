import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// Finding 0 of #342: the registry's `versions/latest` response was validated
// only for truthiness ("!data.version"), never type, so a body where version
// is present but NOT a string -- e.g. a number -- passed the old guard and
// would have flowed downstream as a version string into the per-version info
// request. This asserts it is rejected immediately, before that second fetch.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', 'latest');
tr.setInput('downloadSource', 'registry');
tr.setInput('registryUrl', 'https://registry.example.com');
tr.setInput('registryMirrorName', 'packer');

tr.registerMock('os', {
    type: () => 'Linux',
    arch: () => 'x64'
});

// getValidatedRegistryUrl() resolves registryUrl's own host through the
// default-deny egress check before any fetch; mock dns so that passes without
// a real network lookup.
tr.registerMock('dns', {
    promises: {
        lookup: async (_host: string, _opts: unknown) => [{ address: '203.0.113.10', family: 4 }]
    }
});

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => {
        if (url.endsWith('/terraform/binaries/packer/versions/latest')) {
            return { version: 20260101 }; // malformed: number, not a string
        }
        throw new Error('Unexpected fetchJson URL: ' + url);
    },
    fetchText: async (url: string) => { throw new Error('Should not fetch when the latest-version response is type-confused: ' + url); }
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_toolName: string, _version: string) => null,
    downloadTool: async () => { throw new Error('Should not download when the latest-version response is type-confused'); },
    extractZip: async () => { throw new Error('Should not extract when the latest-version response is type-confused'); },
    cacheDir: async () => { throw new Error('Should not cache when the latest-version response is type-confused'); },
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
