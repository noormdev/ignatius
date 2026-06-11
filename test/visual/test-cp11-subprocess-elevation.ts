/**
 * Visual verification: DFD subprocess elevated affordance (CP11).
 *
 * Proves:
 *  1. A process WITH a sub-DFD (Create Sales Order in order-to-cash) renders with
 *     the stacked-card elevation: its <g data-has-sub-dfd="true"> contains at
 *     least two <rect> elements (the two offset shadow cards + the main card).
 *  2. A leaf process (Collect Payment — no sub-DFD directory) does NOT have the
 *     elevation attribute.
 *  3. Both checks hold in dark mode AND light mode.
 *  4. Screenshots are taken and saved for visual inspection.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ─────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', '7474'],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

async function waitForServer(url: string, timeout = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      // server not up yet — expected during the poll loop; retry until the deadline
    }
    await Bun.sleep(200);
  }
  return false;
}

const serverReady = await waitForServer('http://localhost:7474', 10_000);
if (!serverReady) fail('Server did not start within 10 seconds');
note('Server ready at http://localhost:7474');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function assertFlowReady(ctx: string): Promise<void> {
  const ok = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail(`__IGNATIUS_FLOW_READY__ did not become true ${ctx}`);
  note(`Flow ready: ${ctx}`);
}

async function assertCyDefined(ctx: string): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 12_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail(`__IGNATIUS_CY__ not defined ${ctx}`);
  note(`CY defined: ${ctx}`);
}

async function clickErdFabItem(label: string): Promise<void> {
  const fab = page.locator('.fab');
  if (await fab.count() === 0) fail(`ERD FAB (.fab) not found when clicking "${label}"`);
  await fab.click();
  await page.waitForTimeout(300);
  const item = page.getByRole('menuitem', { name: label, exact: true });
  if (await item.count() === 0) fail(`ERD FAB item "${label}" not found`);
  await item.click();
  await page.waitForTimeout(500);
}

async function toggleTheme(): Promise<void> {
  const byTitle = page.locator('button[title="Switch to light mode"], button[title="Switch to dark mode"]');
  const count = await byTitle.count();
  if (count === 0) fail('Theme toggle button not found');
  await byTitle.first().click();
  await page.waitForTimeout(400);
}

/**
 * Assert that the process node for `processId` has (or does not have) the
 * elevation affordance — i.e. data-has-sub-dfd="true" and >= 3 <rect> children
 * in its <g>.
 */
async function assertElevation(processId: string, expectElevated: boolean, ctx: string): Promise<void> {
  const result = await page.evaluate(
    ({ pid, elevated }: { pid: string; elevated: boolean }) => {
      // The inner ProcessNode <g> has data-node-id and data-node-type="process".
      const g = document.querySelector(`[data-node-type="process"][data-node-id="${pid}"]`);
      if (!g) return { found: false, hasSubDfdAttr: false, rectCount: 0 };
      const hasSubDfdAttr = g.getAttribute('data-has-sub-dfd') === 'true';
      const rectCount = g.querySelectorAll('rect').length;
      return { found: true, hasSubDfdAttr, rectCount };
    },
    { pid: processId, elevated: expectElevated },
  );

  if (!result.found) fail(`Process node data-node-id="${processId}" not found in DOM ${ctx}`);

  if (expectElevated) {
    if (!result.hasSubDfdAttr) {
      fail(`Expected data-has-sub-dfd="true" on process "${processId}" ${ctx}, got false`);
    }
    // Elevated node should have 3 rects: 2 shadow cards + 1 main card
    if (result.rectCount < 3) {
      fail(`Expected >= 3 <rect> in elevated process "${processId}" ${ctx} (got ${result.rectCount})`);
    }
    note(`Elevation confirmed on "${processId}" ${ctx}: data-has-sub-dfd=true, rects=${result.rectCount}`);
  } else {
    if (result.hasSubDfdAttr) {
      fail(`Process "${processId}" ${ctx} should NOT be elevated but has data-has-sub-dfd="true"`);
    }
    // Leaf node should have exactly 1 rect
    if (result.rectCount !== 1) {
      fail(`Leaf process "${processId}" ${ctx} should have 1 <rect> (got ${result.rectCount})`);
    }
    note(`Leaf confirmed for "${processId}" ${ctx}: no elevation, rects=${result.rectCount}`);
  }
}

// ── Test ─────────────────────────────────────────────────────────────────────

try {
  await page.goto('http://localhost:7474/');
  await page.waitForLoadState('domcontentloaded');
  await assertCyDefined('on boot');

  // Switch to Flows view
  await clickErdFabItem('Data Flows');
  await page.waitForFunction(
    () => location.hash.includes('view=flow'),
    { timeout: 5_000 },
  );
  await assertFlowReady('after switching to Flows');

  // The default DFD should be order-to-cash. If not, explicitly select it.
  const activeAtStart = await page.evaluate(
    () => (window as { __IGNATIUS_ACTIVE_FLOW_DFD__?: string }).__IGNATIUS_ACTIVE_FLOW_DFD__,
  );
  note(`Active DFD at start: ${activeAtStart ?? 'none'}`);

  if (activeAtStart !== 'order-to-cash') {
    // Find and click the order-to-cash selector button
    const btn = page.locator('button', { hasText: 'order-to-cash' });
    const cnt = await btn.count();
    if (cnt === 0) fail('Could not find order-to-cash selector button');
    await btn.first().click();
    await page.waitForTimeout(600);
    await assertFlowReady('after selecting order-to-cash');
  }

  // ── Dark mode: check parent process (Create-Sales-Order) and leaf (Collect-Payment) ──

  await assertElevation('Create-Sales-Order', true, '(dark mode)');
  await assertElevation('Collect-Payment', false, '(dark mode)');

  const darkShot = join(TMP, 'cp11-subprocess-elevation-dark.png');
  await page.screenshot({ path: darkShot });
  note(`Dark screenshot: ${darkShot}`);

  // ── Toggle to light mode, re-verify ──────────────────────────────────────

  await toggleTheme();

  await assertElevation('Create-Sales-Order', true, '(light mode)');
  await assertElevation('Collect-Payment', false, '(light mode)');

  const lightShot = join(TMP, 'cp11-subprocess-elevation-light.png');
  await page.screenshot({ path: lightShot });
  note(`Light screenshot: ${lightShot}`);

  // ── File size sanity ─────────────────────────────────────────────────────
  const darkFile = Bun.file(darkShot);
  const lightFile = Bun.file(lightShot);
  if (darkFile.size < 5000) fail(`Dark screenshot suspiciously small (${darkFile.size} bytes)`);
  if (lightFile.size < 5000) fail(`Light screenshot suspiciously small (${lightFile.size} bytes)`);
  note(`Dark screenshot: ${darkFile.size} bytes — OK`);
  note(`Light screenshot: ${lightFile.size} bytes — OK`);

  note('\nAll CP11 checks PASSED.');
  note(`Screenshots saved to ${TMP}/:`);
  note('  cp11-subprocess-elevation-dark.png   — inspect: Create-Sales-Order has stacked cards, Collect-Payment does not');
  note('  cp11-subprocess-elevation-light.png  — same in light mode');

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP11 subprocess elevation visual check PASSED.');
