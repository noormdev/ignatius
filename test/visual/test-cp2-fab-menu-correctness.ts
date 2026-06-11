/**
 * Visual verification: CP2 — FAB menu per-view correctness.
 *
 * Proves:
 *  A. DD (dict) FAB menu has NO "Legend" item.
 *  B. DD FAB menu has NO minimap toggle item (Show/Hide minimap).
 *  C. The flow nav item reads "Data Flows" (not "Flows") on every view it appears
 *     (graph view FAB menu, dict view FAB menu).
 *  D. Graph and flow views still show "Legend" in their FAB menus.
 *  E. Menu item order is consistent: view-switch items, then Legend (where shown),
 *     then per-view items, then Copy link.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp2-fab-menu-correctness');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', '7402'],
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

const serverReady = await waitForServer('http://localhost:7402', 12_000);
if (!serverReady) fail('Server did not start within 12 seconds');
note('Server ready at http://localhost:7402');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function openFab(): Promise<void> {
  const fab = page.locator('.fab');
  const count = await fab.count();
  if (count === 0) fail('FAB button (.fab) not found');
  if (count > 1) fail(`Multiple FABs found (${count})`);
  await fab.click();
  await page.waitForTimeout(300);
}

async function closeFab(): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

/** Read all FAB menu item texts (in DOM order). */
async function fabMenuItemTexts(): Promise<string[]> {
  return page.evaluate(() => {
    const items = document.querySelectorAll('.fab-menu [role="menuitem"]');
    return Array.from(items).map(el => (el.textContent ?? '').trim());
  });
}

// ── Test ──────────────────────────────────────────────────────────────────────

try {
  await page.goto('http://localhost:7402/');
  await page.waitForLoadState('domcontentloaded');
  await waitForGraph();

  // ── 1. Graph view ─────────────────────────────────────────────────────────
  note('\n── 1. Graph view — open FAB menu, assert items ──────────────────────────');
  await openFab();
  const graphItems = await fabMenuItemTexts();
  note(`Graph FAB menu items: ${JSON.stringify(graphItems)}`);

  const shotGraph = join(TMP, '01-graph-fab-menu.png');
  await page.screenshot({ path: shotGraph });
  note(`Screenshot: ${shotGraph}`);

  // D: Legend present on graph
  if (!graphItems.includes('Legend')) {
    fail(`Graph FAB menu: missing "Legend" item. Items: ${JSON.stringify(graphItems)}`);
  }
  note('OK graph: "Legend" item present');

  // C: flow nav item reads "Data Flows" (not "Flows")
  if (graphItems.includes('Flows')) {
    fail(`Graph FAB menu: nav item reads "Flows" — must be "Data Flows". Items: ${JSON.stringify(graphItems)}`);
  }
  if (!graphItems.includes('Data Flows')) {
    fail(`Graph FAB menu: no "Data Flows" nav item found. Items: ${JSON.stringify(graphItems)}`);
  }
  note('OK graph: flow nav item reads "Data Flows"');

  // B: no minimap toggle in dict (will check on dict; confirm it IS present on graph)
  const graphHasMinimap = graphItems.some(t => t.toLowerCase().includes('minimap'));
  note(`Graph minimap toggle item present: ${graphHasMinimap}`);

  // E: order — graph view
  // Expected sequence: view-switch (Dictionary, Data Flows) → Legend → per-view (Groups?, minimap, layout, Reset layout) → Copy link
  {
    const gDictionaryIdx = graphItems.indexOf('Dictionary');
    const gDataFlowsIdx = graphItems.indexOf('Data Flows');
    const gLegendIdx = graphItems.indexOf('Legend');
    const gCopyLinkIdx = graphItems.indexOf('Copy link');

    note(`Graph item indices — Dictionary: ${gDictionaryIdx}, Data Flows: ${gDataFlowsIdx}, Legend: ${gLegendIdx}, Copy link: ${gCopyLinkIdx}`);

    if (gDictionaryIdx < 0) fail(`Graph FAB: "Dictionary" item not found. Items: ${JSON.stringify(graphItems)}`);
    if (gDataFlowsIdx < 0) fail(`Graph FAB: "Data Flows" item not found. Items: ${JSON.stringify(graphItems)}`);
    if (gLegendIdx < 0) fail(`Graph FAB: "Legend" item not found. Items: ${JSON.stringify(graphItems)}`);
    if (gCopyLinkIdx < 0) fail(`Graph FAB: "Copy link" item not found. Items: ${JSON.stringify(graphItems)}`);

    // View-switch items must appear before Legend
    if (gDictionaryIdx > gLegendIdx) {
      fail(`Graph FAB order: "Dictionary" (${gDictionaryIdx}) must appear before "Legend" (${gLegendIdx}). Items: ${JSON.stringify(graphItems)}`);
    }
    if (gDataFlowsIdx > gLegendIdx) {
      fail(`Graph FAB order: "Data Flows" (${gDataFlowsIdx}) must appear before "Legend" (${gLegendIdx}). Items: ${JSON.stringify(graphItems)}`);
    }
    // Legend must appear before Copy link
    if (gLegendIdx > gCopyLinkIdx) {
      fail(`Graph FAB order: "Legend" (${gLegendIdx}) must appear before "Copy link" (${gCopyLinkIdx}). Items: ${JSON.stringify(graphItems)}`);
    }
    // Copy link must be last
    if (gCopyLinkIdx !== graphItems.length - 1) {
      fail(`Graph FAB order: "Copy link" (${gCopyLinkIdx}) must be the last item, but items.length=${graphItems.length}. Items: ${JSON.stringify(graphItems)}`);
    }
    note('OK graph: item order correct (view-switch → Legend → per-view → Copy link)');
  }

  await closeFab();

  // ── 2. Switch to Flow view ────────────────────────────────────────────────
  note('\n── 2. Flow view — open FAB menu, assert items ───────────────────────────');
  await openFab();
  const switchToFlow = page.getByRole('menuitem', { name: 'Data Flows', exact: true });
  const switchCount = await switchToFlow.count();
  if (switchCount === 0) fail('Graph FAB: "Data Flows" menu item not found for switching to flow view');
  await switchToFlow.click();
  await waitForFlow();
  await page.waitForTimeout(400);

  await openFab();
  const flowItems = await fabMenuItemTexts();
  note(`Flow FAB menu items: ${JSON.stringify(flowItems)}`);

  const shotFlow = join(TMP, '02-flow-fab-menu.png');
  await page.screenshot({ path: shotFlow });
  note(`Screenshot: ${shotFlow}`);

  // D: Legend present on flow
  if (!flowItems.includes('Legend')) {
    fail(`Flow FAB menu: missing "Legend" item. Items: ${JSON.stringify(flowItems)}`);
  }
  note('OK flow: "Legend" item present');

  // C: flow nav item NOT in menu when on flow view (it's the current view), but Dict item should say "Data Flows" is gone
  // The nav item for dict is "Dictionary"; graph is "Data Graph" — both present on flow view
  if (!flowItems.includes('Data Graph')) {
    fail(`Flow FAB menu: missing "Data Graph" nav item. Items: ${JSON.stringify(flowItems)}`);
  }
  if (!flowItems.includes('Dictionary')) {
    fail(`Flow FAB menu: missing "Dictionary" nav item. Items: ${JSON.stringify(flowItems)}`);
  }
  note('OK flow: "Data Graph" and "Dictionary" nav items present');

  // E: order — flow view
  // Expected sequence: view-switch (Data Graph, Dictionary) → Legend → per-view (Reset layout)
  // No "Copy link" on flow view.
  {
    const fDataGraphIdx = flowItems.indexOf('Data Graph');
    const fDictionaryIdx = flowItems.indexOf('Dictionary');
    const fLegendIdx = flowItems.indexOf('Legend');
    const fResetLayoutIdx = flowItems.indexOf('Reset layout');

    note(`Flow item indices — Data Graph: ${fDataGraphIdx}, Dictionary: ${fDictionaryIdx}, Legend: ${fLegendIdx}, Reset layout: ${fResetLayoutIdx}`);

    if (fDataGraphIdx < 0) fail(`Flow FAB: "Data Graph" item not found. Items: ${JSON.stringify(flowItems)}`);
    if (fDictionaryIdx < 0) fail(`Flow FAB: "Dictionary" item not found. Items: ${JSON.stringify(flowItems)}`);
    if (fLegendIdx < 0) fail(`Flow FAB: "Legend" item not found. Items: ${JSON.stringify(flowItems)}`);
    if (fResetLayoutIdx < 0) fail(`Flow FAB: "Reset layout" item not found. Items: ${JSON.stringify(flowItems)}`);

    // View-switch items must appear before Legend
    if (fDataGraphIdx > fLegendIdx) {
      fail(`Flow FAB order: "Data Graph" (${fDataGraphIdx}) must appear before "Legend" (${fLegendIdx}). Items: ${JSON.stringify(flowItems)}`);
    }
    if (fDictionaryIdx > fLegendIdx) {
      fail(`Flow FAB order: "Dictionary" (${fDictionaryIdx}) must appear before "Legend" (${fLegendIdx}). Items: ${JSON.stringify(flowItems)}`);
    }
    // Legend must appear before per-view items (Reset layout)
    if (fLegendIdx > fResetLayoutIdx) {
      fail(`Flow FAB order: "Legend" (${fLegendIdx}) must appear before "Reset layout" (${fResetLayoutIdx}). Items: ${JSON.stringify(flowItems)}`);
    }
    // Flow has no "Copy link"
    if (flowItems.includes('Copy link')) {
      fail(`Flow FAB menu: "Copy link" MUST NOT appear on Flow view. Items: ${JSON.stringify(flowItems)}`);
    }
    note('OK flow: item order correct (view-switch → Legend → per-view); no Copy link');
  }

  await closeFab();

  // Switch back to graph to navigate to dict
  await openFab();
  const switchToGraph = page.getByRole('menuitem', { name: 'Data Graph', exact: true });
  await switchToGraph.click();
  await waitForGraph();
  await page.waitForTimeout(400);

  // ── 3. Dictionary view ────────────────────────────────────────────────────
  note('\n── 3. Dict view — open FAB menu, assert NO Legend and NO minimap toggle ─');
  await openFab();
  const switchToDict = page.getByRole('menuitem', { name: 'Dictionary', exact: true });
  const switchToDictCount = await switchToDict.count();
  if (switchToDictCount === 0) fail('Graph FAB: "Dictionary" menu item not found');
  await switchToDict.click();
  await page.waitForFunction(
    () => location.hash.includes('view=dict'),
    { timeout: 5_000 },
  );
  await page.waitForTimeout(500);

  await openFab();
  const dictItems = await fabMenuItemTexts();
  note(`Dict FAB menu items: ${JSON.stringify(dictItems)}`);

  const shotDict = join(TMP, '03-dict-fab-menu.png');
  await page.screenshot({ path: shotDict });
  note(`Screenshot: ${shotDict}`);

  // A: NO "Legend" on dict
  if (dictItems.includes('Legend')) {
    fail(`Dict FAB menu: "Legend" item MUST NOT appear on Dictionary view. Items: ${JSON.stringify(dictItems)}`);
  }
  note('OK dict: no "Legend" item');

  // B: NO minimap toggle on dict
  const dictHasMinimap = dictItems.some(t => t.toLowerCase().includes('minimap'));
  if (dictHasMinimap) {
    fail(`Dict FAB menu: minimap toggle MUST NOT appear on Dictionary view. Items: ${JSON.stringify(dictItems)}`);
  }
  note('OK dict: no minimap toggle item');

  // C: flow nav item reads "Data Flows" (not "Flows")
  if (dictItems.includes('Flows')) {
    fail(`Dict FAB menu: flow nav item reads "Flows" — must be "Data Flows". Items: ${JSON.stringify(dictItems)}`);
  }
  if (!dictItems.includes('Data Flows')) {
    fail(`Dict FAB menu: no "Data Flows" nav item found. Items: ${JSON.stringify(dictItems)}`);
  }
  note('OK dict: flow nav item reads "Data Flows"');

  // E: order check — view-switch items before per-view items before Copy link
  const dataGraphIdx = dictItems.indexOf('Data Graph');
  const dataFlowsIdx = dictItems.indexOf('Data Flows');
  const toggleSidebarIdx = dictItems.indexOf('Toggle sidebar');
  const copyLinkIdx = dictItems.indexOf('Copy link');

  note(`Dict item indices — Data Graph: ${dataGraphIdx}, Data Flows: ${dataFlowsIdx}, Toggle sidebar: ${toggleSidebarIdx}, Copy link: ${copyLinkIdx}`);

  if (dataGraphIdx < 0) fail(`Dict FAB: "Data Graph" item not found. Items: ${JSON.stringify(dictItems)}`);
  if (dataFlowsIdx < 0) fail(`Dict FAB: "Data Flows" item not found. Items: ${JSON.stringify(dictItems)}`);
  if (toggleSidebarIdx < 0) fail(`Dict FAB: "Toggle sidebar" item not found. Items: ${JSON.stringify(dictItems)}`);
  if (copyLinkIdx < 0) fail(`Dict FAB: "Copy link" item not found. Items: ${JSON.stringify(dictItems)}`);

  // View-switch items before per-view items
  if (dataGraphIdx > toggleSidebarIdx) {
    fail(`Dict FAB order: "Data Graph" (${dataGraphIdx}) should appear before "Toggle sidebar" (${toggleSidebarIdx})`);
  }
  if (dataFlowsIdx > toggleSidebarIdx) {
    fail(`Dict FAB order: "Data Flows" (${dataFlowsIdx}) should appear before "Toggle sidebar" (${toggleSidebarIdx})`);
  }
  // Copy link last
  if (copyLinkIdx < toggleSidebarIdx) {
    fail(`Dict FAB order: "Copy link" (${copyLinkIdx}) should appear after "Toggle sidebar" (${toggleSidebarIdx})`);
  }
  note('OK dict: item order correct (view-switch → per-view → Copy link)');

  await closeFab();

  // ── Screenshot size sanity ────────────────────────────────────────────────
  note('\n── Screenshot size check ────────────────────────────────────────────────');
  const shots = [shotGraph, shotFlow, shotDict];
  for (const s of shots) {
    const f = Bun.file(s);
    const name = s.split('/').pop() ?? s;
    note(`  ${name}: ${f.size} bytes`);
    if (f.size < 5_000) fail(`Screenshot ${name} suspiciously small (< 5 KB)`);
  }

  note('\nAll CP2 FAB menu correctness checks PASSED.');
  note(`Screenshots saved to ${TMP}/`);

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP2 visual check PASSED.');
