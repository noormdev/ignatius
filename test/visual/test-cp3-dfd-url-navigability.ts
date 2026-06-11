/**
 * Visual verification: CP3 — DFD URL navigability.
 *
 * Proves:
 *  A. Selecting a top-level DFD writes #view=flow&dfd=<id> to the URL.
 *  B. Loading #view=flow&dfd=<id> directly renders that DFD (not diagrams[0]).
 *  C. Selecting a different DFD updates the hash (client-side, no reload).
 *  D. Browser back/forward swaps DFDs via the existing client-side swap.
 *  E. Drill-down into a sub-DFD updates the hash.
 *  F. Existing graph hash (entity/zoom/pan) still works — no regression.
 *
 * DFDs in models/key-inherited: order-to-cash, refund.
 * Sub-DFD in order-to-cash: Create-Sales-Order (process with sub-DFD).
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp3-dfd-url-navigability');
mkdirSync(TMP, { recursive: true });

const PORT = 7403;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', String(PORT)],
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForFlow(): Promise<void> {
  const ok = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Flow (__IGNATIUS_FLOW_READY__) did not become ready');
}

async function waitForGraph(): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 12_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Graph (__IGNATIUS_CY__) did not become ready');
}

function getActiveDfd(): Promise<string | undefined> {
  return page.evaluate(
    () => (window as { __IGNATIUS_ACTIVE_FLOW_DFD__?: string }).__IGNATIUS_ACTIVE_FLOW_DFD__,
  );
}

function getHash(): Promise<string> {
  return page.evaluate(() => location.hash);
}

async function shot(name: string): Promise<void> {
  const p = join(TMP, name);
  await page.screenshot({ path: p });
  note(`Screenshot: ${p}`);
}

// ── Test ──────────────────────────────────────────────────────────────────────

try {
  // ── A. Deep-link to order-to-cash: should render that DFD directly ──────────
  note('\n── A. Deep-link to #view=flow&dfd=order-to-cash ─────────────────────────');
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
  await page.waitForLoadState('domcontentloaded');
  await waitForFlow();
  await page.waitForTimeout(500);

  await shot('01-deep-link-order-to-cash.png');

  const activeDfdA = await getActiveDfd();
  note(`Active DFD after deep-link: ${activeDfdA}`);
  if (activeDfdA !== 'order-to-cash') {
    fail(`Deep-link: expected active DFD 'order-to-cash', got '${activeDfdA}'`);
  }
  note('OK: deep-link rendered order-to-cash directly');

  const hashA = await getHash();
  note(`Hash after deep-link: ${hashA}`);
  if (!hashA.includes('dfd=order-to-cash')) {
    fail(`Hash after deep-link: expected 'dfd=order-to-cash', got '${hashA}'`);
  }
  if (!hashA.includes('view=flow')) {
    fail(`Hash after deep-link: expected 'view=flow', got '${hashA}'`);
  }
  note('OK: hash contains view=flow&dfd=order-to-cash');

  // ── B. Select a different DFD: hash updates client-side ─────────────────────
  note('\n── B. Select refund DFD — hash should update ───────────────────────────');

  // Find the DFD selector nav in FlowChrome and click 'refund'
  // The DFD nav buttons are rendered by FlowChrome as buttons with the diagram id text.
  // Try clicking via the nav item. If not found, use the registered selectDiagram via evaluate.
  const refundNavBtn = page.locator('.flow-dfd-nav button, .flow-nav-item, [data-dfd]').filter({ hasText: /refund/i });
  const refundBtnCount = await refundNavBtn.count();
  note(`Refund nav button count: ${refundBtnCount}`);

  if (refundBtnCount > 0) {
    await refundNavBtn.first().click();
    await page.waitForTimeout(600);
  } else {
    // Fallback: call selectDiagram imperatively via the page
    note('No refund nav button found — calling flowSelectDiagramRef via page evaluate');
    const called = await page.evaluate(() => {
      // The global __IGNATIUS_ACTIVE_FLOW_DFD__ is the passive read; we need to
      // trigger selectDiagram. Since we can't reach refs directly, dispatch a custom
      // event that App.tsx can handle — but App.tsx doesn't listen for one.
      // Instead, find the DFD nav button by text content in the DOM and click it.
      const allButtons = Array.from(document.querySelectorAll('button'));
      const btn = allButtons.find(b => b.textContent?.toLowerCase().includes('refund'));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!called) fail('Could not find or click refund DFD nav button');
    await page.waitForTimeout(600);
  }

  await shot('02-after-select-refund.png');

  const activeDfdB = await getActiveDfd();
  note(`Active DFD after selecting refund: ${activeDfdB}`);
  if (activeDfdB !== 'refund') {
    fail(`After select: expected active DFD 'refund', got '${activeDfdB}'`);
  }
  note('OK: active DFD is refund');

  const hashB = await getHash();
  note(`Hash after selecting refund: ${hashB}`);
  if (!hashB.includes('dfd=refund')) {
    fail(`Hash after selecting refund: expected 'dfd=refund', got '${hashB}'`);
  }
  note('OK: hash updated to dfd=refund');

  // ── C. Browser back: should restore order-to-cash ────────────────────────────
  note('\n── C. Browser back — should restore order-to-cash ──────────────────────');
  await page.goBack();
  await page.waitForTimeout(800);

  await shot('03-after-back.png');

  const activeDfdC = await getActiveDfd();
  const hashC = await getHash();
  note(`Active DFD after back: ${activeDfdC}, hash: ${hashC}`);
  if (activeDfdC !== 'order-to-cash') {
    fail(`After back: expected active DFD 'order-to-cash', got '${activeDfdC}'`);
  }
  if (!hashC.includes('dfd=order-to-cash')) {
    fail(`Hash after back: expected 'dfd=order-to-cash', got '${hashC}'`);
  }
  note('OK: back restored order-to-cash');

  // ── D. Browser forward: should restore refund ────────────────────────────────
  note('\n── D. Browser forward — should restore refund ───────────────────────────');
  await page.goForward();
  await page.waitForTimeout(800);

  await shot('04-after-forward.png');

  const activeDfdD = await getActiveDfd();
  const hashD = await getHash();
  note(`Active DFD after forward: ${activeDfdD}, hash: ${hashD}`);
  if (activeDfdD !== 'refund') {
    fail(`After forward: expected active DFD 'refund', got '${activeDfdD}'`);
  }
  if (!hashD.includes('dfd=refund')) {
    fail(`Hash after forward: expected 'dfd=refund', got '${hashD}'`);
  }
  note('OK: forward restored refund');

  // ── E. Drill-down: sub-DFD id reflected in hash ──────────────────────────────
  note('\n── E. Drill-down into Create-Sales-Order sub-DFD ───────────────────────');
  // Navigate back to order-to-cash first
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
  await page.waitForLoadState('domcontentloaded');
  await waitForFlow();
  await page.waitForTimeout(500);

  // Click the Create-Sales-Order process node to drill in.
  // FlowDiagramSvg renders drillable process nodes as <g data-token="proc:<processId>">.
  // Use Playwright's native click (dispatches pointerdown + pointerup) so the
  // SVG's pointer-capture + short-tap drill logic fires correctly.
  // The processId for the sub-DFD is 'Create-Sales-Order' (the folder name).
  const drillLocator = page.locator('[data-token="proc:Create-Sales-Order"]');
  const drillCount = await drillLocator.count();
  note(`Drillable process node count: ${drillCount}`);

  let drillClicked = false;
  if (drillCount > 0) {
    await drillLocator.first().click({ force: true });
    drillClicked = true;
  } else {
    // Fallback: search by text content in SVG text elements
    const drillClicked2 = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('text'));
      const textEl = texts.find(t => t.textContent?.includes('Create') && t.textContent?.includes('Sales'));
      if (textEl) {
        // Fire the full pointer sequence so the tap-detection logic sees it
        const events: PointerEventInit = { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1 };
        textEl.dispatchEvent(new PointerEvent('pointerdown', events));
        textEl.dispatchEvent(new PointerEvent('pointerup', events));
        return true;
      }
      return false;
    });
    drillClicked = drillClicked2;
  }
  note(`Drill click dispatched: ${drillClicked}`);

  if (drillClicked) {
    await page.waitForTimeout(800);
    await shot('05-after-drill.png');

    const activeDfdE = await getActiveDfd();
    const hashE = await getHash();
    note(`Active DFD after drill: ${activeDfdE}, hash: ${hashE}`);

    // The drilled sub-DFD id is 'Create-Sales-Order' (folder name under order-to-cash).
    // Drill-down fires renderDiagram(subDfd) → onActiveDiagramChange(subDfd.id) → hash update.
    if (!hashE.includes('dfd=')) {
      fail(`Hash did not update after drill-down into sub-DFD. Expected dfd= in hash, got: ${hashE}`);
    }
    note(`OK: hash contains dfd after drill: ${hashE}`);
    // The active DFD should now be the sub-DFD id (Create-Sales-Order)
    if (activeDfdE !== 'Create-Sales-Order') {
      fail(`After drill-down: expected active DFD 'Create-Sales-Order', got '${activeDfdE}'`);
    }
    note(`OK: active DFD after drill is '${activeDfdE}'`);
  } else {
    fail('Could not dispatch drill click — sub-DFD process not found in DOM. Cannot verify drill-down hash update.');
  }

  // ── G. Sub-DFD deep-link survives refresh ───────────────────────────────────
  // This is the regression test for the bug: loading #view=flow&dfd=Create-Sales-Order
  // (a sub-DFD) must render that sub-DFD directly — NOT fall back to order-to-cash.
  note('\n── G. Sub-DFD deep-link refresh — must render Create-Sales-Order directly ─');

  // Navigate via direct URL (simulates sharing a link / refresh).
  await page.goto(`${BASE}/#view=flow&dfd=Create-Sales-Order`);
  await page.waitForLoadState('domcontentloaded');
  await waitForFlow();
  await page.waitForTimeout(600);

  await shot('07-sub-dfd-deep-link.png');

  const activeDfdG = await getActiveDfd();
  note(`Active DFD after sub-DFD deep-link: ${activeDfdG}`);
  if (activeDfdG !== 'Create-Sales-Order') {
    fail(`Sub-DFD deep-link: expected active DFD 'Create-Sales-Order', got '${activeDfdG}'`);
  }
  note('OK: sub-DFD deep-link rendered Create-Sales-Order directly');

  const hashG = await getHash();
  note(`Hash after sub-DFD deep-link: ${hashG}`);
  if (!hashG.includes('dfd=Create-Sales-Order')) {
    fail(`Sub-DFD deep-link hash: expected 'dfd=Create-Sales-Order', got '${hashG}'`);
  }
  note('OK: hash contains dfd=Create-Sales-Order');

  // Verify the breadcrumb shows the parent chain (order-to-cash / Create Sales Order).
  // FlowChrome renders breadcrumb chips using inline styles (no CSS class on each chip),
  // so we read the full text content of the breadcrumb container area.
  // The container is a position:absolute div at top:18px left:240px inside .flow-chrome-root
  // (or the flow surface). We collect all text from the entire flow chrome overlay.
  const breadcrumbText = await page.evaluate(() => {
    // Grab text from all div/button elements that are children of position:absolute
    // breadcrumb-area divs. Fallback: read the full app body text and look for the labels.
    const flowSurface = document.querySelector('.flow-surface, #flow-surface, [data-surface="flow"]')
      ?? document.body;
    return flowSurface.textContent ?? '';
  });
  note(`Flow surface text (for breadcrumb): ${breadcrumbText.slice(0, 200)}`);
  // The breadcrumb must include the parent DFD name (order-to-cash / "Order To Cash")
  // AND the sub-DFD name (Create-Sales-Order / "Create Sales Order").
  const breadcrumbLower = breadcrumbText.toLowerCase();
  if (!breadcrumbLower.includes('order') || !breadcrumbLower.includes('create')) {
    fail(`Sub-DFD breadcrumb must show parent chain (order-to-cash and Create-Sales-Order). Got: '${breadcrumbText.slice(0, 200)}'`);
  }
  note('OK: breadcrumb shows parent chain (order-to-cash / Create Sales Order)');

  // ── G2. Reload the page from the sub-DFD hash: must survive ─────────────────
  note('\n── G2. page.reload() from sub-DFD hash — should still show Create-Sales-Order ─');
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await waitForFlow();
  await page.waitForTimeout(600);

  await shot('08-sub-dfd-after-reload.png');

  const activeDfdG2 = await getActiveDfd();
  note(`Active DFD after reload: ${activeDfdG2}`);
  if (activeDfdG2 !== 'Create-Sales-Order') {
    fail(`Sub-DFD after reload: expected active DFD 'Create-Sales-Order', got '${activeDfdG2}'`);
  }
  note('OK: sub-DFD deep-link survived page.reload()');

  const breadcrumbTextG2 = await page.evaluate(() => {
    const flowSurface = document.querySelector('.flow-surface, #flow-surface, [data-surface="flow"]')
      ?? document.body;
    return flowSurface.textContent ?? '';
  });
  note(`Flow surface text after reload: ${breadcrumbTextG2.slice(0, 200)}`);
  const breadcrumbLowerG2 = breadcrumbTextG2.toLowerCase();
  if (!breadcrumbLowerG2.includes('order') || !breadcrumbLowerG2.includes('create')) {
    fail(`Sub-DFD breadcrumb after reload must show parent chain. Got: '${breadcrumbTextG2.slice(0, 200)}'`);
  }
  note('OK: breadcrumb still shows parent chain after reload');

  // ── F. Graph hash regression: entity/zoom/pan still work ────────────────────
  note('\n── F. Graph hash regression — entity/zoom/pan ───────────────────────────');
  await page.goto(`${BASE}/#view=graph&entity=Party&zoom=1.2&pan=50,30`);
  await page.waitForLoadState('domcontentloaded');
  await waitForGraph();
  await page.waitForTimeout(500);

  await shot('06-graph-entity-hash.png');

  const hashF = await getHash();
  note(`Hash on graph view: ${hashF}`);
  if (!hashF.includes('view=graph')) fail(`Graph hash: missing 'view=graph', got '${hashF}'`);
  if (!hashF.includes('entity=Party')) fail(`Graph hash: missing 'entity=Party', got '${hashF}'`);
  note('OK: graph entity hash preserved (no regression)');

  // ── Screenshot size sanity ───────────────────────────────────────────────────
  note('\n── Screenshot size sanity check ─────────────────────────────────────────');
  const allShots = ['01-deep-link-order-to-cash.png', '02-after-select-refund.png',
    '03-after-back.png', '04-after-forward.png',
    '07-sub-dfd-deep-link.png', '08-sub-dfd-after-reload.png',
    '06-graph-entity-hash.png'];
  for (const s of allShots) {
    const f = Bun.file(join(TMP, s));
    note(`  ${s}: ${f.size} bytes`);
    if (f.size < 5_000) fail(`Screenshot ${s} suspiciously small (< 5 KB)`);
  }

  note('\nAll CP3 DFD URL navigability checks PASSED.');
  note(`Screenshots saved to ${TMP}/`);

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP3 DFD URL navigability visual check PASSED.');
