// Builds the library in the current directory into dist/, as a package that
// can be published as-is (npm publish dist, vlt publish --publish-directory=dist).
//
// In the monorepo, package.json exports point at the TypeScript source, and
// the package is private so it can't be published by accident. This compiles
// the source with tsconfig.build.json and writes a dist/package.json whose
// exports point at the compiled files instead.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const out = 'dist';

rmSync(out, { recursive: true, force: true });
execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });

/** Maps a source export target (./src/x.ts) to its compiled form. */
function mapTarget(target) {
  const rel = target.replace(/^\.\/src\//, '');
  if (/\.(ts|js)$/.test(rel)) {
    const stem = rel.replace(/\.(ts|js)$/, '');
    return { types: `./${stem}.d.ts`, default: `./${stem}.js` };
  }
  // Anything else (CSS) is copied over unchanged.
  mkdirSync(join(out, dirname(rel)), { recursive: true });
  copyFileSync(target, join(out, rel));
  return `./${rel}`;
}

const exports = Object.fromEntries(Object.entries(pkg.exports).map(([key, target]) => [key, mapTarget(target)]));

// Workspace dependencies are pinned in the monorepo; published packages
// depend on compatible versions instead.
const dependencies = pkg.dependencies
  ? Object.fromEntries(
      Object.entries(pkg.dependencies).map(([name, range]) => [
        name,
        name.startsWith('@askdown/') ? `^${range}` : range,
      ]),
    )
  : undefined;

const published = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  keywords: pkg.keywords,
  homepage: 'https://askdown.dev',
  license: pkg.license,
  author: 'Evert Pot',
  type: pkg.type,
  sideEffects: Array.isArray(pkg.sideEffects)
    ? pkg.sideEffects.map((p) => p.replace(/^\.\/src\//, './'))
    : pkg.sideEffects,
  exports,
  dependencies,
};

writeFileSync(join(out, 'package.json'), JSON.stringify(published, null, 2) + '\n');
for (const file of ['README.md', 'LICENSE']) copyFileSync(file, join(out, basename(file)));

console.log(`[build] ${pkg.name}@${pkg.version} -> ${out}/`);
