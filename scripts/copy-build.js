#!/usr/bin/env node
'use strict'

// Assembles ./build — the root tfx packages the .vsix from.
//
// Composition is an ALLOWLIST and it FAILS CLOSED. It used to be a denylist of
// five names plus `*.ts`, which meant everything nobody had thought about
// defaulted into a Marketplace-published artifact; the reasoning for the
// inversion, and what it costs, is written out in scripts/lib/package-contents.js.
//
// Three properties this script now has that it did not:
//
//   1. It copies only the task directories scripts/lib/task-dirs.js enumerates —
//      the same enumeration check-versions.js and for-each-task.js use. The
//      packager and the gates can no longer hold different opinions about what a
//      task is, which is what let unvalidated content ship (#37).
//   2. It refuses symlinks instead of dereferencing them. `fs.copyFileSync`
//      FOLLOWS a link and copies the target's bytes, and a symlink dirent is
//      neither isFile() nor isDirectory(), so the old exclusions were skipped for
//      it entirely — a tracked `notes.md -> ~/.npmrc` became a real file in the
//      package (#40).
//   3. It asserts its own output. A required root asset that is missing is an
//      error, not a silent skip, and after composing it re-reads the manifest and
//      confirms every path it promises resolves to a real file inside ./build
//      (#42, #46). It used to print "Build assembled at build" and exit 0 over a
//      package whose declared icon and overview did not exist.
//
// scripts/check-package-composition.js enforces the same rules over the tracked
// tree in CI, from the same two modules, so a defect is caught at review time
// rather than at package time. The one class it cannot catch is the
// .gitignore'd one — `.env`, `*.key` — which by construction exists only on the
// machine that runs this script. That is why the NEVER_SHIP rules are enforced
// HERE and not only in the gate.

const fs = require('node:fs')
const path = require('node:path')

const { discoverTaskDirs, walkTree, insideTaskDir, toPosix } = require('./lib/task-dirs.js')
const contents = require('./lib/package-contents.js')

const root = path.join(__dirname, '..')
const build = path.join(root, 'build')

const errors = []
const skipped = []
let copiedFiles = 0
let bundlesDependencies = false

function refuse(message) {
  errors.push(message)
}

// Resolved once: the repository root may itself sit under a symlinked path
// (/tmp on macOS is the common case), so containment has to be judged
// realpath-against-realpath or every copy looks like an escape.
const realRoot = fs.realpathSync(root)

/** Copy one file, refusing anything that would leave the repository root. */
function copyFile(rel) {
  const from = path.join(root, rel)
  const resolved = fs.realpathSync(from)
  if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
    refuse(`${rel}: resolves to ${resolved}, outside the repository root — refusing to package it`)
    return
  }
  const to = path.join(build, rel)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  copiedFiles += 1
}

/**
 * Copy a subtree, classifying every path against scripts/lib/package-contents.js.
 * Symlinks are refused, not followed. Unknown paths are refused, not guessed at.
 */
function copyTree(relDir) {
  for (const entry of walkTree(root, relDir, (rel) => !contents.directoryDropped(rel))) {
    if (entry.kind === 'symlink') {
      refuse(
        `${entry.rel}: symlink — copying it would dereference the link and package the target's contents; symlinks may not be packaged`,
      )
      continue
    }
    if (entry.kind === 'other') {
      refuse(`${entry.rel}: not a regular file or directory — refusing to package it`)
      continue
    }
    if (entry.kind === 'dir') continue

    const verdict = contents.classify(entry.rel)
    if (verdict.verdict === contents.DROP) {
      skipped.push(entry.rel)
    } else if (verdict.verdict === contents.NEVER_SHIP) {
      refuse(`${entry.rel}: ${verdict.why} — ${contents.NEVER_SHIP_ADVICE}`)
    } else if (verdict.verdict === contents.UNKNOWN) {
      refuse(`${entry.rel}: ${verdict.why} — ${contents.UNKNOWN_ADVICE}`)
    } else {
      if (contents.inNodeModules(entry.rel)) bundlesDependencies = true
      copyFile(entry.rel)
    }
  }
}

// ── compose ──────────────────────────────────────────────────────────────────

fs.rmSync(build, { recursive: true, force: true })
fs.mkdirSync(build, { recursive: true })

// Only the task directories the gates enumerate. Anything else under Tasks/ is a
// layout error rather than something to copy quietly; check-package-composition.js
// reports it in full, and this refuses to package it either way.
const taskDirs = discoverTaskDirs(root)
for (const dir of taskDirs) copyTree(dir)

const outsideTask = (rel) => !insideTaskDir(rel, taskDirs)
const strays = walkTree(root, 'Tasks', (rel) => !contents.directoryDropped(rel) && outsideTask(rel))
  .filter((e) => (e.kind === 'file' || e.kind === 'symlink') && outsideTask(e.rel))
  .filter((e) => contents.classify(e.rel).verdict !== contents.DROP)
for (const stray of strays) {
  const what = stray.kind === 'symlink' ? 'symlink under Tasks/' : 'under Tasks/'
  refuse(
    `${stray.rel}: ${what} but outside every canonical task directory ` +
      `(${taskDirs.length === 0 ? 'there are none' : taskDirs.join(', ')}) — run scripts/check-package-composition.js`,
  )
}

for (const dir of contents.ROOT_DIRS) copyTree(dir)

for (const asset of contents.ROOT_ASSETS) {
  const abs = path.join(root, asset.name)
  if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) {
    refuse(`${asset.name}: symlink — symlinks may not be packaged`)
    continue
  }
  if (fs.existsSync(abs)) {
    copyFile(asset.name)
    continue
  }
  if (asset.required || (asset.requiredWhenBundling && bundlesDependencies)) {
    refuse(`${asset.name}: missing — ${asset.why}`)
  } else {
    skipped.push(`${asset.name} (absent, not required)`)
  }
}

// ── assert the output ────────────────────────────────────────────────────────
// Everything above describes what SHOULD have been copied. This re-reads the
// finished ./build and checks it, because "the composition step of a distributed
// artifact makes no assertion whatsoever about its own output" is the defect.

function assertOutput() {
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(build, 'azure-devops-extension.json'), 'utf8'))
  } catch (err) {
    refuse(`build/azure-devops-extension.json: not readable as JSON — ${err.message}`)
    return
  }

  const promised = []
  const content = manifest.content || {}
  if (content.details && content.details.path) promised.push(['content.details.path', content.details.path])
  if (content.license && content.license.path) promised.push(['content.license.path', content.license.path])
  for (const [key, value] of Object.entries(manifest.icons || {})) promised.push([`icons.${key}`, value])
  for (const [i, entry] of (manifest.files || []).entries()) {
    if (entry && entry.path) promised.push([`files[${i}].path`, entry.path])
  }

  for (const [label, value] of promised) {
    const rel = toPosix(path.normalize(String(value)))
    if (path.isAbsolute(String(value)) || rel.startsWith('..')) {
      refuse(`build/azure-devops-extension.json: ${label} = ${JSON.stringify(value)} escapes the package root`)
      continue
    }
    if (!fs.existsSync(path.join(build, rel))) {
      refuse(
        `build/${rel}: promised by the packaged manifest (${label}) and not present in the package — ` +
          `the .vsix would ship a dangling reference`,
      )
    }
  }

  // Nothing outside the allowlist may have reached ./build by any route.
  for (const entry of walkTree(build, '.')) {
    const rel = toPosix(path.relative('.', entry.rel))
    if (entry.kind === 'symlink') {
      refuse(`build/${rel}: symlink present in the composed package`)
      continue
    }
    if (entry.kind !== 'file') continue
    if (contents.ROOT_ASSETS.some((a) => a.name === rel)) continue
    const verdict = contents.classify(rel)
    if (verdict.verdict !== contents.SHIP) {
      refuse(`build/${rel}: classified '${verdict.verdict}' (${verdict.why}) yet present in the composed package`)
    }
  }
}

if (errors.length === 0) assertOutput()

if (errors.length > 0) {
  // Fail closed: leave no half-composed ./build for a later step to package.
  fs.rmSync(build, { recursive: true, force: true })
  console.error('Build composition refused:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(
  `Build assembled at ${path.relative(root, build)} — ${copiedFiles} file(s) from ${taskDirs.length} task(s), ` +
    `${skipped.length} dev-only path(s) excluded.`,
)
