#!/usr/bin/env node
// Copies the compiled task tree and packaging assets into ./build so tfx can
// produce the .vsix. TypeScript sources, test folders, and tsconfig/eslint
// files are excluded — only the runtime .js and task manifests ship.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');

/** Returns true if a path under Tasks/ should be excluded from the bundle. */
function isExcludedTaskPath(srcPath) {
    const rel = path.relative(root, srcPath).split(path.sep).join('/');
    if (/(^|\/)Tests(\/|$)/.test(rel)) return true;
    if (/\.ts$/.test(rel)) return true;
    if (/(^|\/)tsconfig.*\.json$/.test(rel)) return true;
    if (/(^|\/)tsconfig\.tsbuildinfo$/.test(rel)) return true;
    if (/(^|\/)eslint\.config\.mjs$/.test(rel)) return true;
    return false;
}

function copyFile(src, dst) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
}

// Copy the Tasks tree with the runtime filter applied.
fs.cpSync(path.join(root, 'Tasks'), path.join(buildDir, 'Tasks'), {
    recursive: true,
    filter: (src) => {
        if (fs.statSync(src).isDirectory()) {
            const rel = path.relative(root, src).split(path.sep).join('/');
            return !/(^|\/)Tests$/.test(rel);
        }
        return !isExcludedTaskPath(src);
    },
});

// Copy top-level packaging assets.
copyFile(path.join(root, 'azure-devops-extension.json'), path.join(buildDir, 'azure-devops-extension.json'));
copyFile(path.join(root, 'overview.md'), path.join(buildDir, 'overview.md'));
copyFile(path.join(root, 'LICENSE'), path.join(buildDir, 'LICENSE'));
copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(buildDir, 'THIRD_PARTY_NOTICES.md'));
fs.cpSync(path.join(root, 'images'), path.join(buildDir, 'images'), { recursive: true });

console.log('Copied build assets to ./build');
