import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// Class residual (batch-A fold, site 1): downloadZipFromRegistry's info fetch
// (fetchJson(infoUrl)) previously ran with NO local re-authorization of
// registryUrl's own host -- it relied entirely on getValidatedRegistryUrl()
// having checked it once, earlier, in the caller. That is a real gap for a
// DNS-rebinding registry: the resolved address at validation time can differ
// from the resolved address at request time. This test drives exactly that: the
// FIRST DNS lookup (getValidatedRegistryUrl) resolves publicly, the SECOND lookup
// (this function's own hoisted check) resolves to the cloud metadata address.
//
// fetchJson is mocked to throw a DISTINCT sentinel error if it is ever reached,
// so a regression that drops the hoisted check is caught by a CHANGE IN WHICH
// MESSAGE surfaces (the sentinel) rather than by the task merely failing for an
// unrelated reason.
let dnsLookups = 0;
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0'); // pinned: resolveVersionFromRegistry short-circuits, no dns lookup there
tr.setInput('downloadSource', 'registry');
tr.setInput('registryUrl', 'https://registry.example.com/artifactory');
tr.setInput('registryMirrorName', 'packer');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('dns', {
    promises: {
        lookup: async (_host: string, _opts: unknown) => {
            dnsLookups++;
            // 1st lookup: getValidatedRegistryUrl's own check -- resolves publicly.
            // 2nd lookup: the hoisted check inside downloadZipFromRegistry -- rebinds
            // to the cloud metadata address.
            return dnsLookups === 1 ? [{ address: '203.0.113.10', family: 4 }] : [{ address: '169.254.169.254', family: 4 }];
        }
    }
});

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('SENTINEL_MUST_NOT_REACH_FETCHJSON: ' + url); },
    fetchText: async (url: string) => { throw new Error('SENTINEL_MUST_NOT_REACH_FETCHJSON: ' + url); },
    downloadToFile: async (url: string) => { throw new Error('SENTINEL_MUST_NOT_REACH_FETCHJSON: ' + url); }
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
