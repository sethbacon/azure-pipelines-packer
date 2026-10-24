import * as assert from 'assert';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';

/**
 * CLASS TEST -- the proxy dispatcher this task ships must work with THIS Node's fetch.
 *
 * On a proxy-configured agent, @4cloudguru/pipeline-task-ado passes Node's GLOBAL
 * fetch a `new undici.ProxyAgent(...)` as its `dispatcher`, built from whichever
 * undici this task installs. Node's fetch is itself undici -- its own bundled
 * copy -- and a dispatcher from another major need not speak the same handler
 * protocol. undici 8's does not: under Node 24 every proxied request failed with
 * "invalid onRequestStart method", and under Node 20 undici 8 does not load at
 * all. Every mock-runner scenario registers a stub for `undici`, so nothing here
 * exercised the real pair until this row.
 *
 * It uses the real undici, resolved from pipeline-task-ado's own location so it
 * is the copy that package actually requires, the real global fetch, and a real
 * CONNECT proxy and target on loopback. It runs wherever the suite runs, which
 * for PackerInstallerV1 includes the Node 20 leg.
 */

interface ProxyAgentCtor { new (proxyUrl: string): object }

function undiciAsPipelineTaskAdoSeesIt(): { ProxyAgent: ProxyAgentCtor; version: string } {
    const adoDir = path.dirname(require.resolve('@4cloudguru/pipeline-task-ado'));
    const entry = require.resolve('undici', { paths: [adoDir] });
    const pkg = require.resolve('undici/package.json', { paths: [adoDir] });
    return { ProxyAgent: require(entry).ProxyAgent, version: require(pkg).version };
}

function listen(server: http.Server): Promise<number> {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)));
}

describe('proxy dispatcher compatibility (class test)', function () {
    this.timeout(15000);

    const tunnels: string[] = [];
    const target = http.createServer((_req, res) => res.end('reached'));
    const proxy = http.createServer((_req, res) => { res.writeHead(405); res.end(); });
    proxy.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
        tunnels.push(String(req.url));
        const [host, port] = String(req.url).split(':');
        const upstream = net.connect(Number(port), host, () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            upstream.write(head);
            upstream.pipe(client);
            client.pipe(upstream);
        });
        upstream.on('error', () => client.destroy());
        client.on('error', () => upstream.destroy());
    });

    let targetPort: number;
    let proxyPort: number;
    before(async () => {
        targetPort = await listen(target);
        proxyPort = await listen(proxy);
    });
    after(() => {
        target.close();
        proxy.close();
    });

    it(`routes a global fetch through the undici ProxyAgent pipeline-task-ado builds (Node ${process.version})`, async () => {
        const { ProxyAgent, version } = undiciAsPipelineTaskAdoSeesIt();
        const dispatcher = new ProxyAgent(`http://127.0.0.1:${proxyPort}`);

        let response: Response;
        try {
            response = await fetch(`http://127.0.0.1:${targetPort}/`, { dispatcher } as RequestInit);
        } catch (err) {
            const cause = (err as { cause?: Error }).cause;
            assert.fail(`Node ${process.version}'s fetch rejected undici ${version}'s ProxyAgent: ${cause ? cause.message : String(err)}`);
        }

        assert.strictEqual(response.status, 200);
        assert.strictEqual(await response.text(), 'reached');
        assert.deepStrictEqual(tunnels, [`127.0.0.1:${targetPort}`], 'the request must have gone through the proxy, not around it');
    });
});
