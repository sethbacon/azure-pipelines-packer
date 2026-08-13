import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import tasks = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerOCI } from '../src/oci-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';
import { EnvironmentVariableHelper } from '../src/environment-variables';
import { getSecureVarFileArgs, ISecureFileLoader } from '../src/secure-file-loader';

/**
 * CLASS TEST — "credential-bearing material reaches the build log in a form that
 * was never registered with tasks.setSecret() BEFORE the emission" (#185, #195,
 * #186, #193, #66).
 *
 * The five mechanisms are one defect class, so this is ONE table-driven suite
 * whose rows are the ENUMERATED SITES, not one test per reported call site:
 *
 *   M1  read-then-mask   — the value is logged by the read API itself
 *                          (tasks.getEndpointDataParameter debug-logs its result)
 *   M2  registration throws — setSecret() rejects CR/LF, so a whole-PEM
 *                          registration throws and registers NOTHING
 *   M3  wrong form registered — the emitted serialization (URL percent-encoding,
 *                          PEM normalization) differs byte-wise from the
 *                          registered one
 *   M4  never registered — secure var-file CONTENTS were never masked at all
 *   M5  credential-bearing URL — a pre-signed/userinfo URL is emitted before (or
 *                          without) its credential being registered/redacted
 *
 * Rows whose module lives in THIS npm package are exercised behaviourally.
 * Rows in the sibling PackerInstallerV1 package (a separate npm package that
 * cannot be imported from here) are asserted at source level against the same
 * predicate the re-runnable class signature uses: the guard construct must be
 * present, and the pre-fix defect shape must be absent. Inverting either guard
 * turns its own row RED.
 *
 * The re-runnable signature for this class (grep/node only) is documented in the
 * remediation run's FIX_REPORT; this suite is its in-repo, executable form.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const INSTALLER_SRC = path.join(REPO_ROOT, 'Tasks', 'PackerInstaller', 'PackerInstallerV1', 'src');
const TASK_SRC = path.join(REPO_ROOT, 'Tasks', 'PackerTask', 'PackerTaskV1', 'src');

function readSource(...segments: string[]): string {
    return fs.readFileSync(path.join(...segments), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * A source-level row: `guard` is the construct that closes the defect at this
 * site and `defect` is the pre-fix shape that must no longer be present. The
 * guard patterns deliberately encode the PREDICATE (not just the call), so an
 * inverted guard — `if (!url.password)`, a redaction helper dropped from an
 * interpolation, a registration moved back below its emission — fails to match
 * and the row goes RED.
 */
interface SourceSite {
    mechanism: 'M1' | 'M2' | 'M3' | 'M4' | 'M5';
    site: string;
    file: string;
    guard: RegExp;
    defect: RegExp;
}

const SOURCE_SITES: SourceSite[] = [
    {
        mechanism: 'M3',
        site: 'PackerInstallerV1/src/http-client.ts:buildFetchOptions',
        file: path.join(INSTALLER_SRC, 'http-client.ts'),
        // resolveProxy() returns EVERY spelling of the credential — the raw
        // password, the percent-encoded form url.toString() embeds, and any
        // userinfo already inside Agent.ProxyUrl. All of them must be registered
        // before the dispatcher that carries them is constructed.
        guard: /for \(const secret of resolved\.secrets\) \{\s*\n\s*tasks\.setSecret\(secret\);\s*\n\s*\}[\s\S]{0,400}?dispatcher: new ProxyAgent\(resolved\.proxyUrl\)/,
        defect: /if \(!resolved\) return \{\};\s*\n\s*return \{/,
    },
    {
        mechanism: 'M3',
        site: 'PackerTaskV1/src/proxy-config.ts:buildProxyFetchOptions',
        file: path.join(TASK_SRC, 'proxy-config.ts'),
        // The same defect class at the WIF token-request transport. This site was
        // not represented here before, so the masking it performs was unguarded.
        guard: /for \(const secret of resolved\.secrets\) \{\s*\n\s*tasks\.setSecret\(secret\);\s*\n\s*\}[\s\S]{0,400}?dispatcher: new ProxyAgent\(resolved\.proxyUrl\)/,
        defect: /if \(!resolved\) return \{\};\s*\n\s*return \{/,
    },
    {
        mechanism: 'M5',
        site: 'PackerInstallerV1/src/packer-installer.ts:downloadZipFromRegistry (pre-signed download_url)',
        file: path.join(INSTALLER_SRC, 'packer-installer.ts'),
        // Token registration must precede the https-pin rejection, and that
        // rejection must render the URL through redactUrl().
        guard: /const urlTokenSecrets = extractUrlTokenSecrets\(data\.download_url\);[\s\S]{0,400}?tasks\.setSecret\(secret\);[\s\S]{0,400}?if \(!data\.download_url\.startsWith\('https:\/\/'\)\) \{\s*\n\s*throw new Error\(tasks\.loc\("InsecureUrlRejected", redactUrl\(data\.download_url\)\)\);/,
        defect: /tasks\.loc\("InsecureUrlRejected", data\.download_url\)/,
    },
    {
        mechanism: 'M5',
        site: 'PackerInstallerV1/src/packer-installer.ts:getValidatedRegistryUrl (operator userinfo)',
        file: path.join(INSTALLER_SRC, 'packer-installer.ts'),
        guard: /function getValidatedRegistryUrl\(\): string \{[\s\S]{0,600}?maskOperatorUrlCredentials\(registryUrl\);[\s\S]{0,600}?tasks\.loc\("InsecureUrlRejected", redactUrlUserInfo\(registryUrl\)\)/,
        defect: /tasks\.loc\("InsecureUrlRejected", registryUrl\)/,
    },
    {
        mechanism: 'M5',
        site: 'PackerInstallerV1/src/packer-installer.ts:resolveVersionFromRegistry (operator userinfo)',
        file: path.join(INSTALLER_SRC, 'packer-installer.ts'),
        guard: /maskOperatorUrlCredentials\(registryUrl\);\s*\n\s*console\.log\(tasks\.loc\("ResolvingLatestFromRegistry", redactUrlUserInfo\(registryUrl\)\)\);/,
        defect: /console\.log\(tasks\.loc\("ResolvingLatestFromRegistry", registryUrl\)\)/,
    },
    {
        mechanism: 'M5',
        site: 'PackerInstallerV1/src/packer-installer.ts:downloadZipFromMirror (operator userinfo)',
        file: path.join(INSTALLER_SRC, 'packer-installer.ts'),
        guard: /maskOperatorUrlCredentials\(mirrorBaseUrl\);\s*\n\s*if \(!mirrorBaseUrl\.startsWith\('https:\/\/'\)\) \{\s*\n\s*throw new Error\(tasks\.loc\("InsecureUrlRejected", redactUrlUserInfo\(mirrorBaseUrl\)\)\);/,
        defect: /tasks\.loc\("InsecureUrlRejected", mirrorBaseUrl\)/,
    },
    {
        mechanism: 'M5',
        site: 'PackerInstallerV1/src/packer-installer.ts:downloadZipFromMirror (download failure message)',
        file: path.join(INSTALLER_SRC, 'packer-installer.ts'),
        guard: /tasks\.loc\("PackerDownloadFailed", redactUrlUserInfo\(downloadUrl\), exception\)/,
        // The ONE remaining raw `downloadUrl` failure message is the recorded
        // exemption below (downloadZipFromHashiCorp); a second one would mean a
        // credential-bearing URL regained a raw emission path.
        defect: /(tasks\.loc\("PackerDownloadFailed", downloadUrl, exception\)[\s\S]*){2,}/,
    },
    {
        mechanism: 'M5',
        site: 'PackerInstallerV1/src/packer-installer.ts:downloadZipFromHashiCorp (RECORDED EXEMPTION)',
        file: path.join(INSTALLER_SRC, 'packer-installer.ts'),
        // Exempt, and the exemption is asserted rather than asserted-away: this
        // path's downloadUrl comes from getHashiCorpDownloadUrl(), which builds it
        // from a hardcoded https://releases.hashicorp.com literal plus the
        // validated version/platform/arch. No operator input reaches it, so it can
        // carry neither userinfo nor a signing token. If that constant is ever
        // replaced by an input-derived value, this row goes RED and the site stops
        // being exempt.
        guard: /function getHashiCorpDownloadUrl\(version: string\): string \{\s*\n\s*return `https:\/\/releases\.hashicorp\.com\/packer\/\$\{version\}\/packer_\$\{version\}_\$\{getPlatformString\(\)\}_\$\{getArchString\(\)\}\.zip`;/,
        defect: /function getHashiCorpDownloadUrl\([\s\S]{0,300}?(getInput|registryUrl|mirrorBaseUrl)/,
    },
    {
        mechanism: 'M5',
        site: 'PackerInstallerV1/src/packer-installer.ts:downloadZipFromMirror (SHA256SUMS messages)',
        file: path.join(INSTALLER_SRC, 'packer-installer.ts'),
        // Every mirror checksum message inherits mirrorBaseUrl's userinfo through
        // sha256SumsUrl, so all of them render the redacted binding.
        guard: /const safeSha256SumsUrl = redactUrlUserInfo\(sha256SumsUrl\);/,
        // Only EMISSIONS matter: `${sha256SumsUrl}.sig` is a URL construction, not
        // a log line, so the defect shape is the raw URL inside a message.
        defect: /SHA256SUMS[^`\n]*\(\$\{sha256SumsUrl\}\)/,
    },
    {
        mechanism: 'M5',
        site: 'PackerInstallerV1/src/packer-installer.ts:downloadPacker (packerDownloadedFrom variable)',
        file: path.join(INSTALLER_SRC, 'packer-installer.ts'),
        guard: /tasks\.setVariable\('packerDownloadedFrom', `registry:\$\{redactUrlUserInfo\(registryUrl\)\}`\);[\s\S]{0,600}?tasks\.setVariable\('packerDownloadedFrom', `mirror:\$\{redactUrlUserInfo\(mirrorBaseUrl\)\}`\);/,
        defect: /packerDownloadedFrom', `(registry:\$\{registryUrl\}|mirror:\$\{mirrorBaseUrl\})`/,
    },
];

describe('Pre-mask defect class — credential emitted before it was registered as a secret', function () {
    this.timeout(15000);

    // ------------------------------------------------------------------ table
    describe('source-level rows (sibling PackerInstallerV1 npm package)', () => {
        for (const row of SOURCE_SITES) {
            it(`${row.mechanism} — ${row.site}`, () => {
                const source = readSource(row.file);
                assert.ok(
                    row.guard.test(source),
                    `guard missing or inverted at ${row.site}: ${row.guard}`,
                );
                assert.ok(
                    !row.defect.test(source),
                    `pre-fix defect shape is back at ${row.site}: ${row.defect}`,
                );
            });
        }
    });

    // ------------------------------------------------------- behavioural rows
    describe('behavioural rows (this npm package)', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monkeypatch the shared task-lib module
        const t = tasks as any;
        const orig = {
            setSecret: t.setSecret,
            debug: t.debug,
            warning: t.warning,
            getInput: t.getInput,
            getVariable: t.getVariable,
        };

        let setSecretCalls: string[] = [];
        let debugLines: string[] = [];
        let warnings: string[] = [];

        const PRIVATE_KEY_ENV = 'ENDPOINT_DATA_OCI_PRIVATEKEY';
        const OCI_DATA_ENV: Record<string, string> = {
            ENDPOINT_DATA_OCI_TENANCY: 'ocid1.tenancy.oc1..aaaaaaaaexampletenancyocid',
            ENDPOINT_DATA_OCI_USER: 'ocid1.user.oc1..aaaaaaaaexampleuserocid',
            ENDPOINT_DATA_OCI_REGION: 'us-ashburn-1',
            ENDPOINT_DATA_OCI_FINGERPRINT: 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99',
        };

        function multilinePem(): string {
            const { privateKey } = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            });
            return privateKey as string;
        }

        beforeEach(() => {
            setSecretCalls = [];
            debugLines = [];
            warnings = [];
            // Reproduce task-lib's real setSecret contract exactly: it THROWS on a
            // CR/LF-bearing value (LIB_MultilineSecret) rather than registering it.
            // That is what makes the M2 row mutation-provable.
            t.setSecret = (value: string) => {
                if (value && /\r|\n/.test(value)) {
                    throw new Error('LIB_MultilineSecret');
                }
                setSecretCalls.push(value);
            };
            t.debug = (message: string) => { debugLines.push(String(message)); };
            t.warning = (message: string) => { warnings.push(String(message)); };
            for (const [name, value] of Object.entries(OCI_DATA_ENV)) process.env[name] = value;
        });

        afterEach(() => {
            t.setSecret = orig.setSecret;
            t.debug = orig.debug;
            t.warning = orig.warning;
            t.getInput = orig.getInput;
            t.getVariable = orig.getVariable;
            delete process.env[PRIVATE_KEY_ENV];
            for (const name of Object.keys(OCI_DATA_ENV)) delete process.env[name];
            EnvironmentVariableHelper.clearTrackedVariables();
        });

        it('M1 — PackerTaskV1/src/oci-packer-command-handler.ts:handleProvider (OCI privateKey endpoint DATA param)', async () => {
            const pem = multilinePem();
            process.env[PRIVATE_KEY_ENV] = pem;

            const handler = new PackerCommandHandlerOCI();
            await handler.handleProvider(new PackerAuthorizationCommandInitializer('build', '', 'OCI'));

            // (a) The key must never have been emitted on a debug line. This is the
            //     whole of M1: tasks.getEndpointDataParameter() ends with
            //     debug(id + ' data ' + key + ' = ' + val), which fires at READ
            //     time — strictly before any setSecret the handler could make.
            const bodyLines = pem.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('-----'));
            assert.ok(bodyLines.length > 0, 'sanity: the fixture PEM has body lines');
            for (const line of bodyLines) {
                assert.ok(
                    !debugLines.some((d) => d.includes(line)),
                    'no ##vso[task.debug] line may contain the OCI private key body',
                );
            }

            // (b) The raw value must not survive in process.env: ENDPOINT_DATA_* is
            //     not vaulted by task-lib, so anything left there is inherited by
            //     the packer child process and every plugin binary it forks.
            assert.strictEqual(process.env[PRIVATE_KEY_ENV], undefined,
                'the ENDPOINT_DATA_* private key must be deleted from the environment once read');

            handler.cleanupTempFiles();
        });

        it('M2 — PackerTaskV1/src/oci-packer-command-handler.ts:writeKeyFile (genuine multi-line PEM)', async () => {
            // A service connection created via the REST API / az devops CLI (rather
            // than the UI passwordbox, which flattens newlines) delivers a real
            // multi-line PEM. A whole-value setSecret() throws on it — registering
            // NOTHING — so the handler must register line-wise.
            const pem = multilinePem();
            process.env[PRIVATE_KEY_ENV] = pem;

            const handler = new PackerCommandHandlerOCI();
            await handler.handleProvider(new PackerAuthorizationCommandInitializer('build', '', 'OCI'));

            const rawLines = pem.split('\n').map((l) => l.trim()).filter((l) => l);
            for (const line of rawLines) {
                assert.ok(setSecretCalls.includes(line),
                    `raw PEM line must be registered: ${line.slice(0, 12)}...`);
            }

            // M3 in its PEM guise: normalizePem rewrites the key to a byte-different
            // on-disk form, which needs its own registration.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tempFiles: string[] = (handler as any).tempFiles;
            assert.strictEqual(tempFiles.length, 1, 'exactly one tracked temp file: the OCI key');
            const onDisk = fs.readFileSync(tempFiles[0], 'utf8');
            const onDiskBody = onDisk.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('-----'));
            assert.ok(onDiskBody.length > 0, 'sanity: the normalized PEM has body lines');
            for (const line of onDiskBody) {
                assert.ok(setSecretCalls.includes(line),
                    `normalized on-disk PEM body line must be registered: ${line.slice(0, 12)}...`);
            }

            handler.cleanupTempFiles();
        });

        it('M4 — PackerTaskV1/src/secure-file-loader.ts:getSecureVarFileArgs (secure var-file contents)', async () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premask-class-'));
            const varFile = path.join(dir, 'secrets.pkrvars.hcl');
            const hclSecret = 'sup3r-s3cret-value-from-hcl';
            const jsonSecret = 'sup3r-s3cret-value-from-json';
            fs.writeFileSync(varFile, [
                '# a comment mentioning "not-a-secret-comment-token"',
                `api_token = "${hclSecret}"`,
                'replica_count = 3',
                'flags = ["alpha-flag", "beta-flag"]',
            ].join('\n'));

            const jsonFile = path.join(dir, 'secrets.pkrvars.json');
            fs.writeFileSync(jsonFile, JSON.stringify({ nested: { api_token: jsonSecret }, count: 3 }));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (tasks as any).getInput = (name: string) => (name === 'secureVarsFile' ? 'secure-file-id' : undefined);

            const loaderFor = (filePath: string): ISecureFileLoader => ({
                downloadSecureFile: async () => filePath,
                deleteSecureFile: () => { /* cleanup is elsewhere */ },
            });

            const hclResult = await getSecureVarFileArgs(loaderFor(varFile));
            assert.strictEqual(hclResult?.varFileArg, `-var-file=${varFile}`);
            assert.ok(setSecretCalls.includes(hclSecret),
                'an HCL secure var-file value must be registered with the masker');
            assert.ok(setSecretCalls.includes('alpha-flag'),
                'list elements of a secure var-file value must be registered too');
            assert.ok(!setSecretCalls.includes('not-a-secret-comment-token'),
                'a quoted word inside a comment must not be registered (over-masking guard)');

            setSecretCalls = [];
            const jsonResult = await getSecureVarFileArgs(loaderFor(jsonFile));
            assert.strictEqual(jsonResult?.varFileArg, `-var-file=${jsonFile}`);
            assert.ok(setSecretCalls.includes(jsonSecret),
                'a nested JSON secure var-file value must be registered with the masker');

            // Best-effort contract: an unreadable file warns, it does not throw.
            setSecretCalls = [];
            const missing = path.join(dir, 'does-not-exist.pkrvars.hcl');
            await getSecureVarFileArgs(loaderFor(missing));
            assert.ok(warnings.some((w) => w.includes('mask')),
                'an unreadable secure var file must warn rather than fail the task');

            fs.rmSync(dir, { recursive: true, force: true });
        });
    });
});
