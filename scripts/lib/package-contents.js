#!/usr/bin/env node
'use strict'

// What may be in the shipped .vsix — the single rule set consumed by BOTH
// scripts/copy-build.js (which composes ./build) and
// scripts/check-package-composition.js (the CI gate that answers "if we
// composed the package right now, would it be correct?"). One module, so the
// gate and the packager cannot answer differently about the same file. That
// divergence is issue #37 and it is the whole reason this file exists.
//
// ── ALLOWLIST, AND WHAT IT COSTS ─────────────────────────────────────────────
//
// copy-build.js used to compose by DENYLIST: five excluded names, `*.ts`, and
// everything else shipped. Default-include means every file type nobody thought
// about defaults INTO a Marketplace-published artifact, and the failure is
// silent and outbound — a `.env`, a `signing.key`, a coverage report, a source
// map that republishes the TypeScript the `.ts` filter existed to withhold
// (issue #41). You find out from the outside, after publishing, if ever.
//
// Inverting to an allowlist flips the failure direction: it becomes INBOUND —
// a task legitimately grows a new asset type (an ADO `Strings/*.resjson` bundle,
// an `.svg` icon, a `.wasm` blob) and the allowlist does not know about it. If
// the allowlist merely *filters*, that file silently vanishes from the package
// and we have swapped a silent-inclusion bug for a silent-omission bug — which
// is issue #42's shape, not a fix for it.
//
// So the allowlist is FAIL-CLOSED, not filter-quietly: a path matching no rule
// is an ERROR that names the file and says which list to add it to. That is the
// cost, stated plainly — the PR that adds a genuinely-new asset type will fail
// CI and its author must spend one line in SHIP_PATTERNS (or DROP_PATTERNS)
// saying what the file is for. Paid once per new asset type, at review time, on
// the PR that introduces it — instead of a file that is missing from a published
// package and a Marketplace listing that renders wrong.
//
// ── THE node_modules EXEMPTION, STATED RATHER THAN HIDDEN ────────────────────
//
// A packaged ADO task ships its pruned production `node_modules`. Third-party
// packages contain arbitrary file types: native `.node` binaries, `.wasm`,
// extensionless `LICENSE`/`AUTHORS`, `.flow`, bin shims. Applying the extension
// allowlist inside `node_modules` would drop files dependencies need at runtime
// and would fail this gate on every dependency bump for reasons no maintainer
// can act on — and a gate that fails constantly gets deleted. So `node_modules`
// is copied verbatim, EXEMPT from SHIP_PATTERNS, subject only to DROP_PATTERNS,
// NEVER_SHIP_PATTERNS and the symlink rule. That is a real hole in the
// allowlist; it is narrow, deliberate, and written down here rather than being
// an accident of the matcher.

const path = require('node:path')

// ── Root assets ──────────────────────────────────────────────────────────────
// Copied to the package root. `required: true` means a missing file is a hard
// error, not a skip: copy-build.js used to guard every one of these with a bare
// `existsSync` and no `else`, so `npm run build:release` reported success while
// composing a package whose manifest pointed at files that were not in it
// (issues #42, #46).
const ROOT_ASSETS = [
  {
    name: 'azure-devops-extension.json',
    required: true,
    why: 'the manifest tfx reads to build the .vsix',
  },
  {
    name: 'LICENSE',
    required: true,
    why: 'azure-devops-extension.json content.license.path',
  },
  {
    name: 'overview.md',
    required: true,
    why: 'azure-devops-extension.json content.details.path — the Marketplace listing body',
  },
  {
    name: 'THIRD_PARTY_NOTICES.md',
    // Conditionally required: attribution for BUNDLED dependencies. There are
    // no tasks and so no bundled node_modules today, so demanding it now would
    // be a gate failing on a file with nothing to say. requiredWhenBundling
    // makes the transition automatic — the first task whose node_modules is
    // composed into the package makes this file mandatory, which is exactly the
    // "one day it gets dropped without a word" failure issue #42 names.
    required: false,
    requiredWhenBundling: true,
    why: 'attribution for third-party code bundled into the package',
  },
]

// Copied wholesale into the package root when present. Manifest-referenced
// paths under here (icons.default / icons.large) are checked separately.
const ROOT_DIRS = ['images']

// ── Classification ───────────────────────────────────────────────────────────
// Evaluation order is load-bearing:
//   1. DROP      — declared dev-only, never composed. Not an error.
//   2. NEVER_SHIP— secret-shaped. Hard error, and NOT fixable by widening SHIP.
//   3. SHIP      — the allowlist.
//   4. unknown   — hard error naming the file. See the cost note above.
//
// DROP runs first so that a test fixture that happens to look like a secret
// (Tests/data/example.pem) is simply never composed, while the same name at a
// task root — where issue #41's fixture put `signing.key` — is composed-eligible
// and therefore a hard failure.

// Dev-only. Excluded by design, enumerated so the exclusion is reviewable.
const DROP_PATTERNS = [
  { re: /(^|\/)Tests(\/|$)/, why: 'test tree — not runtime' },
  { re: /(^|\/)node_modules\/\.cache(\/|$)/, why: 'tool cache' },
  // Package entrypoints are invoked as `node <target>`, never through a
  // dependency bin shim, and .bin is a directory of symlinks — dropping it is
  // what lets the symlink ban below be total everywhere else.
  { re: /(^|\/)node_modules\/\.bin(\/|$)/, why: 'dependency bin shims — unused by an ADO task entrypoint' },
  { re: /(^|\/)coverage(\/|$)/, why: 'coverage output' },
  { re: /(^|\/)\.nyc_output(\/|$)/, why: 'coverage output' },
  { re: /(^|\/)\.git(\/|$)/, why: 'VCS metadata' },
  { re: /\.ts$/, why: 'TypeScript source — only the compiled .js ships' },
  { re: /\.map$/, why: 'source map — republishes the TypeScript sources the .ts rule withholds' },
  { re: /\.tsbuildinfo$/, why: 'incremental-build state' },
  { re: /(^|\/)tsconfig[^/]*\.json$/, why: 'compiler config' },
  { re: /(^|\/)eslint\.config\.mjs$/, why: 'lint config' },
  { re: /(^|\/)eslint\.base\.mjs$/, why: 'lint config shared by the task configs that extend it' },
  { re: /(^|\/)\.eslintrc[^/]*$/, why: 'lint config' },
  { re: /(^|\/)\.gitignore$/, why: 'VCS config' },
  { re: /(^|\/)\.gitattributes$/, why: 'VCS config' },
  { re: /(^|\/)\.nycrc[^/]*$/, why: 'coverage config' },
  { re: /(^|\/)osv-scanner\.toml$/, why: 'vulnerability-scanner config — CI input, not runtime' },
]

// Secret-shaped. A hit is an error wherever it would be COMPOSED, and the fix
// is to remove the file (or DROP the tree it lives in) — never to add it to
// SHIP_PATTERNS. These names are in .gitignore, which is precisely why CI cannot
// see them: they exist only on the machine that runs `npm run build:release`.
// That makes copy-build.js, not the CI gate, the only place this rule can fire
// for the .env/.key case — so copy-build.js enforces it at composition time and
// again over its own finished output.
const NEVER_SHIP_PATTERNS = [
  { re: /(^|\/)\.env($|\.)/, why: 'local environment file — .gitignore:18-19 calls these local secrets' },
  { re: /\.pem$/, why: 'private key / certificate material' },
  { re: /\.key$/, why: 'private key material' },
  { re: /\.(p12|pfx|jks|keystore)$/, why: 'key store' },
  { re: /(^|\/)\.npmrc$/, why: 'may carry a registry auth token' },
  { re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)($|\.)/, why: 'SSH private key' },
  { re: /(^|\/)\.netrc$/, why: 'credential store' },
]

// The allowlist. Applies to FIRST-PARTY task content only (see the node_modules
// note above). Widening this is a deliberate, reviewable act: say what the file
// type is and why the package needs it.
const SHIP_PATTERNS = [
  { re: /(^|\/)task\.json$/, why: 'ADO task manifest' },
  { re: /(^|\/)task\.loc\.json$/, why: 'localised ADO task manifest' },
  { re: /\.js$/, why: 'compiled task runtime' },
  { re: /\.cjs$/, why: 'compiled task runtime' },
  { re: /\.mjs$/, why: 'compiled task runtime' },
  { re: /\.json$/, why: 'task config and data (package.json, package-lock.json, data tables)' },
  { re: /\.resjson$/, why: 'ADO Strings/ localisation bundle' },
  { re: /\.png$/, why: 'task icon' },
  { re: /\.svg$/, why: 'task icon' },
  { re: /\.md$/, why: 'task-local documentation' },
  { re: /(^|\/)LICENSE$/, why: 'licence text' },
]

const SHIP = 'ship'
const DROP = 'drop'
const NEVER_SHIP = 'never-ship'
const UNKNOWN = 'unknown'

function firstMatch(patterns, rel) {
  return patterns.find((p) => p.re.test(rel))
}

function inNodeModules(rel) {
  return /(^|\/)node_modules(\/|$)/.test(rel)
}

/**
 * Classify a repo-relative POSIX path.
 * Returns { verdict, why, pattern } — see the evaluation-order note above.
 */
function classify(rel) {
  const dropped = firstMatch(DROP_PATTERNS, rel)
  if (dropped) return { verdict: DROP, why: dropped.why }

  const forbidden = firstMatch(NEVER_SHIP_PATTERNS, rel)
  if (forbidden) return { verdict: NEVER_SHIP, why: forbidden.why }

  // Third-party trees are exempt from the extension allowlist, by the reasoning
  // written out at the top of this file.
  if (inNodeModules(rel)) return { verdict: SHIP, why: 'bundled dependency (allowlist-exempt)' }

  const allowed = firstMatch(SHIP_PATTERNS, rel)
  if (allowed) return { verdict: SHIP, why: allowed.why }

  return { verdict: UNKNOWN, why: 'matches no rule in scripts/lib/package-contents.js' }
}

/** True when a DIRECTORY is dropped wholesale (so nothing beneath it composes). */
function directoryDropped(rel) {
  return Boolean(firstMatch(DROP_PATTERNS, `${rel}/`)) || Boolean(firstMatch(DROP_PATTERNS, rel))
}

const UNKNOWN_ADVICE =
  'add its pattern to SHIP_PATTERNS (with a reason) if the package needs it, or to DROP_PATTERNS if it is dev-only — composition refuses to guess'

const NEVER_SHIP_ADVICE = 'remove it from the tree, or DROP the directory it lives in; it must never be packaged'

function toPosix(p) {
  return p.split(path.sep).join('/')
}

module.exports = {
  ROOT_ASSETS,
  ROOT_DIRS,
  DROP_PATTERNS,
  NEVER_SHIP_PATTERNS,
  SHIP_PATTERNS,
  SHIP,
  DROP,
  NEVER_SHIP,
  UNKNOWN,
  UNKNOWN_ADVICE,
  NEVER_SHIP_ADVICE,
  classify,
  directoryDropped,
  inNodeModules,
  toPosix,
}
