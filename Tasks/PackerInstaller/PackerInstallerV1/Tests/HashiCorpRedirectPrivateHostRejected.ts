import ma = require('azure-pipelines-task-lib/mock-answer');
import tmrm = require('azure-pipelines-task-lib/mock-run');
import path = require('path');

// #334: downloadToFile's per-hop authorizeHost callback is what closes the gap
// tools.downloadTool() left open -- a redirect hop landing on an attacker- or
// misconfiguration-controlled private/link-local address must be refused even
// though the INITIAL host (releases.hashicorp.com) is a benign compile-time
// constant. The initial host resolves to an ordinary public address here; the
// http-client mock then plays the role of downloadToFile discovering a redirect
// hop and invoking the real authorizeHost callback with its target, the same way
// the production downloadToFile does for every hop.
const tp = path.join(__dirname, 'RunInstaller.js');
const tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(tp);

tr.setInput('packerVersion', '1.12.0');
tr.setInput('downloadSource', 'hashicorp');

tr.registerMock('os', { type: () => 'Linux', arch: () => 'x64', tmpdir: () => '/tmp' });

tr.registerMock('dns', {
    promises: {
        lookup: async (_host: string, _opts: unknown) => [{ address: '203.0.113.10', family: 4 }]
    }
});

tr.registerMock('./http-client', {
    fetchJson: async (url: string) => { throw new Error('Refused host must not be fetched: ' + url); },
    fetchText: async (url: string) => { throw new Error('Refused host must not be fetched: ' + url); },
    downloadToFile: async (
        _url: string,
        _destPath: string,
        _timeoutMs: number,
        authorizeHost: (hostname: string) => Promise<void>
    ) => {
        // A redirect hop steering the download at the cloud metadata address.
        await authorizeHost('169.254.169.254');
    }
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
