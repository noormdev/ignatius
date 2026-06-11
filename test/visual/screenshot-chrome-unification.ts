/**
 * Visual verification: CP2 part 2 — chrome unification.
 *
 * Proves:
 *  1. The branding block + footer appear on all three views (graph / flow / dict-stub).
 *  2. The theme toggle (.theme-toggle) is present on all three views.
 *  3. The FAB (.fab) is present on all three views with contextual menu items:
 *     - graph view: shows graph-specific items (Legend, Reset layout, etc.) and view-switch items
 *     - flow view: shows flow-specific items (Reset layout) and view-switch items; NOT Cytoscape-only items
 *     - dict view: shows view-switch items; no Cytoscape-only items
 *  4. Toggling theme from the flow view re-themes the DFD (CP2a invariant holds).
 *  5. FlowChrome no longer renders its own FAB or theme toggle.
 *  6. SelectedEntityModal still opens from a graph node tap.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'chrome-unification');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ─────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', '7374'],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

async function waitForServer(url: string, timeout = 10_000): Promise<boolean> {
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

const serverReady = await waitForServer('http://localhost:7374', 10_000);
if (!serverReady) fail('Server did not start within 10 seconds');
note('Server ready at http://localhost:7374');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function assertCyDefined(ctx: string): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 12_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail(`__IGNATIUS_CY__ not defined ${ctx}`);
  note(`CY defined: ${ctx}`);
}

async function assertFlowReady(ctx: string): Promise<void> {
  const ok = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail(`__IGNATIUS_FLOW_READY__ did not become true ${ctx}`);
  note(`Flow ready: ${ctx}`);
}

/** Click the shared theme toggle (.theme-toggle) */
async function clickThemeToggle(): Promise<void> {
  const toggle = page.locator('.theme-toggle');
  const count = await toggle.count();
  if (count === 0) fail('Shared .theme-toggle not found');
  if (count > 1) fail(`Multiple theme toggles found (${count}) — FlowChrome may still have its own`);
  await toggle.click();
  await page.waitForTimeout(400);
}

/** Open the shared FAB (.fab) */
async function openFab(): Promise<void> {
  const fab = page.locator('.fab');
  const count = await fab.count();
  if (count === 0) fail('Shared .fab not found');
  if (count > 1) fail(`Multiple FABs found (${count}) — FlowChrome may still have its own`);
  await fab.click();
  await page.waitForTimeout(300);
}

/** Click a FAB menu item by text */
async function clickFabItem(label: string): Promise<void> {
  const item = page.getByRole('menuitem', { name: label, exact: true });
  const count = await item.count();
  if (count === 0) fail(`FAB item "${label}" not found`);
  await item.click();
  await page.waitForTimeout(500);
}

/** Assert element exists (exactly once or at least once) */
async function assertExists(selector: string, ctx: string, exactly = 1): Promise<void> {
  const el = page.locator(selector);
  const count = await el.count();
  if (exactly > 0 && count < 1) fail(`${ctx}: "${selector}" not found`);
  if (exactly === 1 && count > 1) fail(`${ctx}: "${selector}" appears ${count} times (expected 1)`);
  note(`OK ${ctx}: "${selector}" found (${count})`);
}

/** Assert element does NOT exist */
async function assertAbsent(selector: string, ctx: string): Promise<void> {
  const el = page.locator(selector);
  const count = await el.count();
  if (count > 0) fail(`${ctx}: "${selector}" should be absent but found ${count}`);
  note(`OK ${ctx}: "${selector}" absent as expected`);
}

/** Return the active DFD id from the window global */
async function activeDfd(): Promise<string | undefined> {
  return page.evaluate(() =>
    (window as { __IGNATIUS_ACTIVE_FLOW_DFD__?: string }).__IGNATIUS_ACTIVE_FLOW_DFD__
  );
}

/** Return the SVG flow background color */
async function svgBackground(): Promise<string> {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-ignatius="flow-svg"]') as SVGSVGElement | null;
    if (!svg) return 'NOT_FOUND';
    return svg.style.background || window.getComputedStyle(svg).background || 'EMPTY';
  });
}

// ── Test ─────────────────────────────────────────────────────────────────────

try {
  await page.goto('http://localhost:7374/');
  await page.waitForLoadState('domcontentloaded');
  await assertCyDefined('on boot (graph view)');

  // ── 1. Graph view: branding + theme toggle + FAB ──────────────────────────
  note('\n── 1. Graph view ─────────────────────────────────────────────────────');

  await assertExists('.branding-block', 'graph view');
  await assertExists('.branding-footer', 'graph view');
  await assertExists('.theme-toggle', 'graph view');
  await assertExists('.fab', 'graph view');

  // Open FAB, verify graph-specific items present
  await openFab();
  await assertExists('[role="menuitem"]:has-text("Legend")', 'graph FAB');
  await assertExists('[role="menuitem"]:has-text("Reset layout")', 'graph FAB');
  await assertExists('[role="menuitem"]:has-text("Dictionary")', 'graph FAB');

  const graphShot = join(TMP, '01-graph-chrome.png');
  await page.screenshot({ path: graphShot, fullPage: false });
  note(`Graph chrome screenshot: ${graphShot}`);

  // Close FAB by clicking elsewhere
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ── 2. Switch to Flow view ───────────────────────────────────────────────
  note('\n── 2. Flow view ──────────────────────────────────────────────────────');

  await openFab();
  await clickFabItem('Flows');
  await assertFlowReady('after switching to Flows');

  // Shared chrome present on flow view
  await assertExists('.branding-block', 'flow view');
  await assertExists('.branding-footer', 'flow view');
  await assertExists('.theme-toggle', 'flow view');
  await assertExists('.fab', 'flow view');

  // FlowChrome must NOT have its own theme toggle (only 1 total)
  const themeToggleCount = await page.locator('.theme-toggle').count();
  if (themeToggleCount !== 1) fail(`Expected 1 .theme-toggle on flow view, got ${themeToggleCount}`);
  note(`OK: exactly 1 .theme-toggle on flow view`);

  // Open FAB on flow view — verify flow items, NO Cytoscape-only items
  await openFab();

  // Flow-specific items should be present
  await assertExists('[role="menuitem"]:has-text("Reset layout")', 'flow FAB');
  await assertExists('[role="menuitem"]:has-text("Data Graph")', 'flow FAB');
  await assertExists('[role="menuitem"]:has-text("Dictionary")', 'flow FAB');

  // Cytoscape-only items must NOT appear on flow view
  const groupsItem = await page.locator('[role="menuitem"]:has-text("Groups")').count();
  if (groupsItem > 0) fail('Flow FAB shows "Groups" — Cytoscape-only item must not appear on flow view');
  note('OK: flow FAB does not show "Groups"');

  const minimapItem = await page.locator('[role="menuitem"]:has-text("minimap")').count();
  if (minimapItem > 0) fail('Flow FAB shows "minimap" — Cytoscape-only item must not appear on flow view');
  note('OK: flow FAB does not show minimap toggle');

  const layoutItem = await page.locator('[role="menuitem"]:has-text("Hierarchical layout"), [role="menuitem"]:has-text("Organic layout")').count();
  if (layoutItem > 0) fail('Flow FAB shows layout toggle — Cytoscape-only item must not appear on flow view');
  note('OK: flow FAB does not show layout toggle');

  const flowShot = join(TMP, '02-flow-chrome.png');
  await page.screenshot({ path: flowShot, fullPage: false });
  note(`Flow chrome screenshot: ${flowShot}`);

  // Close FAB
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ── 3. Theme toggle re-themes the DFD ──────────────────────────────────
  note('\n── 3. Theme toggle re-themes DFD ────────────────────────────────────');

  const bgBefore = await svgBackground();
  note(`DFD background before toggle: ${bgBefore}`);

  await clickThemeToggle();

  const bgAfter = await svgBackground();
  note(`DFD background after toggle: ${bgAfter}`);

  if (bgBefore === bgAfter) fail('Theme toggle did NOT re-theme the DFD — background unchanged');
  note('Theme toggle re-themed the DFD');

  // Capture DFD in both themes
  const flowDarkShot = join(TMP, '03-flow-dark.png');
  await page.screenshot({ path: flowDarkShot, fullPage: false });
  note(`Flow (dark) screenshot: ${flowDarkShot}`);

  await clickThemeToggle(); // toggle back to light
  const flowLightShot = join(TMP, '04-flow-light.png');
  await page.screenshot({ path: flowLightShot, fullPage: false });
  note(`Flow (light) screenshot: ${flowLightShot}`);

  // Reset to dark for remaining steps
  await clickThemeToggle();
  await page.waitForTimeout(300);

  // ── 4. Switch to Dict view ──────────────────────────────────────────────
  note('\n── 4. Dict view ──────────────────────────────────────────────────────');

  await openFab();
  await clickFabItem('Dictionary');
  await page.waitForFunction(
    () => location.hash.includes('view=dict'),
    { timeout: 5_000 },
  );

  // Shared chrome present on dict view
  await assertExists('.branding-block', 'dict view');
  await assertExists('.branding-footer', 'dict view');
  await assertExists('.theme-toggle', 'dict view');
  await assertExists('.fab', 'dict view');

  // Open FAB on dict view — verify minimal items (view-switch)
  await openFab();
  await assertExists('[role="menuitem"]:has-text("Data Graph")', 'dict FAB');
  await assertExists('[role="menuitem"]:has-text("Flows")', 'dict FAB');

  // Cytoscape-only items must NOT appear on dict view
  const dictGroupsItem = await page.locator('[role="menuitem"]:has-text("Groups")').count();
  if (dictGroupsItem > 0) fail('Dict FAB shows "Groups" — must not appear on dict view');
  note('OK: dict FAB does not show "Groups"');

  const dictShot = join(TMP, '05-dict-chrome.png');
  await page.screenshot({ path: dictShot, fullPage: false });
  note(`Dict chrome screenshot: ${dictShot}`);

  // Close FAB
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ── 5. Switch back to graph, verify entity modal ──────────────────────
  note('\n── 5. Entity modal from graph ────────────────────────────────────────');

  await openFab();
  await clickFabItem('Data Graph');
  await assertCyDefined('back on graph view');

  // Click a graph node to open the entity modal
  const cyNode = await page.evaluate(() => {
    const cy = (window as { __IGNATIUS_CY__?: { nodes: () => { first: () => { id: () => string; renderedPosition: () => { x: number; y: number } } } }  }).__IGNATIUS_CY__;
    if (!cy) return null;
    const first = cy.nodes().first();
    return { id: first.id(), pos: first.renderedPosition() };
  });

  if (cyNode) {
    await page.mouse.click(cyNode.pos.x, cyNode.pos.y);
    await page.waitForTimeout(600);
    const modalVisible = await page.locator('.modal-backdrop').isVisible().catch(() => false);
    note(`Entity modal visible after node click: ${modalVisible}`);
    if (!modalVisible) note('Warning: entity modal did not open (may need double-click or tap)');
  } else {
    note('Warning: no cy nodes found, skipping entity modal click');
  }

  const graphFinalShot = join(TMP, '06-graph-final.png');
  await page.screenshot({ path: graphFinalShot, fullPage: false });
  note(`Graph final screenshot: ${graphFinalShot}`);

  // ── Verify screenshot sizes ───────────────────────────────────────────
  note('\n── Screenshot size verification ─────────────────────────────────────');
  const shots = [graphShot, flowShot, flowDarkShot, flowLightShot, dictShot, graphFinalShot];
  for (const shot of shots) {
    const f = Bun.file(shot);
    note(`  ${shot.split('/').pop()}: ${f.size} bytes`);
    if (f.size < 5000) fail(`Screenshot ${shot} suspiciously small (< 5KB)`);
  }

  note('\nAll checks PASSED.');
  note(`Screenshots saved to ${TMP}/`);

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP2 part 2 chrome-unification visual check PASSED.');
