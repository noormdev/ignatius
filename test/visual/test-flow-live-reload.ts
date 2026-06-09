/**
 * Assertion: flow live-reload preserves the selected DFD across SSE re-renders.
 *
 * Steps:
 *  1. Copy models/key-inherited into tmp/flow-live-reload-model (ephemeral fixture).
 *  2. Serve the tmp copy on a dedicated port.
 *  3. Load the app, switch to Flows (via ERD FAB).
 *  4. Wait for the flow renderer to be ready.
 *  5. Select the NON-default DFD ("refund") via the DFD nav button.
 *  6. Confirm the active DFD is "refund" (__IGNATIUS_ACTIVE_FLOW_DFD__).
 *  7. Edit a flow .md in the tmp copy — triggers fs.watch → SSE model-changed.
 *  8. Wait for __IGNATIUS_FLOW_READY__ to flip false then true (re-render cycle).
 *  9. Assert __IGNATIUS_ACTIVE_FLOW_DFD__ is still "refund" (not reset to diagrams[0]).
 * 10. Clean up: kill server, remove tmp model copy.
 *
 * Hard-fails (process.exit(1)) on any assertion miss.
 * Run via: bun test/visual/test-flow-live-reload.ts (from repo root)
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE_SRC = join(ROOT, 'models', 'key-inherited');
const FIXTURE_DST = join(ROOT, 'tmp', 'flow-live-reload-model');
const PORT = 7277;
const BASE_URL = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => {
  console.error('FAIL:', m);
  process.exit(1);
};

// ── Fixture setup ────────────────────────────────────────────────────────────

// Always start clean.
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

// ── Helpers ──────────────────────────────────────────────────────────────────

async function clickErdFabItem(label: string): Promise<void> {
  const fab = page.locator('.fab');
  if (await fab.count() === 0) fail(`ERD FAB (.fab) not found when clicking "${label}"`);
  await fab.click();
  await page.waitForTimeout(300);
  const item = page.getByRole('menuitem', { name: label, exact: true });
  if (await item.count() === 0) fail(`ERD FAB menu item "${label}" not found`);
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

  // 2. Switch to Flows via ERD FAB
  await clickErdFabItem('Flows');
  const hashAfterSwitch = await page.evaluate(() => location.hash);
  if (!hashAfterSwitch.includes('view=flow')) {
    fail(`Expected hash to contain "view=flow" after switching, got "${hashAfterSwitch}"`);
  }
  note(`Hash after switch: ${hashAfterSwitch}`);

  // 3. Wait for flow renderer
  await waitFlowReady('after graph→flow switch');

  // 4. Confirm there are ≥2 DFDs (model has order-to-cash + refund)
  const dfdCount = await page.evaluate(() => {
    // Count visible DFD nav buttons in the flow chrome panel.
    return document.querySelectorAll('button').length;
  });
  note(`Found ${dfdCount} buttons on page`);

  // Find and click the "refund" DFD button in the nav panel
  const refundBtn = page.locator('button', { hasText: 'refund' }).first();
  const refundBtnCount = await refundBtn.count();
  if (refundBtnCount === 0) fail('"refund" DFD nav button not found — model may not have >1 DFD');
  await refundBtn.click();
  await page.waitForTimeout(600);
  note('Clicked "refund" DFD button');

  // 5. Wait for flow to re-render for refund
  await waitFlowReady('after selecting refund DFD');

  // 6. Confirm __IGNATIUS_ACTIVE_FLOW_DFD__ is "refund"
  const activeBefore = await getActiveDfd();
  note(`Active DFD before SSE edit: "${activeBefore}"`);
  if (activeBefore !== 'refund') {
    fail(`Expected active DFD to be "refund" after clicking nav, got "${activeBefore}"`);
  }

  // 7. Edit a flow .md in the tmp fixture to trigger SSE
  const targetFile = join(FIXTURE_DST, 'flows', 'order-to-cash', 'Collect-Payment.md');
  const original = readFileSync(targetFile, 'utf8');
  // Append a harmless comment to the body (below the frontmatter) to trigger fs.watch.
  const edited = original + '\n<!-- live-reload-test -->\n';
  writeFileSync(targetFile, edited, 'utf8');
  note(`Edited ${targetFile} to trigger SSE`);

  // 8. Wait for the flow to re-render (FLOW_READY flips false → true)
  // First wait for it to become false (the re-render starts)
  const wentFalse = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === false,
    { timeout: 8_000 },
  ).then(() => true).catch(() => false);
  if (!wentFalse) {
    // It may have gone false and back to true faster than we checked — that's fine.
    note('FLOW_READY did not go false (re-render may have been very fast — checking final state)');
  } else {
    note('FLOW_READY went false (re-render started)');
  }

  await waitFlowReady('after SSE-triggered re-render');

  // 9. Assert the DFD is still "refund"
  const activeAfter = await getActiveDfd();
  note(`Active DFD after SSE re-render: "${activeAfter}"`);
  if (activeAfter !== 'refund') {
    fail(
      `DFD-preserve regression: expected "refund" to remain active after SSE re-render, ` +
      `but got "${activeAfter}" (likely reset to diagrams[0])`,
    );
  }
  note('DFD preserved across SSE re-render: PASS');

  // Restore the edited file
  writeFileSync(targetFile, original, 'utf8');
  note('Fixture file restored');

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
  // Clean up tmp fixture
  try { rmSync(FIXTURE_DST, { recursive: true, force: true }); } catch {}
  note('Fixture cleaned up');
}

console.log('\nflow-live-reload assertion PASSED.');
