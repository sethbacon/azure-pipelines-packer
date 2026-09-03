// Shared floor + resolved-copy check for capabilities this repo delegated into
// @4cloudguru/pipeline-task-* (#399).
//
// Two gates need the SAME question answered about different sinks:
// check-proxy-parity.js for the network delegations, check-artifact-trust.js for
// the cryptographic one. Duplicating it would have been the third copy of a
// version check whose whole purpose is catching copies that drift apart.
//
// The check is two-part on purpose, and the second part is the one that bites:
// a declared floor only vouches for the WIRING, not for which implementation it
// wires up. ado@0.2.0 once declared core ^0.3.1 while the tasks declared ^0.5.0
// -- caret on a 0.x version is patch-only, so the ranges were disjoint, npm
// nested a second copy, and the delegated code ran the older one while BOTH
// floors passed. Hence installedCopies() and the length !== 1 rejection.

// `ROOT` is threaded explicitly rather than read from a caller's module scope:
// these helpers walk UPWARD from a source file looking for the owning
// package.json, and they need to know where to stop.
const fs = require('fs');
const path = require('path');

function declaredDependency(file, pkg, ROOT) {
    let dir = path.dirname(path.resolve(file));
    // The walk stops at the tree being ANALYSED, which is ROOT (argv), not at
    // this file's own parent. Those are the same path while the gate lives in
    // scripts/ of the repo it analyses, so this changes nothing today -- and it
    // is what lets the gate be resolved from one canonical copy elsewhere. With
    // __dirname the boundary followed the SCRIPT, so a moved gate stopped
    // resolving declared dependencies and reported correctly-proxied call sites
    // as findings (measured: 4 in packer, 14 in terraform, 1 in release-docs).
    const stop = ROOT;
    while (dir.startsWith(stop)) {
        const manifest = path.join(dir, 'package.json');
        if (fs.existsSync(manifest)) {
            try {
                const json = JSON.parse(fs.readFileSync(manifest, 'utf8'));
                const range = (json.dependencies || {})[pkg];
                if (range) return range;
            } catch {
                return null;
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function satisfiesFloor(range, min) {
    const parsed = /^\^?(\d+)\.(\d+)\.(\d+)/.exec(String(range).trim());
    if (!parsed) return false;
    const floor = min.split('.').map(Number);
    const actual = parsed.slice(1).map(Number);
    for (let i = 0; i < 3; i += 1) {
        if (actual[i] > floor[i]) return true;
        if (actual[i] < floor[i]) return false;
    }
    return true;
}

function lockfileFor(file, ROOT) {
    let dir = path.dirname(path.resolve(file));
    // The walk stops at the tree being ANALYSED, which is ROOT (argv), not at
    // this file's own parent. Those are the same path while the gate lives in
    // scripts/ of the repo it analyses, so this changes nothing today -- and it
    // is what lets the gate be resolved from one canonical copy elsewhere. With
    // __dirname the boundary followed the SCRIPT, so a moved gate stopped
    // resolving declared dependencies and reported correctly-proxied call sites
    // as findings (measured: 4 in packer, 14 in terraform, 1 in release-docs).
    const stop = ROOT;
    while (dir.startsWith(stop)) {
        const lock = path.join(dir, 'package-lock.json');
        if (fs.existsSync(lock)) return lock;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function installedCopies(file, dep, ROOT) {
    const lock = lockfileFor(file, ROOT);
    if (!lock) return null;
    let json;
    try {
        json = JSON.parse(fs.readFileSync(lock, 'utf8'));
    } catch {
        return null;
    }
    const suffix = `node_modules/${dep}`;
    return Object.entries(json.packages || {})
        .filter(([key]) => key === suffix || key.endsWith(`/${suffix}`))
        .map(([key, value]) => ({ path: key, version: value && value.version }));
}

function packageDelegationVerdict(file, { pkg, min, carries, capability = 'this capability', provides = 'the delegated implementation' }, ROOT) {
    const declared = declaredDependency(file, pkg, ROOT);
    if (declared === null || !satisfiesFloor(declared, min)) {
        return { ok: false, why: `delegates ${capability} to ${pkg}, but the owning task declares ${declared ?? 'no dependency on it'} (floor ${min})` };
    }
    if (!carries) {
        return { ok: true, why: `${provides} comes from ${pkg}@${declared} (floor ${min})` };
    }

    const copies = installedCopies(file, carries.pkg, ROOT);
    if (copies === null) {
        return { ok: false, why: `${pkg}@${declared} delegates onward to ${carries.pkg}, but no lockfile was readable to show which copy is installed` };
    }
    if (copies.length !== 1) {
        const seen = copies.map((c) => `${c.version} at ${c.path}`).join(', ') || 'none';
        return { ok: false, why: `${pkg}@${declared} delegates onward to ${carries.pkg}, which resolves to ${copies.length} copies (${seen}) — the delegated call runs whichever one is nested, not the one this task imports` };
    }
    if (!satisfiesFloor(copies[0].version, carries.min)) {
        return { ok: false, why: `${pkg}@${declared} delegates onward to ${carries.pkg}@${copies[0].version}, below the ${carries.min} floor` };
    }
    return { ok: true, why: `${provides} comes from ${pkg}@${declared} (floor ${min}), resolving a single ${carries.pkg}@${copies[0].version} (floor ${carries.min})` };
}

module.exports = { packageDelegationVerdict, declaredDependency, satisfiesFloor, installedCopies };
