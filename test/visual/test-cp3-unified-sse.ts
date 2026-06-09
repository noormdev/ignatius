/**
 * CP3 assertion: single data load + unified SSE.
 *
 * Steps:
 *  1. Copy models/key-inherited into tmp/cp3-unified-sse-model (ephemeral fixture).
 *  2. Serve the tmp copy on a dedicated port.
 *  3. Patch window.EventSource to count instantiations before app scripts run.
 *  4. Load the app; assert exactly ONE EventSource created (not two).
 *  5. Wait for ERD graph ready (__IGNATIUS_CY__).
 *  6. Entity-edit leg: edit an entity .md → assert graph live-reloads (model state changes).
 *  7. Switch to Flows via FAB; wait for flow renderer (__IGNATIUS_FLOW_READY__).
 *  8. Select the "refund" DFD.
 *  9. Flow-edit leg: edit a flow .md → assert flow live-reloads (FLOW_READY cycles).
 * 10. Assert selected DFD is still "refund" (CP1 invariant preserved).
 * 11. Clean up: kill server, remove tmp model copy.
 *
 * Hard-fails (process.exit(1)) on any assertion miss.
 * Run via: bun test/visual/test-cp3-unified-sse.ts (from repo root)
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { rmSync, cpSync, writeFileSync, readFileSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE_SRC = join(ROOT, 'models', 'key-inherited');
const FIXTURE_DST = join(ROOT, 'tmp', 'cp3-unified-sse-model');
const PORT = 7281;
const BASE_URL = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => {
  console.error('FAIL:', m);
  process.exit(1);
};

// ── Fixture setup ────────────────────────────────────────────────────────────

try { rmSync(FIXTURE_DST, { recursive: true, force: true }); } catch {}
cpSync(FIXTURE_SRC, FIXTURE_DST, { recursive: true });
note(`Fixture copied: ${FIXTURE_DST}`);

// ── Server ───────────────────────────────────────────────────────────────────

note(`Starting ignatius serve ${FIXTURE_DST} on port ${PORT}…`);
const proc = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', FIXTURE_DST, '--port', String(PORT)],
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

const serverReady = await waitForServer(BASE_URL, 12_000);
if (!serverReady) {
  rmSync(FIXTURE_DST, { recursive: true, force: true });
  fail('Server did not start within 12 seconds');
}
note(`Server ready at ${BASE_URL}`);

// ── Playwright ───────────────────────────────────────────────────────────────

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Patch EventSource BEFORE the page loads so we can count how many are created.
// We inject a script that wraps the native EventSource constructor and tracks
// instantiation count in window.__ES_INSTANCE_COUNT__.
await page.addInitScript(`
  (function() {
    const OrigES = window.EventSource;
    let count = 0;
    window.__ES_INSTANCE_COUNT__ = 0;
    window.EventSource = function(url, opts) {
      count++;
      window.__ES_INSTANCE_COUNT__ = count;
      return new OrigES(url, opts);
    };
    window.EventSource.prototype = OrigES.prototype;
    window.EventSource.CONNECTING = OrigES.CONNECTING;
    window.EventSource.OPEN = OrigES.OPEN;
    window.EventSource.CLOSED = OrigES.CLOSED;
  })();
`);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function clickFabItem(label: string): Promise<void> {
  const fab = page.locator('.fab');
  if (await fab.count() === 0) fail(`FAB (.fab) not found when clicking "${label}"`);
  await fab.click();
  await page.waitForTimeout(300);
  const item = page.getByRole('menuitem', { name: label, exact: true });
  if (await item.count() === 0) fail(`FAB menu item "${label}" not found`);
  await item.click();
  await page.waitForTimeout(500);
}

async function waitFlowReady(ctx: string): Promise<void> {
  const ok = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail(`__IGNATIUS_FLOW_READY__ did not become true ${ctx}`);
  note(`__IGNATIUS_FLOW_READY__ = true: ${ctx}`);
}

async function getActiveDfd(): Promise<string | undefined> {
  return page.evaluate(
    () => (window as { __IGNATIUS_ACTIVE_FLOW_DFD__?: string }).__IGNATIUS_ACTIVE_FLOW_DFD__,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

try {
  await page.goto(BASE_URL);
  await page.waitForLoadState('domcontentloaded');

  // 1. Wait for ERD graph (confirms live mode + initial model load)
  await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 15_000 },
  );
  note('ERD graph ready');

  // 2. Assert at most 2 EventSource instances created.
  //    React StrictMode (dev build) double-mounts effects — the first cleanup
  //    closes the instance and a second is opened. So in dev the ceiling is 2
  //    (one effect = 2 mounts). In production it would be 1. Before CP3 this
  //    was 4 (two separate effects × 2 StrictMode mounts). We assert ≤ 2 which
  //    proves we have a single unified subscription (not two).
  const esCount = await page.evaluate(
    () => (window as { __ES_INSTANCE_COUNT__?: number }).__ES_INSTANCE_COUNT__ ?? 0,
  );
  note(`EventSource instances created: ${esCount} (≤2 expected; was 4 pre-CP3)`);
  if (esCount > 2) {
    fail(
      `Expected at most 2 EventSource instances (1 unified effect under StrictMode), got ${esCount}. ` +
      `CP3 regression: more than one SSE effect is running.`,
    );
  }
  note('Single-effect EventSource assertion: PASS');

  // 3. Entity-edit leg: edit an entity .md to trigger SSE model-changed
  //    Capture node count before edit to detect a live refresh (the model reloads).
  const nodeCountBefore = await page.evaluate(() => {
    const cy = (window as { __IGNATIUS_CY__?: { nodes: () => { length: number } } }).__IGNATIUS_CY__;
    return cy ? cy.nodes().length : -1;
  });
  note(`ERD node count before entity edit: ${nodeCountBefore}`);

  // Capture the generation counter BEFORE the edit. The ERD renderer increments
  // window.__IGNATIUS_CY_GEN__ each time a new Cytoscape instance is created.
  // React's effect cleanup+rebuild cycle may happen too fast for polling to catch
  // the undefined state, but the generation counter survives the race: it only
  // ever increases, so waiting for it to exceed cyGenBefore proves a rebuild fired.
  const cyGenBefore = await page.evaluate(
    () => (window as { __IGNATIUS_CY_GEN__?: number }).__IGNATIUS_CY_GEN__ ?? 0,
  );
  note(`CY generation before entity edit: ${cyGenBefore}`);

  // Edit the Party entity body to trigger an SSE reload
  const customerFile = join(FIXTURE_DST, 'identity', 'Party.md');
  const customerOrig = readFileSync(customerFile, 'utf8');
  writeFileSync(customerFile, customerOrig + '\n<!-- cp3-entity-test -->\n', 'utf8');
  note(`Edited ${customerFile} (Party entity) to trigger SSE`);

  // Wait for the generation counter to increment (rebuild detected).
  // If SSE never fires / the graph never rebuilds, this will time out → hard fail.
  const rebuildSeen = await page.waitForFunction(
    ([gen]: [number]) =>
      ((window as { __IGNATIUS_CY_GEN__?: number }).__IGNATIUS_CY_GEN__ ?? 0) > gen,
    [cyGenBefore] as [number],
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!rebuildSeen) {
    fail(
      `ERD graph did not rebuild after entity .md edit (CY generation stayed at ${cyGenBefore}). ` +
      'SSE never delivered or the ERD effect did not re-run.',
    );
  }

  const cyGenAfter = await page.evaluate(
    () => (window as { __IGNATIUS_CY_GEN__?: number }).__IGNATIUS_CY_GEN__ ?? 0,
  );
  note(`CY generation after entity edit: ${cyGenAfter} (was ${cyGenBefore}) — rebuild confirmed`);

  // Confirm the rebuilt graph has a non-zero node count (not a degenerate rebuild).
  // Restore AFTER asserting edited state so a second SSE rebuild can't race the check.
  const nodeCountAfter = await page.evaluate(() => {
    const cy = (window as { __IGNATIUS_CY__?: { nodes: () => { length: number } } }).__IGNATIUS_CY__;
    return cy ? cy.nodes().length : -1;
  });
  note(`ERD node count after entity edit: ${nodeCountAfter} (was ${nodeCountBefore})`);
  if (nodeCountAfter <= 0) {
    fail(`ERD rebuild produced ${nodeCountAfter} nodes — degenerate rebuild after live reload`);
  }
  note('Entity-edit live-reload leg: PASS (generation counter incremented, non-zero nodes)');

  // Restore the customer file after all assertions on edited state are complete
  writeFileSync(customerFile, customerOrig, 'utf8');
  note('Customer.md restored');

  // 4. Switch to Flows via FAB
  await clickFabItem('Flows');
  const hashAfterSwitch = await page.evaluate(() => location.hash);
  if (!hashAfterSwitch.includes('view=flow')) {
    fail(`Expected hash to contain "view=flow" after switch, got "${hashAfterSwitch}"`);
  }
  note(`Hash after Flows switch: ${hashAfterSwitch}`);

  // 5. Wait for flow renderer
  await waitFlowReady('after graph→flow switch');

  // 6. Select the "refund" DFD
  const refundBtn = page.locator('button', { hasText: 'refund' }).first();
  if (await refundBtn.count() === 0) fail('"refund" DFD nav button not found');
  await refundBtn.click();
  await page.waitForTimeout(600);
  note('Clicked "refund" DFD button');
  await waitFlowReady('after selecting refund DFD');

  const activeBefore = await getActiveDfd();
  note(`Active DFD before flow edit: "${activeBefore}"`);
  if (activeBefore !== 'refund') {
    fail(`Expected active DFD "refund", got "${activeBefore}"`);
  }

  // 7. Flow-edit leg: edit a flow .md to trigger SSE → flow live-reload.
  // Capture the flow generation counter before the edit. The renderer increments
  // __IGNATIUS_FLOW_GEN__ each time FLOW_READY goes true. Waiting for the counter
  // to exceed flowGenBefore proves a full re-render cycle happened without relying
  // on the false→true transition being observable via polling.
  const flowGenBefore = await page.evaluate(
    () => (window as { __IGNATIUS_FLOW_GEN__?: number }).__IGNATIUS_FLOW_GEN__ ?? 0,
  );
  note(`Flow generation before flow edit: ${flowGenBefore}`);

  const flowFile = join(FIXTURE_DST, 'flows', 'order-to-cash', 'Collect-Payment.md');
  const flowOrig = readFileSync(flowFile, 'utf8');
  writeFileSync(flowFile, flowOrig + '\n<!-- cp3-flow-test -->\n', 'utf8');
  note(`Edited ${flowFile} (flow) to trigger SSE`);

  // Wait for the flow generation counter to increment (re-render detected).
  // If SSE never fires / the flow renderer never re-runs, this times out → hard fail.
  const flowRebuildSeen = await page.waitForFunction(
    ([gen]: [number]) =>
      ((window as { __IGNATIUS_FLOW_GEN__?: number }).__IGNATIUS_FLOW_GEN__ ?? 0) > gen,
    [flowGenBefore] as [number],
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!flowRebuildSeen) {
    fail(
      `Flow renderer did not re-render after flow .md edit (FLOW_GEN stayed at ${flowGenBefore}). ` +
      'SSE did not deliver or the flow effect did not re-run.',
    );
  }

  const flowGenAfter = await page.evaluate(
    () => (window as { __IGNATIUS_FLOW_GEN__?: number }).__IGNATIUS_FLOW_GEN__ ?? 0,
  );
  note(`Flow generation after flow edit: ${flowGenAfter} (was ${flowGenBefore}) — re-render confirmed`);

  await waitFlowReady('after flow-edit SSE re-render');

  // 8. Assert DFD preserved
  const activeAfter = await getActiveDfd();
  note(`Active DFD after flow-edit SSE: "${activeAfter}"`);
  if (activeAfter !== 'refund') {
    fail(
      `DFD-preserve regression: expected "refund" after flow SSE re-render, got "${activeAfter}"`,
    );
  }
  note('Flow-edit live-reload + DFD-preserve leg: PASS');

  // 9. Confirm EventSource count did NOT grow during the test (no subscription leak).
  //    It should still be ≤2 (same StrictMode ceiling as at boot).
  const esFinal = await page.evaluate(
    () => (window as { __ES_INSTANCE_COUNT__?: number }).__ES_INSTANCE_COUNT__ ?? 0,
  );
  note(`EventSource instances at end: ${esFinal}`);
  if (esFinal > 2) {
    fail(`EventSource count grew to ${esFinal} during test — subscription leak detected.`);
  }
  note('No EventSource leak: PASS');

  // Restore the flow file
  writeFileSync(flowFile, flowOrig, 'utf8');
  note('Flow file restored');

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
  try { rmSync(FIXTURE_DST, { recursive: true, force: true }); } catch {}
  note('Fixture cleaned up');
}

console.log('\ncp3-unified-sse assertion PASSED.');
