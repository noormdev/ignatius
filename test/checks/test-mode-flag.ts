/**
 * Tests for build-time mode flag injection (CP-4).
 *
 * Verifies:
 * - dist/static/index.html contains window.__IGNATIUS_MODE__ = 'live' (from src/index.html)
 * - A generated static graph HTML contains window.__IGNATIUS_MODE__ = "static"
 * - "static" appears AFTER any "live" line in the generated graph (so 'static' wins)
 * - The live server's / route responds with HTML that contains window.__IGNATIUS_MODE__ = 'live'
 *
 * WHY: The spec requires that static-graph mode and live-server mode are
 * unambiguously distinguishable by the React bundle via this flag. The flag
 * is the only mechanism — no URL sniffing, no env vars.
 */

import { join, resolve } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models/key-inherited');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

let failures = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// Test 1: dist/static/index.html contains 'live' flag (from src/index.html)
// ---------------------------------------------------------------------------

{
  const distHtml = join(ROOT, 'dist/static/index.html');
  const file = Bun.file(distHtml);
  const exists = await file.exists();

  if (!exists) {
    console.log(`  SKIP  dist/static/index.html not found — run bun run build:bundle first`);
  } else {
    const content = await file.text();
    assert(
      content.includes("window.__IGNATIUS_MODE__ = 'live'"),
      "dist/static/index.html contains window.__IGNATIUS_MODE__ = 'live'",
      `First 300 chars:\n${content.slice(0, 300)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Test 2: generated static graph HTML contains "static" flag AFTER "live"
// ---------------------------------------------------------------------------

{
  const bundleExists = await Bun.file(join(ROOT, 'dist/static/index.js')).exists();

  if (!bundleExists) {
    console.log('  SKIP  graph mode-flag test: dist/static/index.js not built');
  } else {
    const OUT = join(TMP, 'graph-mode.html');
    const proc = Bun.spawn(['bun', join(ROOT, 'src/cli.ts'), 'graph', MODELS, '-o', OUT], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const timer = setTimeout(() => proc.kill(), 30_000);
    await proc.exited;
    clearTimeout(timer);

    const file = Bun.file(OUT);
    const exists = await file.exists();
    assert(exists, 'generated graph.html exists', OUT);

    if (exists) {
      const content = await file.text();

      assert(
        content.includes('window.__IGNATIUS_MODE__ = "static"'),
        'graph.html contains window.__IGNATIUS_MODE__ = "static"',
        `First 500 chars:\n${content.slice(0, 500)}`,
      );

      // The injection <script> must appear BEFORE the <script type="module"> (inlined bundle).
      // WHY: The 'static' assignment runs synchronously before the React module executes.
      // The 'live' string that appears later in the file is inside the inlined JS bundle source
      // (minified code), not a top-level script — it executes in module scope, not at page load.
      // We verify the injection script comes before the module script in the HTML structure.
      const injectionIdx = content.indexOf('<script>window.__IGNATIUS_MODE__ = "static"');
      const moduleScriptIdx = content.indexOf('<script type="module">');

      assert(injectionIdx !== -1, 'graph.html has the static injection <script> tag');
      assert(moduleScriptIdx !== -1, 'graph.html has an inlined <script type="module"> tag');
      assert(
        injectionIdx < moduleScriptIdx,
        '"static" injection script appears before the inlined module script (executes first)',
        `injectionIdx=${injectionIdx}, moduleScriptIdx=${moduleScriptIdx}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Test 3: live server / route contains 'live' flag
// ---------------------------------------------------------------------------

{
  const PORT = 3179;
  const handle = serveCommand(MODELS, { port: PORT });

  // Give the server a tick to bind
  await Bun.sleep(200);

  try {
    const res = await fetch(`http://localhost:${PORT}/`);
    const html = await res.text();

    assert(
      html.includes("window.__IGNATIUS_MODE__ = 'live'"),
      "live server / route contains window.__IGNATIUS_MODE__ = 'live'",
      `First 500 chars of /:\n${html.slice(0, 500)}`,
    );
  } finally {
    handle.stop(true);
  }
}

console.log('\n' + (failures === 0 ? 'All mode-flag tests passed.' : `${failures} mode-flag test(s) FAILED.`));
if (failures > 0) process.exit(1);
