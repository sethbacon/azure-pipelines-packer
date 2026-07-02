import * as assert from 'assert';
import tasks = require('azure-pipelines-task-lib/task');
import { getSecureVarFileArgs, ISecureFileLoader } from '../src/secure-file-loader';

/**
 * Direct unit tests for the secureVarsFile -> -var-file path (#80). Uses the
 * injectable ISecureFileLoader so no securefiles-common / agent state is touched;
 * tasks.getInput is stubbed so the test controls the secureVarsFile input.
 */
describe('getSecureVarFileArgs — secure var-file resolution', function () {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monkeypatch the shared task-lib module
    const t = tasks as any;
    const origGetInput = t.getInput;
    let secureVarsFileInput: string | undefined;

    beforeEach(() => {
        t.getInput = (name: string) => (name === 'secureVarsFile' ? secureVarsFileInput : undefined);
    });

    afterEach(() => {
        t.getInput = origGetInput;
    });

    it('returns null when no secureVarsFile input is set', async () => {
        secureVarsFileInput = undefined;
        const result = await getSecureVarFileArgs({
            downloadSecureFile: async () => { throw new Error('should not download'); },
            deleteSecureFile: () => { throw new Error('should not delete'); }
        });
        assert.strictEqual(result, null);
    });

    it('downloads the secure file and returns a -var-file arg for its path', async () => {
        secureVarsFileInput = 'secure-file-id-123';
        let downloadedId: string | null = null;
        const loader: ISecureFileLoader = {
            downloadSecureFile: async (id: string) => { downloadedId = id; return '/tmp/agent/downloaded.pkrvars.hcl'; },
            deleteSecureFile: () => { /* cleanup happens elsewhere */ }
        };
        const result = await getSecureVarFileArgs(loader);
        assert.strictEqual(downloadedId, 'secure-file-id-123', 'the configured secure file id should be downloaded');
        assert.deepStrictEqual(result, {
            varFileArg: '-var-file=/tmp/agent/downloaded.pkrvars.hcl',
            secureFileId: 'secure-file-id-123'
        });
    });
});
