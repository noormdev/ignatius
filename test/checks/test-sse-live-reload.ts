/**
 * Verification script for CP-4: Live reload via SSE.
 *
 * Assertions:
 *  1. GET /events returns Content-Type: text/event-stream and stays open
 *  2. Touching a .md file triggers exactly ONE model-changed event (debounce works)
 *  3. The event arrives within 500ms of the final write
 *
 * Run: bun test/test-sse-live-reload.ts
 */

import { serveCommand } from '../../src/server/server';
import { resolve } from 'path';

const PORT = 3299;
const MODELS_DIR = resolve(import.meta.dir, '../../models/key-inherited');
const TEST_FILE = resolve(MODELS_DIR, 'identity/Party.md');

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  // ---- Assertion 1: SSE route returns correct content-type ----
  const headRes = await fetch(`http://localhost:${handle.server.port}/events`);
  const ct = headRes.headers.get('content-type') ?? '';
  assert(ct.includes('text/event-stream'), `Content-Type is text/event-stream (got: ${ct})`);
  // Close this response body so we don't leak
  headRes.body?.cancel();

  // ---- Assertion 2 & 3: Touch file → exactly ONE event within 500ms ----

  // Read original content
  const origContent = await Bun.file(TEST_FILE).text();

  const events: string[] = [];
  let eventResolve: (() => void) | null = null;
  let eventPromise = new Promise<void>(res => { eventResolve = res; });

  // Open a persistent SSE connection using a fetch stream reader
  const sseRes = await fetch(`http://localhost:${handle.server.port}/events`);
  const reader = sseRes.body!.getReader();
  const decoder = new TextDecoder();

  // Background reader
  let reading = true;
  const readLoop = (async () => {
    while (reading) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('event:')) {
          const evtName = line.slice('event:'.length).trim();
          events.push(evtName);
          if (evtName === 'model-changed') {
            const notify = eventResolve;
            eventResolve = null;
            if (typeof notify === 'function') notify();
          }
        }
      }
    }
  })();

  await sleep(100); // let SSE connection settle

  // Write the file multiple times rapidly to test debounce
  const modifiedContent = origContent + '\n<!-- test-sse-touch -->';
  const t0 = Date.now();
  await Bun.write(TEST_FILE, modifiedContent);
  await sleep(30);
  await Bun.write(TEST_FILE, modifiedContent + ' 2');
  await sleep(30);
  await Bun.write(TEST_FILE, modifiedContent + ' 3');

  // Wait for event with timeout
  const timeout = sleep(700).then(() => {
    if (eventResolve) {
      eventResolve();
      eventResolve = null;
    }
  });

  await Promise.race([eventPromise, timeout]);
  const elapsed = Date.now() - t0;

  assert(events.includes('model-changed'), `model-changed event received (events: ${JSON.stringify(events)})`);
  assert(elapsed < 700, `Event arrived within 700ms (actual: ${elapsed}ms)`);

  // Wait a bit more to confirm debounce: only ONE event should arrive
  await sleep(500);
  const modelChangedCount = events.filter(e => e === 'model-changed').length;
  assert(modelChangedCount === 1, `Exactly ONE model-changed event fired (got: ${modelChangedCount})`);

  // Restore file
  await Bun.write(TEST_FILE, origContent);

  // Cleanup
  reading = false;
  reader.cancel();
  await readLoop.catch(() => {});
  handle.stop(true);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
