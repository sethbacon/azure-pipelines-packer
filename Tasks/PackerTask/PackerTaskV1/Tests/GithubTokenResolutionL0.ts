import * as assert from 'assert';
import tasks = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerNone } from '../src/none-packer-command-handler';

/**
 * `PACKER_GITHUB_API_TOKEN` resolution (#142).
 *
 * A GitHub service connection is preferred over the plain `githubToken` input
 * because the credential then lives in the organization's service-connection
 * store rather than in the pipeline definition.
 *
 * The rows that matter are the two auth-scheme spellings and the fail-closed
 * case. GitHub connections expose the token under `accessToken` for a PAT
 * connection and `AccessToken` for the OAuth and GitHub App schemes; reading
 * only one silently yields nothing for the other, which is indistinguishable
 * from "no token configured" and would quietly fall back to an unauthenticated
 * plugin download.
 */
describe('GitHub token resolution (#142)', function () {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monkeypatch the shared task-lib module
    const t = tasks as any;
    const orig = { getInput: t.getInput, getEndpointAuthorizationParameter: t.getEndpointAuthorizationParameter, setSecret: t.setSecret };

    let inputs: Record<string, string>;
    let endpointParams: Record<string, string>;
    let masked: string[];

    beforeEach(() => {
        inputs = {};
        endpointParams = {};
        masked = [];
        t.getInput = (name: string) => inputs[name];
        t.getEndpointAuthorizationParameter = (_id: string, key: string) => endpointParams[key];
        t.setSecret = (v: string) => { masked.push(v); };
    });

    afterEach(() => {
        t.getInput = orig.getInput;
        t.getEndpointAuthorizationParameter = orig.getEndpointAuthorizationParameter;
        t.setSecret = orig.setSecret;
    });

    // The resolver is private; these drive it the way the task does.
    const resolve = (): string | undefined =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (new PackerCommandHandlerNone() as any).resolveGithubToken();

    it('falls back to the plain input when no connection is named', function () {
        inputs['githubToken'] = 'plain-token';
        assert.strictEqual(resolve(), 'plain-token');
    });

    it('returns undefined when neither the connection nor the input is set', function () {
        // Both are optional and "no token at all" is a valid configuration —
        // packer simply downloads plugins unauthenticated.
        assert.strictEqual(resolve(), undefined);
    });

    for (const spelling of ['accessToken', 'AccessToken'] as const) {
        it(`reads a connection token under the '${spelling}' spelling`, function () {
            inputs['githubServiceConnection'] = 'my-github';
            endpointParams[spelling] = `token-via-${spelling}`;
            assert.strictEqual(resolve(), `token-via-${spelling}`);
        });
    }

    it('prefers the connection over the plain input when both are set', function () {
        inputs['githubServiceConnection'] = 'my-github';
        inputs['githubToken'] = 'plain-token';
        endpointParams['accessToken'] = 'connection-token';
        assert.strictEqual(
            resolve(), 'connection-token',
            'the service-connection credential must win: it is the one the org rotates',
        );
    });

    it('masks a token read from the connection', function () {
        inputs['githubServiceConnection'] = 'my-github';
        endpointParams['AccessToken'] = 'secret-token';
        resolve();
        assert.ok(masked.includes('secret-token'),
            'the token becomes an environment variable read by a child process, so it must be registered as a secret');
    });

    it('FAILS CLOSED when a connection is named but yields no token', function () {
        // The whole reason the resolver throws rather than falling through: a
        // misconfigured connection would otherwise be indistinguishable from no
        // connection, and the build would silently rate-limit on plugin download
        // with nothing pointing back at the connection.
        inputs['githubServiceConnection'] = 'my-github';
        inputs['githubToken'] = 'plain-token';
        assert.throws(
            () => resolve(),
            /did not supply an access token/,
            'a named-but-empty connection must fail, not silently fall back to the plain input',
        );
    });
});
