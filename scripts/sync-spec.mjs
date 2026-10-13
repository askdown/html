// Vendors the Askdown spec (github.com/askdown/spec) into vendor/spec/.
//
//   node scripts/sync-spec.mjs                   download the pinned ref
//   node scripts/sync-spec.mjs --ref v0.3.0      download a different ref
//   node scripts/sync-spec.mjs --from ../spec    copy from a local checkout
//
// vendor/spec/ is committed, so builds and tests are reproducible and offline.
// Re-run this and commit the diff to pull spec changes.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_REPO = 'https://github.com/askdown/spec.git';
const SPEC_REF = 'v0.2.0';
// Files/dirs copied from the spec into vendor/spec/.
const FILES = ['askdown.md', 'askdown.schema.json', 'examples', 'LICENSE'];

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};
const ref = opt('--ref') ?? SPEC_REF;
const from = opt('--from');

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const dest = join(repoRoot, 'vendor', 'spec');

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

let source;
let provenance;
let tmp;
if (from) {
  source = from;
  provenance = `local ${from}`;
} else {
  tmp = mkdtempSync(join(tmpdir(), 'askdown-spec-'));
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', ref, SPEC_REPO, tmp], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const sha = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  source = tmp;
  provenance = `${SPEC_REPO}@${ref} (${sha})`;
}

for (const file of FILES) {
  cpSync(join(source, file), join(dest, file), { recursive: true });
}
writeFileSync(join(dest, '.synced'), `Synced from ${provenance}\n`);
if (tmp) rmSync(tmp, { recursive: true, force: true });

console.log(`[sync-spec] vendored askdown spec -> vendor/spec/ (from ${provenance})`);
