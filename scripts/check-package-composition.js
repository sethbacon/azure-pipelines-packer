#!/usr/bin/env node
'use strict'

// CI gate: "if we composed the .vsix right now, would it be correct?"
//
// It answers that WITHOUT building anything, because there is no workflow that
// builds or publishes a .vsix today — `package:*` and `build:release` exist in
// package.json and nothing in .github/ invokes them. A composition check bolted
// to a publish job would therefore never run. This one is a plain static read of
// the tree plus the manifest, wired into the existing required `Check Version
// Consistency` job so it blocks merges from the day it lands.
//
// It shares scripts/lib/package-contents.js and scripts/lib/task-dirs.js with
// scripts/copy-build.js, so the gate and the packager cannot disagree about the
// same file. That disagreement — copy-build.js recursing all of Tasks/ while
// every gate enumerated exactly two levels — is issue #37.
//
// What it enforces:
//   1. Tasks/ layout      — nothing under Tasks/ outside a canonical
//                           Tasks/<Family>/<TaskDir>, and no task.json at a
//                           depth the gates do not enumerate            (#37)
//   2. no symlinks        — anywhere that would be composed              (#40)
//   3. allowlist          — every composed path is classified SHIP; an
//                           unrecognised one fails loudly rather than being
//                           silently included or silently dropped        (#41)
//   4. manifest assets    — content.details / content.license / icons.* and
//                           every files[] entry must EXIST and must actually be
//                           copied into build/                     (#42, #46)
//   5. files/contributions— bidirectional against the Tasks/ tree    (#47, #29)
//
// Version agreement between azure-devops-extension.json and
// .release-please-manifest.json lives in check-versions.js, next to the other
// version invariants (#29).

const fs = require('node:fs')
const path = require('node:path')

const { discoverTaskDirs, walkTree, insideTaskDir, ancestorOfTaskDir, toPosix } = require('./lib/task-dirs.js')
const contents = require('./lib/package-contents.js')

const root = path.join(__dirname, '..')
const errors = []
const notes = []

function fail(message) {
  errors.push(message)
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}

function isFile(rel) {
  const abs = path.join(root, rel)
  return fs.existsSync(abs) && fs.lstatSync(abs).isFile()
}

// ── 1 + 2 + 3: the Tasks/ tree ───────────────────────────────────────────────

const taskDirs = discoverTaskDirs(root)
const tasksEntries = walkTree(root, 'Tasks', (rel) => !contents.directoryDropped(rel))

let bundlesDependencies = false

for (const entry of tasksEntries) {
  const { rel, kind } = entry

  // Directories that only exist to hold a canonical task dir are fine.
  const isTaskDirAncestor = ancestorOfTaskDir(rel, taskDirs) || taskDirs.includes(rel)
  const inTask = insideTaskDir(rel, taskDirs)

  if (kind === 'symlink') {
    // #40. A symlink dirent is neither isFile() nor isDirectory(), which is how
    // the old copy-build.js skipped every exclusion for it and then handed it to
    // copyFileSync — which follows the link and copies the TARGET's bytes. A
    // tracked `notes.md -> /etc/hostname`, or -> ~/.npmrc, becomes a real file
    // in a Marketplace-published artifact. Refuse them at review time.
    fail(`${rel}: symlink under Tasks/ — composition would dereference it and package the target's contents; symlinks may not be packaged`)
    continue
  }

  if (kind === 'other') {
    fail(`${rel}: not a regular file or directory — refusing to package it`)
    continue
  }

  // #37, the reciprocal assertion, stated as the audit stated it: walk Tasks/
  // recursively and fail if a task.json exists at ANY path the two-level walk
  // did not return. That covers one nested inside an otherwise-valid task
  // directory as well as one at Tasks/<a>/<b>/<c>/ — neither is enumerated, and
  // both are packaged.
  if (kind === 'file' && path.basename(rel) === 'task.json' && !taskDirs.includes(path.posix.dirname(rel))) {
    fail(
      `${rel}: task.json at a path the gates do not enumerate — tasks are Tasks/<Family>/<TaskDir>/task.json (exactly two directory levels). ` +
        `A task here is never version-checked, never compiled, never tested, and would still be packaged`,
    )
    continue
  }

  if (!inTask && !isTaskDirAncestor) {
    const verdict = contents.classify(rel)
    if (verdict.verdict === contents.DROP) {
      // Shared dev-only files at the Tasks/ root (tsconfig.base.json,
      // eslint.base.mjs in the sibling extensions) are allowed to exist because
      // they are never composed.
      continue
    }
    if (kind === 'dir') continue // an empty or not-yet-populated directory; its contents are judged individually
    fail(
      `${rel}: outside every canonical task directory (${taskDirs.length === 0 ? 'there are none' : taskDirs.join(', ')}) ` +
        `and not a dev-only file — the packager would ship it and no gate would ever look at it`,
    )
    continue
  }

  if (kind === 'dir') continue

  const verdict = contents.classify(rel)
  if (verdict.verdict === contents.NEVER_SHIP) {
    fail(`${rel}: ${verdict.why} — ${contents.NEVER_SHIP_ADVICE}`)
  } else if (verdict.verdict === contents.UNKNOWN) {
    fail(`${rel}: ${verdict.why} — ${contents.UNKNOWN_ADVICE}`)
  } else if (verdict.verdict === contents.SHIP && contents.inNodeModules(rel)) {
    bundlesDependencies = true
  }
}

// ── 2 + 3 again: images/ and the root assets ─────────────────────────────────

for (const dir of contents.ROOT_DIRS) {
  for (const entry of walkTree(root, dir, (rel) => !contents.directoryDropped(rel))) {
    if (entry.kind === 'symlink') {
      fail(`${entry.rel}: symlink under ${dir}/ — composition would dereference it and package the target's contents; symlinks may not be packaged`)
      continue
    }
    if (entry.kind !== 'file') continue
    const verdict = contents.classify(entry.rel)
    if (verdict.verdict === contents.NEVER_SHIP) {
      fail(`${entry.rel}: ${verdict.why} — ${contents.NEVER_SHIP_ADVICE}`)
    } else if (verdict.verdict === contents.UNKNOWN) {
      fail(`${entry.rel}: ${verdict.why} — ${contents.UNKNOWN_ADVICE}`)
    }
  }
}

for (const asset of contents.ROOT_ASSETS) {
  const abs = path.join(root, asset.name)
  if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) {
    fail(`${asset.name}: symlink — composition would dereference it and package the target's contents; symlinks may not be packaged`)
    continue
  }
  const required = asset.required || (asset.requiredWhenBundling && bundlesDependencies)
  if (!fs.existsSync(abs)) {
    if (required) {
      const because = asset.required ? asset.why : `${asset.why} (required now that a task bundles node_modules)`
      fail(`${asset.name}: missing — ${because}. copy-build.js used to skip it silently and report success`)
    } else {
      notes.push(`${asset.name}: absent and not yet required (${asset.why})`)
    }
  }
}

// ── 4 + 5: the manifest ──────────────────────────────────────────────────────

const manifestName = 'azure-devops-extension.json'
let manifest = null
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, manifestName), 'utf8'))
} catch (err) {
  fail(`${manifestName}: not readable as JSON — ${err.message}`)
}

/**
 * Would `rel` end up inside the composed package? Existing in the repository is
 * not the same question: a manifest that points at docs/overview.md names a file
 * that is really there and that tfx will never find in ./build.
 */
function composedLocation(rel) {
  if (contents.ROOT_ASSETS.some((a) => a.name === rel)) return 'root asset'
  if (contents.ROOT_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) return 'root directory'
  if (rel === 'Tasks' || rel.startsWith('Tasks/')) {
    return insideTaskDir(rel, taskDirs) || ancestorOfTaskDir(rel, taskDirs) || taskDirs.includes(rel)
      ? 'task tree'
      : null
  }
  return null
}

function checkManifestPath(label, value) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${manifestName}: ${label} must be a non-empty path, got ${JSON.stringify(value)}`)
    return
  }
  const rel = toPosix(path.normalize(value))
  if (path.isAbsolute(value) || rel.startsWith('..')) {
    fail(`${manifestName}: ${label} = ${JSON.stringify(value)} must be a repo-relative path inside the package root`)
    return
  }
  if (!exists(rel)) {
    fail(
      `${manifestName}: ${label} = ${JSON.stringify(value)} does not exist — ` +
        `copy-build.js would omit it silently and tfx would package a manifest pointing at nothing`,
    )
    return
  }
  const where = composedLocation(rel)
  if (where === null) {
    fail(
      `${manifestName}: ${label} = ${JSON.stringify(value)} exists in the repository but is not copied into build/ — ` +
        `add it to ROOT_ASSETS/ROOT_DIRS in scripts/lib/package-contents.js or move it somewhere the packager copies`,
    )
    return
  }
  if (isFile(rel)) {
    const verdict = contents.classify(rel)
    if (verdict.verdict !== contents.SHIP) {
      fail(
        `${manifestName}: ${label} = ${JSON.stringify(value)} is classified '${verdict.verdict}' by ` +
          `scripts/lib/package-contents.js (${verdict.why}) — the manifest references a file the packager will not ship`,
      )
    }
  }
}

if (manifest) {
  const content = manifest.content || {}
  checkManifestPath('content.details.path', content.details && content.details.path)
  checkManifestPath('content.license.path', content.license && content.license.path)

  const icons = manifest.icons || {}
  for (const key of Object.keys(icons)) {
    checkManifestPath(`icons.${key}`, icons[key])
  }
  if (!icons.default) {
    fail(`${manifestName}: icons.default is required — a Marketplace listing without an icon is a broken listing`)
  }

  // files[] — every entry must resolve and be composed; every task must be covered.
  const files = Array.isArray(manifest.files) ? manifest.files : []
  if (!Array.isArray(manifest.files)) {
    fail(`${manifestName}: files must be an array`)
  }
  const filePaths = []
  for (const [index, entry] of files.entries()) {
    const value = entry && entry.path
    if (typeof value !== 'string' || value.length === 0) {
      fail(`${manifestName}: files[${index}].path must be a non-empty path, got ${JSON.stringify(value)}`)
      continue
    }
    const rel = toPosix(path.normalize(value))
    filePaths.push(rel)
    if (!exists(rel)) {
      fail(`${manifestName}: files[${index}].path = ${JSON.stringify(value)} does not exist — tfx would package nothing for it`)
      continue
    }
    if (composedLocation(rel) === null) {
      fail(`${manifestName}: files[${index}].path = ${JSON.stringify(value)} is not copied into build/ by scripts/copy-build.js`)
      continue
    }
    if (rel === 'Tasks' || rel.startsWith('Tasks/')) {
      const covered = taskDirs.filter((dir) => dir === rel || dir.startsWith(`${rel}/`))
      if (covered.length === 0) {
        fail(`${manifestName}: files[${index}].path = ${JSON.stringify(value)} contains no task directory — it declares an empty shipment`)
      }
    }
  }

  // contributions[] — the task contributions must name real task dirs, and every
  // task dir must have one. A task that compiles, tests and version-checks
  // cleanly still installs as nothing without this (#47).
  const contributions = Array.isArray(manifest.contributions) ? manifest.contributions : []
  if (!Array.isArray(manifest.contributions)) {
    fail(`${manifestName}: contributions must be an array`)
  }
  const TASK_CONTRIBUTION = 'ms.vss-distributed-task.task'
  const contributed = new Set()
  for (const [index, contribution] of contributions.entries()) {
    if (!contribution || contribution.type !== TASK_CONTRIBUTION) continue
    const name = contribution.properties && contribution.properties.name
    if (typeof name !== 'string' || name.length === 0) {
      fail(`${manifestName}: contributions[${index}].properties.name must name a task directory, got ${JSON.stringify(name)}`)
      continue
    }
    const rel = toPosix(path.normalize(name))
    if (!taskDirs.includes(rel)) {
      fail(
        `${manifestName}: contributions[${index}].properties.name = ${JSON.stringify(name)} is not a task directory ` +
          `(${taskDirs.length === 0 ? 'there are none' : taskDirs.join(', ')}) — the contribution declares a task with nothing behind it`,
      )
      continue
    }
    contributed.add(rel)
  }

  for (const dir of taskDirs) {
    if (!contributed.has(dir)) {
      fail(
        `${dir}: no '${TASK_CONTRIBUTION}' contribution in ${manifestName} names it — ` +
          `the task would compile, test and version-check cleanly and still be invisible in the pipeline task picker`,
      )
    }
    const shipped = filePaths.some((rel) => rel === dir || dir.startsWith(`${rel}/`))
    if (!shipped) {
      fail(
        `${dir}: no files[] entry in ${manifestName} covers it — tfx packages what files[] lists, so the task would ` +
          `be declared by a contribution and absent from the .vsix`,
      )
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────

for (const note of notes) console.log(`  note: ${note}`)

if (errors.length > 0) {
  console.error('Package composition check failed:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(
  `Package composition check passed (${taskDirs.length} task(s), ${tasksEntries.length} path(s) under Tasks/, ` +
    `${contents.ROOT_ASSETS.filter((a) => exists(a.name)).length}/${contents.ROOT_ASSETS.length} root assets present).`,
)
