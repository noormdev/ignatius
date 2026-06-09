/**
 * Verification script for the /dict server route redirect.
 *
 * Assertions:
 *  1. GET /dict (redirect: 'manual') returns a 3xx redirect
 *  2. The Location header is /#view=dict
 *  3. GET / (graph) still returns 200
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

  // ---- Assertion 1 & 2: GET /dict returns a 3xx redirect to /#view=dict ----
  const dictRes = await fetch(`${base}/dict`, { redirect: 'manual' });
  const status = dictRes.status;
  const location = dictRes.headers.get('Location');

  assert(
    status >= 300 && status < 400,
    `GET /dict returns a 3xx redirect (got ${status})`,
  );
  assert(
    location === '/#view=dict',
    `GET /dict Location header is /#view=dict (got ${location})`,
  );

  // ---- Assertion 3: GET / (graph) still returns 200 ----
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
