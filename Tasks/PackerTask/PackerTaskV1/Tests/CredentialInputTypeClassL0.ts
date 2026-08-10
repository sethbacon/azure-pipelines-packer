import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CLASS TEST -- credential inputs must be declared `type: password`.
 *
 * This extension's half of the class reported as azure-pipelines-terraform#867:
 * "an input whose own name/label/help describes it as a credential is declared
 * `type: string`, so the classic designer renders it as an ordinary textbox and
 * persists the value in the pipeline DEFINITION in cleartext, readable by anyone
 * with pipeline-read." Distinct from log masking -- githubToken was already
 * passed to setEnvironmentVariable(..., isSecret: true), and was still exposed
 * at rest in the definition.
 *
 * No issue was ever filed against this repo for it. The instance was found by
 * running the credential-input-type signature here after the terraform half
 * closed, which is the point of the class having a signature at all.
 *
 * Re-derives the set from the manifests on every run rather than pinning the
 * names, so a token input added later fails here instead of shipping
 * mis-declared.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TASKS_DIR = path.join(REPO_ROOT, 'Tasks');

const CREDENTIAL_WORDS = /password|token|secret|credential|api ?key|bearer|passphrase|private key/i;

/** Matches the vocabulary but cannot carry a bearer credential, with the reason. */
const EXEMPT: Record<string, string> = {
  'PipelinePacker:commandOptions':
    'Free-text extra packer flags. Matches only because the help warns against putting secrets here; a password input cannot be a flag list.',
  'PipelinePacker:environmentVariables':
    'A multiLine NAME=VALUE list whose help directs secrets to pipeline secret variables. `password` cannot render multi-line.',
  'PipelinePacker:packerVariables':
    'A multiLine NAME=VALUE list, same shape and same help direction as environmentVariables.',
};

type Row = { task: string; input: string; type: string; label: string };

function collectCredentialInputs(): Row[] {
  const rows: Row[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === 'task.json') {
        const manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
        for (const input of manifest.inputs || []) {
          const haystack = [input.name, input.label, input.helpMarkDown].filter(Boolean).join(' | ');
          if (!CREDENTIAL_WORDS.test(haystack)) continue;
          rows.push({ task: manifest.name, input: input.name, type: String(input.type || ''), label: String(input.label || '') });
        }
      }
    }
  };
  walk(TASKS_DIR);
  return rows;
}

describe('credential inputs must be declared password (class test)', () => {
  const rows = collectCredentialInputs();

  it('finds credential-shaped inputs at all (guards against a broken sweep)', () => {
    assert.ok(rows.length > 0, 'zero credential-shaped inputs means the manifest walk is broken, not that the repo is clean');
  });

  for (const row of rows) {
    const key = `${row.task}:${row.input}`;
    // boolean/pickList hold a declared value set and cannot carry a credential
    // whatever their help text says; connectedService and secureFile keep the
    // material outside the definition entirely.
    if (row.type === 'boolean' || /^pick[Ll]ist$/i.test(row.type)) continue;
    if (/^connectedService:/.test(row.type) || row.type === 'secureFile') continue;

    it(`${key} (${row.label}) is password, or exempt with a reason`, () => {
      if (EXEMPT[key]) {
        assert.notStrictEqual(row.type, 'password', `${key} is exempt but IS password -- delete the stale exemption`);
        return;
      }
      assert.strictEqual(row.type, 'password', `${key} reads as a credential but is type '${row.type}', so its value is stored in the pipeline definition in cleartext`);
    });
  }
});
