import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isWithinWorkingDirectory } from '../src/path-containment';

/**
 * Direct unit tests for the symlink-aware containment guard (#113).
 *
 * This logic previously lived inline in base-packer-command-handler.ts and had
 * NO direct test -- it was exercised only indirectly, through command fixtures
 * that happened to traverse it. Extracting it to a module is what makes these
 * possible, and the root-separator row below is the case the inline copy got
 * wrong for as long as it existed.
 */
describe('path containment', function () {
    let tmpRoot: string;

    before(function () {
        tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'packer-containment-')));
    });

    after(function () {
        try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('accepts the working directory itself', function () {
        assert.strictEqual(isWithinWorkingDirectory(tmpRoot, tmpRoot), true);
    });

    it('accepts a descendant', function () {
        const child = path.join(tmpRoot, 'sub', 'file.txt');
        assert.strictEqual(isWithinWorkingDirectory(child, tmpRoot), true);
    });

    it('accepts a not-yet-existent target under the working directory', function () {
        // The write case: the deepest EXISTING ancestor is realpath'd and the
        // absent tail re-appended, because a tail that does not exist cannot
        // itself be a symlink.
        const future = path.join(tmpRoot, 'does', 'not', 'exist', 'out.json');
        assert.strictEqual(isWithinWorkingDirectory(future, tmpRoot), true);
    });

    it('rejects a sibling directory', function () {
        assert.strictEqual(isWithinWorkingDirectory(path.join(tmpRoot, '..', 'elsewhere'), tmpRoot), false);
    });

    it('rejects a path that only LEXICALLY looks contained (prefix, not descendant)', function () {
        // `<root>-evil` starts with `<root>` as a string but is not under it.
        // This is what the trailing-separator comparison exists to stop.
        assert.strictEqual(isWithinWorkingDirectory(tmpRoot + '-evil', tmpRoot), false);
    });

    it('rejects an in-tree symlink pointing outside the working directory', function () {
        // The whole reason this is realpath-based rather than lexical: the link's
        // lexical path stays under base while its target does not.
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'packer-outside-'));
        const link = path.join(tmpRoot, 'escape');
        try {
            fs.symlinkSync(outside, link, 'dir');
        } catch {
            this.skip(); // symlink creation is not permitted (e.g. Windows without privilege)
            return;
        }
        try {
            assert.strictEqual(isWithinWorkingDirectory(path.join(link, 'loot'), tmpRoot), false);
        } finally {
            try { fs.rmSync(link, { force: true }); } catch { /* best effort */ }
            try { fs.rmSync(outside, { recursive: true, force: true }); } catch { /* best effort */ }
        }
    });

    it('accepts a descendant when the working directory IS a filesystem root', function () {
        // THE REGRESSION ROW. The inline copy this module replaced computed the
        // prefix as `base + path.sep` unconditionally, so a base of "/" became
        // "//" and no descendant could match it -- every legitimate path under a
        // root working directory was refused. Over-restrictive rather than
        // permissive: it rejected valid work, it did not let an escape through.
        // The sibling extensions fixed this; packer's inline copy never got it,
        // because being inline made it invisible to every basename-keyed gate.
        const root = path.parse(tmpRoot).root;
        assert.strictEqual(
            isWithinWorkingDirectory(tmpRoot, root),
            true,
            `a path under the filesystem root ${root} must be contained by it`,
        );
    });

    it('treats an empty working directory as the current directory', function () {
        const here = fs.realpathSync(process.cwd());
        assert.strictEqual(isWithinWorkingDirectory(path.join(here, 'x'), ''), true);
        assert.strictEqual(isWithinWorkingDirectory(path.join(here, '..'), ''), false);
    });
});
