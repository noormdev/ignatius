/**
 * CP18 visual + behavioral assertion: navigator crash on view-switch is gone.
 *
 * The bug: with the minimap OPEN on #view=graph, switching graph→flow→graph
 * (or graph→dict→graph) threw:
 *   Cannot read properties of null (reading 'isHeadless')
 * at Core.headless ← boundingBox ← Navigator.bb ← Navigator.resize ← ResizeObserver.
 *
 * Root cause: the navigator lifecycle effect depended on [minimapOpen, cyReady]
 * but NOT view. Switching away unmounted the container without tearing down the
 * navigator; its cy 'resize' subscription leaked. On return, cy was
 * destroyed/recreated and the leaked navigator's ResizeObserver called
 * cy.boundingBox() on the destroyed core.
 *
 * Fix (CP18): add `view` to the effect deps; gate teardown on view !== 'graph'.
 *
 * This test:
 *  1. Loads #view=graph with minimap OPEN (localStorage pre-seeded).
 *  2. Waits for the navigator canvas to appear inside #minimap-panel.
 *  3. Switches graph → flow → graph. Asserts: zero page errors, #minimap-panel
 *     re-appears, navigator canvas is present and sized.
 *  4. Switches graph → dict → graph. Same assertions.
 *  5. Screenshots at each stage (dark mode only — crash is not visual).
 *
 * Run: bun test/visual/test-cp18-navigator-crash.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp18-navigator-crash');
mkdirSync(TMP, { recursive: true });

const PORT = 7418;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

function assert(cond: boolean, label: string) {
  if (cond) { note(`  PASS  ${label}`); } else { fail(label); }
}

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', 'models/key-inherited', '--port', String(PORT)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

async function waitForServer(url: string, timeout = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await Bun.sleep(200);
  }
  return false;
}

const serverReady = await waitForServer(BASE, 12_000);
if (!serverReady) fail('Server did not start within 12 seconds');
note(`Server ready at ${BASE}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Capture page errors and console errors to detect the crash.
const pageErrors: string[] = [];
const consoleErrors: string[] = [];

page.on('pageerror', (err) => {
  pageErrors.push(err.message);
  note(`  [pageerror] ${err.message}`);
});
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text());
    note(`  [console.error] ${msg.text()}`);
  }
});

async function shot(name: string): Promise<void> {
  const p = join(TMP, name);
  await page.screenshot({ path: p, fullPage: false });
  note(`Screenshot: ${p}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForGraph(): Promise<void> {
  await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 12_000 },
  );
  await page.waitForTimeout(600);
}

async function waitForFlow(): Promise<void> {
  await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(500);
}

async function navigateTo(view: 'graph' | 'flow' | 'dict'): Promise<void> {
  const fab = page.locator('.fab').first();
  await fab.click();
  await page.waitForTimeout(300);
  // Label map matches the CP2 renames in the FAB menu.
  const labelMap = { graph: 'Data Graph', flow: 'Data Flows', dict: 'Dictionary' };
  const item = page.getByRole('menuitem', { name: labelMap[view] });
  const c = await item.count();
  if (c === 0) {
    // Fallback to shorter labels used in earlier builds.
    const alt = page.locator('.fab-menu-item').filter({ hasText: view === 'flow' ? 'Flows' : (view === 'graph' ? 'Graph' : 'Dictionary') });
    await alt.click();
  } else {
    await item.click();
  }
  if (view === 'graph') await waitForGraph();
  else if (view === 'flow') await waitForFlow();
  else await page.waitForTimeout(800);
}

async function waitForNavigatorMounted(): Promise<boolean> {
  // cytoscape-navigator renders an <img> preview plus .cytoscape-navigatorView
  // and .cytoscape-navigatorOverlay divs inside the container.
  try {
    await page.waitForFunction(
      () => {
        const panel = document.querySelector('#minimap-panel');
        if (!panel) return false;
        // A mounted navigator always injects .cytoscape-navigatorView.
        return !!panel.querySelector('.cytoscape-navigatorView');
      },
      { timeout: 8_000 },
    );
    return true;
  } catch {
    return false;
  }
}

// ── Seed localStorage so minimap starts OPEN ─────────────────────────────────

// Navigate once, set the flag, then reload the same page so React re-initialises
// with minimapOpen = true. A second goto() with a different hash can race the
// hash-router init; reload() preserves the URL and avoids that.
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('ignatius-minimap', 'true');
});

// Reload so React initialises with minimapOpen = true from localStorage.
await page.reload({ waitUntil: 'domcontentloaded' });
// Wait for Cytoscape to fully initialize before checking the minimap.
await waitForGraph();

// ════════════════════════════════════════════════════════════════════════════════
// ROUND-TRIP 1: graph → flow → graph
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Round-trip 1: graph → flow → graph ──');

// Step 1: confirm minimap panel is visible on the graph view.
// Wait explicitly — the minimap panel renders after Cytoscape sets up.
await page.locator('#minimap-panel').waitFor({ timeout: 8_000 }).catch(() => {});
const minimapVisible1 = await page.locator('#minimap-panel').count();
assert(minimapVisible1 > 0, 'RT1: #minimap-panel is present on initial graph view');

const canvasMounted1 = await waitForNavigatorMounted();
assert(canvasMounted1, 'RT1: navigator canvas is mounted and sized on initial graph view');

await shot('rt1-01-graph-minimap-open.png');

// Step 2: switch to flow.
note('  Switching to flow…');
await navigateTo('flow');
await shot('rt1-02-flow-view.png');

// No #minimap-panel on the flow view.
const minimapOnFlow = await page.locator('#minimap-panel').count();
assert(minimapOnFlow === 0, 'RT1: #minimap-panel is absent on flow view (correctly unmounted)');

// Step 3: switch back to graph.
note('  Switching back to graph…');
await navigateTo('graph');
await shot('rt1-03-return-to-graph.png');

// Assert: no page errors (the crash would surface here).
const navigatorErrors1 = pageErrors.filter(e => e.includes('isHeadless') || e.includes('navigator') || e.includes('boundingBox'));
assert(navigatorErrors1.length === 0, `RT1: zero isHeadless/navigator/boundingBox page errors (found: ${navigatorErrors1.join(', ')})`);
assert(pageErrors.length === 0, `RT1: zero page errors total (found: ${pageErrors.join(', ')})`);

// Assert: #minimap-panel re-appeared and the canvas is live.
const minimapAfterReturn1 = await page.locator('#minimap-panel').count();
assert(minimapAfterReturn1 > 0, 'RT1: #minimap-panel re-appears after returning to graph');

const canvasAfterReturn1 = await waitForNavigatorMounted();
assert(canvasAfterReturn1, 'RT1: navigator canvas is mounted and sized after returning to graph');

await shot('rt1-04-graph-minimap-remounted.png');

note('\n  Round-trip 1 complete — no crashes, navigator re-mounted.');

// ════════════════════════════════════════════════════════════════════════════════
// ROUND-TRIP 2: graph → dict → graph
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Round-trip 2: graph → dict → graph ──');

// Clear accumulated errors before this round-trip.
pageErrors.length = 0;
consoleErrors.length = 0;

// Step 1: confirm minimap still open before switch.
const minimapBeforeDict = await page.locator('#minimap-panel').count();
assert(minimapBeforeDict > 0, 'RT2: #minimap-panel present before dict switch');

await shot('rt2-01-graph-before-dict.png');

// Step 2: switch to dict.
note('  Switching to dict…');
await navigateTo('dict');
await shot('rt2-02-dict-view.png');

const minimapOnDict = await page.locator('#minimap-panel').count();
assert(minimapOnDict === 0, 'RT2: #minimap-panel is absent on dict view');

// Step 3: switch back to graph.
note('  Switching back to graph…');
await navigateTo('graph');
await shot('rt2-03-return-to-graph.png');

const navigatorErrors2 = pageErrors.filter(e => e.includes('isHeadless') || e.includes('navigator') || e.includes('boundingBox'));
assert(navigatorErrors2.length === 0, `RT2: zero isHeadless/navigator/boundingBox page errors (found: ${navigatorErrors2.join(', ')})`);
assert(pageErrors.length === 0, `RT2: zero page errors total (found: ${pageErrors.join(', ')})`);

const minimapAfterDict = await page.locator('#minimap-panel').count();
assert(minimapAfterDict > 0, 'RT2: #minimap-panel re-appears after returning from dict');

const canvasAfterDict = await waitForNavigatorMounted();
assert(canvasAfterDict, 'RT2: navigator canvas is mounted and sized after returning from dict');

await shot('rt2-04-graph-minimap-remounted.png');

note('\n  Round-trip 2 complete — no crashes, navigator re-mounted.');

// ── Teardown ──────────────────────────────────────────────────────────────────

await browser.close();
proc.kill();

note('\n✓ CP18 PASS — navigator crash on view-switch is gone; minimap re-mounts on return to graph.');
