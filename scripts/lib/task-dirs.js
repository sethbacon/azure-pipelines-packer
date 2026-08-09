// Single source of truth for "what are the task directories?".
//
// Ported from the sibling azure-pipelines-terraform repo (scripts/lib/task-dirs.js,
// its issue #502) so the Minor-bump and enforced-discipline gates DERIVE the task
// list from disk instead of hand-maintaining it: a task added under Tasks/ is
// picked up automatically and cannot be forgotten. scripts/check-versions.js keeps
// its own explicit list because it also pins non-task manifests
// (azure-devops-extension.json).
//
// Ground truth: every immediate subdirectory of Tasks/<Family>/ that contains a
// task.json, returned as sorted repo-relative 'Tasks/<Family>/<Version>' paths.

const fs = require('fs');
const path = require('path');

// `root` is the repo root to scan (the directory that contains Tasks/). Callers
// pass process.cwd() when they operate relative to the invocation directory
// (check-minor-bumps.js — mirroring its git calls) or their own resolved root.
function discoverTaskDirs(root) {
    const dirs = [];
    const familyRoot = path.join(root, 'Tasks');
    if (!fs.existsSync(familyRoot)) {
        return dirs;
    }
    for (const family of fs.readdirSync(familyRoot, { withFileTypes: true })) {
        if (!family.isDirectory()) continue;
        const familyPath = path.join(familyRoot, family.name);
        for (const version of fs.readdirSync(familyPath, { withFileTypes: true })) {
            if (!version.isDirectory()) continue;
            const taskJson = path.join(familyPath, version.name, 'task.json');
            if (fs.existsSync(taskJson)) {
                dirs.push(`Tasks/${family.name}/${version.name}`);
            }
        }
    }
    return dirs.sort();
}

module.exports = { discoverTaskDirs };
