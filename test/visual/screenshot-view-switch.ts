/**
 * Visual verification: CP1 view-router + render-effect re-key.
 *
 * Starts `ignatius serve models/key-inherited`, navigates to /, then:
 *  1. Waits for the ERD graph to render (window.__IGNATIUS_CY__ defined).
 *  2. Records GET / count — baseline must be 1 (boot).
 *  3. Opens the ERD FAB and clicks "Flows" by text — expects NO second GET /.
 *  4. Asserts hash changes to #view=flow BEFORE any leak check.
 *  5. Asserts __IGNATIUS_CY__ is undefined (cy torn down on leave).
 *  6. Asserts __IGNATIUS_FLOW_READY__ becomes true.
 *  7. Opens the FlowChrome FAB and clicks "Data Graph" by text — switches back.
 *  8. Asserts __IGNATIUS_CY__ defined again (rebuilt on re-enter).
 *  9. Asserts hash changes to #view=graph.
 * 10. Switches graph → flow → graph N=3 more times; each cycle:
 *     a. Opens ERD FAB, clicks "Flows" via text locator.
 *     b. Asserts hash=flow AND __IGNATIUS_CY__ cleared BEFORE leak check.
 *     c. Opens FlowChrome FAB, clicks "Data Graph" via text locator.
 *     d. Asserts hash=graph AND __IGNATIUS_CY__ present.
 *     Fails immediately on any miss — does NOT continue against stale state.
 * 11. Screenshots both graph and flow views.
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

// Start the dev server
note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', '7171'],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

// Wait for server ready
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

const serverReady = await waitForServer('http://localhost:7171', 10_000);
if (!serverReady) fail('Server did not start within 10 seconds');
note('Server ready at http://localhost:7171');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

let getCount = 0;

// Count GET / requests (ignoring assets, API, events)
page.on('request', req => {
  if (req.method() === 'GET' && req.url() === 'http://localhost:7171/') getCount++;
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Open the ERD FAB (.fab button) and click a menu item by its text label. Fails loudly. */
async function clickErdFabItem(label: string): Promise<void> {
  const fab = page.locator('.fab');
  const count = await fab.count();
  if (count === 0) fail(`ERD FAB (.fab) not found when trying to click "${label}"`);
  await fab.click();
  await page.waitForTimeout(300);
  const item = page.getByRole('menuitem', { name: label, exact: true });
  const itemCount = await item.count();
  if (itemCount === 0) fail(`ERD FAB menu item "${label}" not found after opening FAB`);
  await item.click();
  await page.waitForTimeout(500);
}

/** Open the FlowChrome FAB (title="Actions") and click a menu item by text. Fails loudly. */
async function clickFlowFabItem(label: string): Promise<void> {
  // Use CSS attribute selector — more reliable than getByRole when aria-expanded
  // is present alongside a title attribute.
  const fab = page.locator('button[title="Actions"]');
  const count = await fab.count();
  if (count === 0) fail(`FlowChrome FAB (title=Actions) not found when trying to click "${label}"`);
  await fab.click();
  await page.waitForTimeout(300);
  // "Data Graph" button has text "◇ Data Graph"; use substring match
  const item = page.locator('button', { hasText: label });
  const itemCount = await item.count();
  if (itemCount === 0) fail(`FlowChrome FAB item "${label}" not found after opening FAB`);
  await item.first().click();
  await page.waitForTimeout(600);
}

/** Assert the hash contains a given substring. Fails loudly. */
async function assertHash(contains: string): Promise<void> {
  const hash = await page.evaluate(() => location.hash);
  if (!hash.includes(contains)) {
    fail(`Expected location.hash to contain "${contains}" but got "${hash}"`);
  }
  note(`Hash contains "${contains}": ${hash}`);
}

/** Wait for __IGNATIUS_CY__ to be defined. Fails loudly on timeout. */
async function assertCyDefined(context: string): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 12_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail(`__IGNATIUS_CY__ not defined ${context}`);
  note(`__IGNATIUS_CY__ defined: ${context}`);
}

/** Assert __IGNATIUS_CY__ is undefined. Fails loudly. */
async function assertCyCleared(context: string): Promise<void> {
  const cleared = await page.evaluate(
    () => (window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__ === undefined,
  );
  if (!cleared) fail(`__IGNATIUS_CY__ still defined ${context} (cy leak)`);
  note(`__IGNATIUS_CY__ cleared: ${context}`);
}

/** Wait for __IGNATIUS_FLOW_READY__ === true. Fails loudly on timeout. */
async function assertFlowReady(context: string): Promise<void> {
  const ok = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail(`__IGNATIUS_FLOW_READY__ did not become true ${context}`);
  note(`__IGNATIUS_FLOW_READY__ = true: ${context}`);
}

// ── Main ───────────────────────────────────────────────────────────────────

try {
  await page.goto('http://localhost:7171/');
  await page.waitForLoadState('domcontentloaded');

  // 1. Wait for ERD graph
  await assertCyDefined('on boot');

  // 2. Baseline GET / count
  if (getCount !== 1) fail(`Expected 1 GET / on boot, got ${getCount}`);
  note(`Boot GET count: ${getCount} (correct)`);

  // Screenshot: graph view
  const graphShot = join(TMP, 'view-switch-graph.png');
  await page.screenshot({ path: graphShot });
  note(`Graph view screenshot: ${graphShot}`);

  // 3. Switch to Flows via ERD FAB
  const getCountBefore = getCount;
  await clickErdFabItem('Flows');

  // 4. Assert hash changed to flow BEFORE any leak invariant check
  await assertHash('view=flow');

  // 3 (continued). No second GET /
  if (getCount !== getCountBefore) {
    fail(`GET / count changed from ${getCountBefore} to ${getCount} on view switch (full-page reload detected)`);
  }
  note(`No full-page reload on Graph→Flows switch (GET / count stable at ${getCount})`);

  // 5. Assert __IGNATIUS_CY__ cleared (after confirming we're on flow view)
  await assertCyCleared('after switching to Flows');

  // 6. Assert flow renderer ready
  await assertFlowReady('after switching to Flows');

  // Screenshot: flow view
  const flowShot = join(TMP, 'view-switch-flow.png');
  await page.screenshot({ path: flowShot });
  note(`Flow view screenshot: ${flowShot}`);

  // 7. Switch back to Graph via FlowChrome FAB
  await clickFlowFabItem('Data Graph');

  // 8. Assert __IGNATIUS_CY__ defined again (AFTER confirming switch happened)
  await assertHash('view=graph');
  await assertCyDefined('after returning to Graph');

  // 10. Switch graph → flow → graph N=3 more times
  note('Running 3 more graph↔flow cycles to check for cy leak…');
  for (let i = 1; i <= 3; i++) {
    // To Flow
    await clickErdFabItem('Flows');

    // Assert switch actually happened before checking leak invariant
    await assertHash(`view=flow`);
    await assertCyCleared(`on cycle ${i} entering Flows`);
    await assertFlowReady(`on cycle ${i}`);

    // Back to Graph
    await clickFlowFabItem('Data Graph');

    // Assert switch happened before checking cy presence
    await assertHash('view=graph');
    await assertCyDefined(`on cycle ${i} returning to Graph`);

    note(`Cycle ${i}: PASS`);
  }

  // Screenshot sizes sanity check
  const graphFile = Bun.file(graphShot);
  const flowFile = Bun.file(flowShot);
  note(`Graph screenshot size: ${graphFile.size} bytes`);
  note(`Flow screenshot size: ${flowFile.size} bytes`);
  if (graphFile.size < 1000) fail('Graph screenshot suspiciously small');
  if (flowFile.size < 1000) fail('Flow screenshot suspiciously small');

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nview-switch visual check PASSED.');
