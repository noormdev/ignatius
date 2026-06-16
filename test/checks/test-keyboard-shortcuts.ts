/**
 * CP2 keyboard-shortcuts integration check.
 *
 * Serves models/key-inherited (has entities + flows → all three views exist)
 * and asserts in a real browser:
 *
 *   1. View-switch keys: d→dict, f→flow, g→graph (hash changes).
 *   2. Layout toggle: g, read localStorage['ignatius-layout-mode'], press l,
 *      wait for it to change, assert it flipped.
 *   3. Lens toggle: d, read localStorage['ignatius-dict-lens'], press b,
 *      wait for it to change, assert it flipped.
 *   4. Typing-inert: focus .dict-search-input, type g, assert hash stays
 *      view=dict AND the input value contains g.
 *
 * Skips gracefully (exit 0) when dist/static/index.js is absent — CI builds
 * before running checks.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

let failures = 0;

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

const PORT = 3296;
const handle = serveCommand(MODEL, { port: PORT });
await new Promise<void>(r => setTimeout(r, 400));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  // Load on graph view and wait for the canvas to be ready.
  await page.goto(`http://localhost:${PORT}/#view=graph`, { waitUntil: 'load' });
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 }).catch(() => null);
  await new Promise<void>(r => setTimeout(r, 1500));

  // Ensure focus is on body (not in any input) before key tests.
  await page.evaluate(() => document.body.focus());

  // ---------------------------------------------------------------------------
  // Test 1: view-switch keys  d → dict, f → flow, g → graph
  // ---------------------------------------------------------------------------

  await page.keyboard.press('d');
  await page.waitForFunction(() => location.hash.includes('view=dict'), { timeout: 3000 });
  assert(
    await page.evaluate(() => location.hash.includes('view=dict')),
    'pressing d navigates to dict view',
  );

  await page.keyboard.press('f');
  await page.waitForFunction(() => location.hash.includes('view=flow'), { timeout: 3000 });
  assert(
    await page.evaluate(() => location.hash.includes('view=flow')),
    'pressing f navigates to flow view',
  );

  await page.keyboard.press('g');
  await page.waitForFunction(() => location.hash.includes('view=graph'), { timeout: 3000 });
  assert(
    await page.evaluate(() => location.hash.includes('view=graph')),
    'pressing g navigates to graph view',
  );

  // ---------------------------------------------------------------------------
  // Test 2: layout toggle (l key, graph view only)
  // ---------------------------------------------------------------------------

  // Ensure we are on graph view.
  assert(
    await page.evaluate(() => location.hash.includes('view=graph')),
    'on graph view before layout toggle test',
  );

  // Read current layout mode from localStorage (may be null = defaults to organic).
  const layoutBefore = await page.evaluate(() => localStorage.getItem('ignatius-layout-mode') ?? 'organic');

  await page.keyboard.press('l');
  await page.waitForFunction(
    (before: string) => {
      const current = localStorage.getItem('ignatius-layout-mode') ?? 'organic';
      return current !== before;
    },
    layoutBefore,
    { timeout: 5000 },
  );

  const layoutAfter = await page.evaluate(() => localStorage.getItem('ignatius-layout-mode') ?? 'organic');
  const expectedLayout = layoutBefore === 'organic' ? 'hierarchical' : 'organic';
  assert(
    layoutAfter === expectedLayout,
    `layout toggle flipped from ${layoutBefore} to ${expectedLayout} (got: ${layoutAfter})`,
  );

  // ---------------------------------------------------------------------------
  // Test 3: lens toggle (b key, dict view only)
  //
  // Also exercises the stale-closure guard: we switched views (graph→dict)
  // AFTER the keyboard hook was mounted, so a stale closure would have
  // view='graph' and not dispatch toggleLens.
  // ---------------------------------------------------------------------------

  await page.keyboard.press('d');
  await page.waitForFunction(() => location.hash.includes('view=dict'), { timeout: 3000 });

  // Wait for dict to be visible.
  await page.waitForSelector('[data-ignatius="dict-view"]', { timeout: 5000 }).catch(() => null);
  await new Promise<void>(r => setTimeout(r, 300));

  // Refocus body so we are not in an input.
  await page.evaluate(() => document.body.focus());

  const lensBefore = await page.evaluate(() => localStorage.getItem('ignatius-dict-lens') ?? 'read');

  await page.keyboard.press('b');
  await page.waitForFunction(
    (before: string) => {
      const current = localStorage.getItem('ignatius-dict-lens') ?? 'read';
      return current !== before;
    },
    lensBefore,
    { timeout: 3000 },
  );

  const lensAfter = await page.evaluate(() => localStorage.getItem('ignatius-dict-lens') ?? 'read');
  const expectedLens = lensBefore === 'read' ? 'browse' : 'read';
  assert(
    lensAfter === expectedLens,
    `lens toggle flipped from ${lensBefore} to ${expectedLens} (got: ${lensAfter})`,
  );

  // ---------------------------------------------------------------------------
  // Test 4: typing-inert — shortcut must NOT fire when typing into a search input
  // ---------------------------------------------------------------------------

  // Ensure we are on dict view.
  assert(
    await page.evaluate(() => location.hash.includes('view=dict')),
    'on dict view for typing-inert test',
  );

  // Focus the search input.
  await page.focus('.dict-search-input');
  await new Promise<void>(r => setTimeout(r, 100));

  const hashBeforeType = await page.evaluate(() => location.hash);

  // Type 'g' — must NOT trigger the graph view shortcut.
  await page.keyboard.type('g');
  await new Promise<void>(r => setTimeout(r, 300));

  const hashAfterType = await page.evaluate(() => location.hash);
  const inputValue = await page.evaluate(() => {
    const el = document.querySelector('.dict-search-input');
    if (el instanceof HTMLInputElement) return el.value;
    return '';
  });

  assert(
    hashAfterType.includes('view=dict'),
    'hash still contains view=dict after typing g in search input (editable guard works)',
    `hash before: ${hashBeforeType}  after: ${hashAfterType}`,
  );
  assert(
    inputValue.includes('g'),
    `key g reached the search input (input value contains 'g', got: "${inputValue}")`,
  );

} finally {
  await page.close();
  await browser.close();
  handle.stop();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nCP2 keyboard-shortcuts: all assertions passed.');
process.exit(0);
