/**
 * Post-build script: copy content-hashed bundle outputs to stable file names.
 *
 * WHY: bun build --compile requires import paths to be known at compile time.
 * The bundler produces hashed names like index-abc123.js. We copy them to
 * stable names (index.js, index.css) so the CLI can embed them unconditionally.
 *
 * Run after `bun run build:bundle`, before `bun build --compile`.
 */

import { readdirSync, copyFileSync } from 'fs';
import { join } from 'path';

const BUNDLE_DIR = join(import.meta.dir, '..', 'dist', 'static');

const files = readdirSync(BUNDLE_DIR);
const jsFile = files.find(f => /^index-.*\.js$/.test(f));
const cssFile = files.find(f => /^index-.*\.css$/.test(f));

if (!jsFile) {
  console.error('ERROR: No index-*.js found in dist/static. Run bun run build:bundle first.');
  process.exit(1);
}

if (!cssFile) {
  console.error('ERROR: No index-*.css found in dist/static. Run bun run build:bundle first.');
  process.exit(1);
}

copyFileSync(join(BUNDLE_DIR, jsFile), join(BUNDLE_DIR, 'index.js'));
copyFileSync(join(BUNDLE_DIR, cssFile), join(BUNDLE_DIR, 'index.css'));

console.log(`Stable names written: index.js (from ${jsFile}), index.css (from ${cssFile})`);
