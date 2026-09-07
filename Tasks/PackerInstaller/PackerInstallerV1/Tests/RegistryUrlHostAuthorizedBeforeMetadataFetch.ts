import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// M8 (batch-A iter3 mutation gap): downloadZipFromRegistry's own hoisted
// assertEgressHostAllowed(new URL(registryUrl).hostname, ...) call must independently
// authorize registryUrl's host BEFORE the info metadata fetch (fetchJson), for a
// PINNED (non-'latest') version -- not rely on getValidatedRegistryUrl() having
// already checked it earlier in the same request.
//
// registryUrl's real host is checked THREE times before any download_url exists:
// (1) downloadPacker's Step 1 call to getValidatedRegistryUrl(), (2) Step 3's
// separate call to getValidatedRegistryUrl() right before downloadZipFromRegistry,
// and (3) downloadZipFromRegistry's OWN hoisted check. The dns.lookup mock below is
// keyed BY HOSTNAME so calls (1) and (2) resolve publicly (pass) and only the 3rd
// lookup for the real host resolves to the cloud metadata address -- isolating
// failure (3) as the one under test. Any OTHER hostname (e.g. a mutation that
// hardcodes a different, "allowed-looking" literal into the hoisted call instead of
// forwarding registryUrl's real host) resolves publicly, so a hostname-swap mutation
// slips straight through to fetchJson, which throws a DISTINCT sentinel error.
const lookupCountsByHost: Record<string, number> = {};
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0'); // pinned: resolveVersionFromRegistry short-circuits, no dns lookup there
tr.setInput('downloadSource', 'registry');
tr.setInput('registryUrl', 'https://registry.example.com/artifactory');
tr.setInput('registryMirrorName', 'packer');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('dns', {
    promises: {
        lookup: async (host: string, _opts: unknown) => {
            lookupCountsByHost[host] = (lookupCountsByHost[host] || 0) + 1;
            if (host === 'registry.example.com' && lookupCountsByHost[host] <= 2) {
                return [{ address: '203.0.113.10', family: 4 }];
            }
            if (host === 'registry.example.com') {
                // 3rd+ lookup for the real host: the hoisted check inside
                // downloadZipFromRegistry.
                return [{ address: '169.254.169.254', family: 4 }];
            }
            // Any other hostname (e.g. a hardcoded literal substituted by a mutation)
            // resolves publicly -- exactly what would let that mutation go unnoticed.
            return [{ address: '203.0.113.10', family: 4 }];
        }
    }
});

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('SENTINEL_MUST_NOT_REACH_FETCHJSON: ' + url); },
    fetchText: async (url: string) => { throw new Error('SENTINEL_MUST_NOT_REACH_FETCHJSON: ' + url); },
    fetchTextAllow404: async (url: string) => { throw new Error('SENTINEL_MUST_NOT_REACH_FETCHJSON: ' + url); },
    downloadToFile: async (url: string) => { throw new Error('SENTINEL_MUST_NOT_REACH_FETCHJSON: ' + url); }
});

tr.registerMock('undici', { ProxyAgent: class { } });

tr.registerMock('azure-pipelines-tool-lib/tool', {
    findLocalTool: (_toolName: string, _version: string) => null,
    cleanVersion: (version: string) => version,
    prependPath: (_toolPath: string) => { }
});

const a: ma.TaskLibAnswers = {};
tr.setAnswers(a);
tr.run();
