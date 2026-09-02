// @shared-module: copied from azure-pipelines-terraform (Tasks/Markdown2Html/Markdown2HtmlV1/src/path-containment.ts)
// @shared-module-policy: Symlink-aware working-directory containment. Apply containment
//   fixes to BOTH repositories' copies. Enforced by scripts/check-shared-modules.js.
// @shared-module-status: IN-SYNC — brought to parity with the sibling on extraction (#113).
//   This logic previously lived inline in base-packer-command-handler.ts, where it was a
//   seventh copy of a module the other two extensions gate as a byte-identical family, and
//   invisible to every basename-keyed check precisely BECAUSE it was inline. It had missed
//   the sibling's root-separator fix as a result: with a working directory that resolves to
//   a filesystem root ("/" or a Windows drive root), `base + path.sep` becomes "//" and no
//   descendant can match it, so every legitimate path under that root was refused. That is
//   over-restrictive rather than permissive -- it rejected valid work, it did not let an
//   escape through -- but it is exactly the drift this file's extraction exists to expose.
import fs = require('fs');
import path = require('path');

/** realpath the deepest existing ancestor of `p`, re-appending any non-existent tail. */
function realpathOfExistingPrefix(p: string): string {
    let existing = p;
    const tail: string[] = [];
    while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing) return p; // hit the root with no existing ancestor
        tail.unshift(path.basename(existing));
        existing = parent;
    }
    return tail.length ? path.join(fs.realpathSync(existing), ...tail) : fs.realpathSync(existing);
}

/**
 * True when `resolvedPath` is workingDirectory itself or a descendant of it, with
 * symlinks resolved on both sides. A purely lexical check (path.resolve +
 * startsWith) is blind to an in-tree symlink -- one left by a checkout or a prior
 * build step -- whose lexical path stays under base but which points outside, so a
 * write could escape the working directory. Because a write target may not exist
 * yet, the deepest EXISTING ancestor is realpath'd and the not-yet-existent tail
 * (which cannot itself be a symlink) is re-appended.
 */
export function isWithinWorkingDirectory(resolvedPath: string, workingDirectory: string): boolean {
    const base = realpathOfExistingPrefix(path.resolve(workingDirectory || '.'));
    const target = realpathOfExistingPrefix(path.resolve(resolvedPath));
    // A base that is already a filesystem root (`C:\`, `/`) ends with the separator,
    // so appending another would make every descendant fail the prefix test.
    const prefix = base.endsWith(path.sep) ? base : base + path.sep;
    return target === base || target.startsWith(prefix);
}
