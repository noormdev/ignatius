/**
 * Verification script for CP-1: Server /dict route.
 *
 * Assertions:
 *  1. GET /dict returns 200 with valid dict HTML (entity anchor, CSS vars, doctype)
 *  2. GET /dict (no query param) returns dark-mode CSS vars
 *  3. GET /dict?theme=light returns light-mode CSS vars (different --color-background value)
 *  4. GET /dict?theme=invalid falls back to dark (same background as dark)
 *  5. GET / (graph) still returns 200
 *
 * Run: bun test/checks/test-dict-route.ts
 */

import { serveCommand } from '../../src/server';
import { resolve } from 'path';

const PORT = 3298;
const MODELS_DIR = resolve(import.meta.dir, '../../models/key-inherited');

async function sleep(ms: number) {
  return new Promise<void>(res => setTimeout(res, ms));
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

async function main() {
  console.log('Starting server...');
  const handle = serveCommand(MODELS_DIR, { port: PORT });
  await sleep(200);

  const base = `http://localhost:${handle.server.port}`;

  // ---- Assertion 1: GET /dict returns 200 with dict HTML ----
  const dictRes = await fetch(`${base}/dict`);
  assert(dictRes.status === 200, `GET /dict returns 200 (got ${dictRes.status})`);

  const dictHtml = await dictRes.text();
  assert(dictHtml.toLowerCase().includes('<!doctype html>'), 'GET /dict body contains <!doctype html>');
  assert(dictHtml.includes('--color-background'), 'GET /dict body contains CSS custom property --color-background');
  // Party is an entity in the models dir — its anchor must be present
  assert(dictHtml.includes('id="entity-Party"'), 'GET /dict body contains entity anchor id="entity-Party"');

  // The mode only sets the initial data-theme on <html>; both palettes are
  // always embedded as :root[data-theme="…"] blocks (runtime theme switching).
  // So the distinguishing signal is the <html> tag attribute, not the first
  // --color-background match (which is identical across modes).
  const htmlTheme = (html: string) => html.match(/<html[^>]*\sdata-theme="([^"]+)"/)?.[1];

  // ---- Assertion 2: Default (no query param) initializes dark mode ----
  assert(htmlTheme(dictHtml) === 'dark', `GET /dict (default) initializes data-theme="dark" (got ${htmlTheme(dictHtml)})`);
  // Both dark + light palettes are embedded with distinct background values.
  const distinctBgs = new Set(
    [...dictHtml.matchAll(/--color-background:\s*([^;]+);/g)].map(m => m[1]?.trim()),
  );
  assert(distinctBgs.size >= 2, `dict embeds distinct dark + light --color-background palettes (got ${[...distinctBgs].join(', ')})`);

  // ---- Assertion 3: GET /dict?theme=light initializes light mode ----
  const lightRes = await fetch(`${base}/dict?theme=light`);
  assert(lightRes.status === 200, `GET /dict?theme=light returns 200 (got ${lightRes.status})`);

  const lightHtml = await lightRes.text();
  assert(htmlTheme(lightHtml) === 'light', `GET /dict?theme=light initializes data-theme="light" (got ${htmlTheme(lightHtml)})`);

  // ---- Assertion 4: Invalid theme param falls back to dark ----
  const invalidRes = await fetch(`${base}/dict?theme=rainbow`);
  assert(invalidRes.status === 200, `GET /dict?theme=rainbow returns 200 (got ${invalidRes.status})`);

  const invalidHtml = await invalidRes.text();
  assert(htmlTheme(invalidHtml) === 'dark', `Invalid theme falls back to data-theme="dark" (got ${htmlTheme(invalidHtml)})`);

  // ---- Assertion 5: GET / (graph) still returns 200 ----
  const graphRes = await fetch(`${base}/`);
  assert(graphRes.status === 200, `GET / returns 200 (got ${graphRes.status})`);

  // Cleanup
  handle.stop(true);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
