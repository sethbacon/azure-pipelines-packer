import tl = require('azure-pipelines-task-lib/task');
import * as fs from 'fs';
import * as path from 'path';
import { PackerCommandHandlerOCI } from '../src/oci-packer-command-handler';
import { PackerAuthorizationCommandInitializer } from '../src/packer-commands';

/**
 * Entry point for the OCI WIF mock-run fixtures. generateIdToken is replaced by
 * the fixture; the UPST exchange runs for real against a stubbed global fetch
 * set up below, so the realm validation, redirect refusal and JSON handling in
 * @4cloudguru/pipeline-task-ado are all exercised rather than mocked away.
 */
async function run(): Promise<void> {
    const fetchCalls: string[] = [];
    globalThis.fetch = (async (url: string) => {
        fetchCalls.push(String(url));
        return new Response(JSON.stringify({ access_token: 'mock-upst-token-67890' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }) as unknown as typeof globalThis.fetch;

    const handler = new PackerCommandHandlerOCI();
    const command = new PackerAuthorizationCommandInitializer('build', '', 'OCI');

    try {
        await handler.handleProvider(command);
    } catch (error) {
        // A rejecting fixture asserts on this message. Report whether the token
        // exchange was ever reached, so a fixture testing "the JWT never left"
        // can prove it rather than inferring it from the failure alone.
        console.log(`OciWifAuthL0 fetchCalls=${fetchCalls.length}`);
        handler.cleanupTempFiles();
        tl.setResult(tl.TaskResult.Failed, String(error));
        return;
    }

    try {
        const tempFiles: string[] = (handler as any).tempFiles;
        const configPath = tempFiles.find((p) => path.basename(p).startsWith('oci-wif-config'));
        const keyPath = tempFiles.find((p) => path.basename(p).startsWith('oci-wif-key'));
        const upstPath = tempFiles.find((p) => path.basename(p).startsWith('oci-wif-upst'));

        const ok =
            !!configPath && fs.existsSync(configPath) &&
            !!keyPath && fs.existsSync(keyPath) &&
            !!upstPath && fs.existsSync(upstPath) &&
            fs.readFileSync(upstPath, 'utf8') === 'mock-upst-token-67890' &&
            // The config the plugin will actually read must name the session token.
            fs.readFileSync(configPath, 'utf8').includes(`security_token_file=${upstPath}`) &&
            // Delivered as a -var, so a template that never declared the variable
            // fails loudly instead of silently ignoring the credential.
            (handler as any).providerVarArgs.includes(`oci_access_cfg_file=${configPath}`) &&
            process.env['PKR_VAR_oci_access_cfg_file'] === configPath &&
            // Every API-key selector must be absent, or the raw configuration
            // provider answers first and the session token is never consulted.
            process.env['PKR_VAR_oci_user_ocid'] === undefined &&
            process.env['PKR_VAR_oci_key_file'] === undefined &&
            process.env['PKR_VAR_oci_fingerprint'] === undefined;

        if (ok) {
            console.log('OciWifAuthL0 should have succeeded.');
            tl.setResult(tl.TaskResult.Succeeded, 'ok');
        } else {
            tl.setResult(
                tl.TaskResult.Failed,
                `OCI WIF env/file assertions failed. config=${configPath} key=${keyPath} upst=${upstPath} ` +
                `vars=${JSON.stringify((handler as any).providerVarArgs)}`,
            );
        }
    } finally {
        handler.cleanupTempFiles();
    }
}

run();
