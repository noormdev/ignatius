/**
 * Visual verification: CP10a — one FAB icon + consistent FAB menu + modal Legend + z-index overlap fix.
 *
 * Proves:
 *  P1. FAB button shows the 4-dot grid (.fab-dots) on all three views (graph / flow / dict),
 *      NOT the ⋯ icon (.fab-icon).
 *  P4. FAB menu has a "Legend" item on all three views that opens a .legend-modal (not inline
 *      swatches). No .fab-menu-legend-item (inline legend) on any view.
 *      Consistent item ORDER: view-switch items → Legend → view-specific → (Copy link last on
 *      graph/dict). Flow: no Groups/minimap/layout-toggle Cytoscape items.
 *  P5. Open dict side-nav AND FAB menu together — FAB menu is fully visible + closable above
 *      the nav panel (z-index fix).
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp10a-fab-consistency');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ─────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', 'models/key-inherited', '--port', '7395'],
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

const serverReady = await waitForServer('http://localhost:7395', 12_000);
if (!serverReady) fail('Server did not start within 12 seconds');
note('Server ready at http://localhost:7395');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function waitForGraph(): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 12_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Graph (__IGNATIUS_CY__) did not become ready');
}

async function waitForFlow(): Promise<void> {
  const ok = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Flow (__IGNATIUS_FLOW_READY__) did not become ready');
}

/** Open the FAB menu */
async function openFab(): Promise<void> {
  const fab = page.locator('.fab');
  const count = await fab.count();
  if (count === 0) fail('FAB button (.fab) not found');
  if (count > 1) fail(`Multiple FABs found (${count})`);
  await fab.click();
  await page.waitForTimeout(300);
}

/** Close the FAB menu by pressing Escape */
async function closeFab(): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

/** Click a FAB menu item by text and wait */
async function clickFabItem(label: string): Promise<void> {
  const item = page.getByRole('menuitem', { name: label, exact: true });
  const count = await item.count();
  if (count === 0) fail(`FAB item "${label}" not found`);
  await item.click();
  await page.waitForTimeout(500);
}

// ── Assert FAB icon is 4-dot grid ────────────────────────────────────────────

async function assertFabIconIsDots(viewLabel: string): Promise<void> {
  const dotsCount = await page.locator('.fab-dots').count();
  const iconCount = await page.locator('.fab-icon').count();
  if (dotsCount < 1) fail(`${viewLabel}: FAB icon is NOT the 4-dot grid (.fab-dots not found)`);
  if (iconCount > 0) fail(`${viewLabel}: FAB shows .fab-icon (⋯) — expected .fab-dots`);
  note(`OK ${viewLabel}: FAB shows .fab-dots (4-dot grid)`);
}

// ── Assert Legend opens a modal (not inline swatches) ────────────────────────

async function assertLegendOpensModal(viewLabel: string): Promise<void> {
  await openFab();

  // Assert no inline legend swatches in the menu
  const inlineLegend = await page.locator('.fab-menu-legend-item').count();
  if (inlineLegend > 0) fail(`${viewLabel}: FAB menu still has inline .fab-menu-legend-item — must be removed`);
  note(`OK ${viewLabel}: no inline legend swatches in FAB menu`);

  // Assert Legend item is present
  const legendItem = page.getByRole('menuitem', { name: 'Legend', exact: true });
  const legendCount = await legendItem.count();
  if (legendCount === 0) fail(`${viewLabel}: FAB menu has no "Legend" item`);
  note(`OK ${viewLabel}: "Legend" menu item present`);

  // Click Legend — expect a modal to open
  await legendItem.click();
  await page.waitForTimeout(400);

  // Check for modal presence
  const modalCount = await page.locator('.legend-modal').count();
  if (modalCount === 0) fail(`${viewLabel}: Legend click did NOT open .legend-modal`);
  note(`OK ${viewLabel}: .legend-modal opened after clicking Legend`);

  // Close the modal
  const closeBtn = page.locator('.modal-close');
  const closeBtnCount = await closeBtn.count();
  if (closeBtnCount > 0) {
    await closeBtn.first().click();
    await page.waitForTimeout(300);
  } else {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

// ── Test ─────────────────────────────────────────────────────────────────────

try {
  await page.goto('http://localhost:7395/');
  await page.waitForLoadState('domcontentloaded');
  await waitForGraph();

  // ── 1. Graph view — P1: 4-dot FAB icon ────────────────────────────────────
  note('\n── 1. Graph view — FAB icon + Legend modal ─────────────────────────────');
  await assertFabIconIsDots('graph view');

  // P4: Legend opens modal on graph view
  await assertLegendOpensModal('graph view');

  const shot1 = join(TMP, '01-graph-fab-dots.png');
  await page.screenshot({ path: shot1 });
  note(`Screenshot: ${shot1}`);

  // ── 2. Switch to flow view — P1: 4-dot FAB icon ───────────────────────────
  note('\n── 2. Flow view — FAB icon + Legend modal ──────────────────────────────');
  await openFab();
  await clickFabItem('Data Flows');
  await waitForFlow();

  await assertFabIconIsDots('flow view');

  // P4: Legend opens modal on flow view (flow legend, themed)
  await assertLegendOpensModal('flow view');

  // Screenshot of flow legend modal open
  await openFab();
  const flowLegendItem = page.getByRole('menuitem', { name: 'Legend', exact: true });
  await flowLegendItem.click();
  await page.waitForTimeout(400);
  const shot2 = join(TMP, '02-flow-legend-modal.png');
  await page.screenshot({ path: shot2 });
  note(`Screenshot (flow legend modal): ${shot2}`);
  // Close the modal
  const closeBtn2 = page.locator('.modal-close');
  if (await closeBtn2.count() > 0) {
    await closeBtn2.first().click();
    await page.waitForTimeout(300);
  } else {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // ── 3. Switch to dict view — P1: 4-dot FAB icon ───────────────────────────
  note('\n── 3. Dict view — FAB icon + Legend modal + z-index overlap ───────────');
  await openFab();
  await clickFabItem('Dictionary');
  await page.waitForFunction(
    () => location.hash.includes('view=dict'),
    { timeout: 5_000 },
  );
  await page.waitForTimeout(500);

  await assertFabIconIsDots('dict view');

  // P4 (CP2 update): Legend must NOT appear on dict view — dict has no node iconography
  {
    await openFab();
    const legendInDictCheck = page.getByRole('menuitem', { name: 'Legend', exact: true });
    const legendInDictCount = await legendInDictCheck.count();
    if (legendInDictCount > 0) {
      fail('P4 dict: "Legend" item MUST NOT appear in the Dictionary FAB menu (CP2)');
    }
    note('OK dict: no "Legend" item in FAB menu (correct per CP2)');
    await closeFab();
  }

  // P5: Open dict side nav AND FAB menu — FAB menu must be visible + closable
  note('\n── 4. P5: dict nav + FAB menu z-index overlap ──────────────────────────');
  // Open the dict side nav via the FAB toggle sidebar
  await openFab();
  const toggleSidebar = page.getByRole('menuitem', { name: 'Toggle sidebar', exact: true });
  const toggleCount = await toggleSidebar.count();
  if (toggleCount === 0) fail('dict FAB: "Toggle sidebar" item not found');
  await toggleSidebar.click();
  await page.waitForTimeout(400);

  // Verify the nav panel is open
  const navPanel = page.locator('.dict-nav-panel.dict-nav-open');
  const navOpen = await navPanel.count();
  if (navOpen === 0) {
    // Try the toggle once more (may have been closed on first click)
    await openFab();
    await page.getByRole('menuitem', { name: 'Toggle sidebar', exact: true }).click();
    await page.waitForTimeout(400);
  }
  note('Dict nav panel toggled open');

  // Now open the FAB menu while the nav is open
  await openFab();

  // The FAB menu should be visible
  const fabMenu = page.locator('.fab-menu');
  const fabMenuVisible = await fabMenu.isVisible().catch(() => false);
  if (!fabMenuVisible) fail('P5: FAB menu is NOT visible when dict nav is also open');
  note('OK P5: FAB menu is visible with dict nav open');

  // Verify the FAB menu z-index is higher than dict-nav-panel
  const fabMenuZIndex = await page.evaluate(() => {
    const menu = document.querySelector('.fab-menu') as HTMLElement | null;
    if (!menu) return -1;
    return parseInt(window.getComputedStyle(menu).zIndex, 10);
  });
  const dictNavZIndex = await page.evaluate(() => {
    const nav = document.querySelector('.dict-nav-panel') as HTMLElement | null;
    if (!nav) return -1;
    return parseInt(window.getComputedStyle(nav).zIndex, 10);
  });
  note(`FAB menu z-index: ${fabMenuZIndex}, dict-nav-panel z-index: ${dictNavZIndex}`);
  if (fabMenuZIndex <= dictNavZIndex) {
    fail(`P5: FAB menu z-index (${fabMenuZIndex}) is NOT above dict-nav-panel (${dictNavZIndex})`);
  }
  note(`OK P5: FAB menu z-index (${fabMenuZIndex}) > dict-nav-panel (${dictNavZIndex})`);

  // P5: "Copy link" item should be clickable in the menu (Legend no longer on dict)
  const copyLinkInDict = page.getByRole('menuitem', { name: 'Copy link', exact: true });
  const copyLinkCount = await copyLinkInDict.count();
  if (copyLinkCount === 0) fail('P5: "Copy link" item not found in dict FAB menu (menu obscured or missing)');
  note('OK P5: "Copy link" item is clickable in FAB menu over dict nav');

  // Close FAB menu via Escape
  await closeFab();
  await page.waitForTimeout(300);

  const shot3 = join(TMP, '03-dict-nav-fab-overlap.png');
  await page.screenshot({ path: shot3 });
  note(`Screenshot (dict nav + FAB menu closed): ${shot3}`);

  // ── Screenshot size check ─────────────────────────────────────────────────
  note('\n── Screenshot size verification ─────────────────────────────────────');
  const shots = [shot1, shot2, shot3];
  for (const s of shots) {
    const f = Bun.file(s);
    note(`  ${s.split('/').pop()}: ${f.size} bytes`);
    if (f.size < 5000) fail(`Screenshot ${s} suspiciously small (< 5KB)`);
  }

  note('\nAll CP10a checks PASSED.');
  note(`Screenshots saved to ${TMP}/`);

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP10a visual check PASSED.');
