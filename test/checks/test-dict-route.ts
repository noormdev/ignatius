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

  // ---- Assertion 2: Default (no query param) is dark mode ----
  const darkBgMatch = dictHtml.match(/--color-background:\s*([^;]+);/);
  assert(darkBgMatch !== null, 'GET /dict (dark) has --color-background value in CSS');

  // ---- Assertion 3: GET /dict?theme=light returns light mode ----
  const lightRes = await fetch(`${base}/dict?theme=light`);
  assert(lightRes.status === 200, `GET /dict?theme=light returns 200 (got ${lightRes.status})`);

  const lightHtml = await lightRes.text();
  const lightBgMatch = lightHtml.match(/--color-background:\s*([^;]+);/);
  assert(lightBgMatch !== null, 'GET /dict?theme=light has --color-background value in CSS');
  assert(
    darkBgMatch?.[1] !== lightBgMatch?.[1],
    `dark and light --color-background values differ (dark: ${darkBgMatch?.[1]?.trim()}, light: ${lightBgMatch?.[1]?.trim()})`,
  );

  // ---- Assertion 4: Invalid theme param falls back to dark ----
  const invalidRes = await fetch(`${base}/dict?theme=rainbow`);
  assert(invalidRes.status === 200, `GET /dict?theme=rainbow returns 200 (got ${invalidRes.status})`);

  const invalidHtml = await invalidRes.text();
  const invalidBgMatch = invalidHtml.match(/--color-background:\s*([^;]+);/);
  assert(
    invalidBgMatch?.[1] === darkBgMatch?.[1],
    `Invalid theme falls back to dark (expected: ${darkBgMatch?.[1]?.trim()}, got: ${invalidBgMatch?.[1]?.trim()})`,
  );

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
