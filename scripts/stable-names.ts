/**
 * Post-build script: copy content-hashed bundle outputs to stable file names.
 *
 * WHY: bun build --compile requires import paths to be known at compile time.
 * The bundler produces hashed names like index-abc123.js. We copy them to
 * stable names (index.js, index.css) so the CLI can embed them unconditionally.
 *
 * Run after `bun run build:bundle`, before `bun build --compile`.
 */

import { join } from 'path';

const BUNDLE_DIR = join(import.meta.dir, '..', 'dist', 'static');

const jsGlob = new Bun.Glob('index-*.js');
const cssGlob = new Bun.Glob('index-*.css');

let jsFile: string | undefined;
let cssFile: string | undefined;
for await (const f of jsGlob.scan(BUNDLE_DIR)) { jsFile = f; break; }
for await (const f of cssGlob.scan(BUNDLE_DIR)) { cssFile = f; break; }

if (!jsFile) {
  console.error('ERROR: No index-*.js found in dist/static. Run bun run build:bundle first.');
  process.exit(1);
}

if (!cssFile) {
  console.error('ERROR: No index-*.css found in dist/static. Run bun run build:bundle first.');
  process.exit(1);
}

await Bun.write(Bun.file(join(BUNDLE_DIR, 'index.js')), Bun.file(join(BUNDLE_DIR, jsFile)));
await Bun.write(Bun.file(join(BUNDLE_DIR, 'index.css')), Bun.file(join(BUNDLE_DIR, cssFile)));

console.log(`Stable names written: index.js (from ${jsFile}), index.css (from ${cssFile})`);
