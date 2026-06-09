/**
 * CP8a behavioral closeout — two assertions:
 *
 *  A. GET /flow returns a 302 redirect to /#view=flow (not a server-rendered page).
 *  B. FAB cross-nav across all three views (graph→dict→flow→graph) causes NO full-page
 *     reload. All three switches are in-app via setView.
 *
 * Hard-fails (process.exit(1)) on any miss.
 * Run via: bun test/visual/test-cp8a-flow-redirect.ts (from repo root)
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const PORT = 7299;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Server ───────────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', 'models/key-inherited', '--port', String(PORT)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

async function waitForServer(url: string, timeout = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      // '/' returns 200 (the SPA); any response means the server is up.
      if (r.status < 600) return true;
    } catch {}
    await Bun.sleep(200);
  }
  return false;
}

const serverReady = await waitForServer(BASE);
if (!serverReady) fail('Server did not start within 10 seconds');
note(`Server ready at ${BASE}`);

// ── Part A: HTTP redirect assertion (no browser needed) ───────────────────────

note('\n── Part A: GET /flow → 302 /#view=flow ──');
{
  const res = await fetch(`${BASE}/flow`, { redirect: 'manual' });
  if (res.status !== 302) fail(`/flow: expected 302 got ${res.status}`);
  const loc = res.headers.get('location') ?? '';
  if (!loc.includes('#view=flow')) fail(`/flow: expected Location /#view=flow got "${loc}"`);
  note(`PASS /flow → 302 → ${loc}`);
}

// ── Part B: In-app FAB cross-nav — no full-page reload ───────────────────────

note('\n── Part B: in-app FAB cross-nav (graph→dict→flow→graph) ──');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

let getCount = 0;
page.on('request', req => {
  if (req.method() === 'GET' && req.url() === `${BASE}/`) getCount++;
});

/** Open the shared FAB (present on all views) and click a menu item by label. */
async function clickFabItem(label: string): Promise<void> {
  const fab = page.locator('button.fab, button[title="Actions"]').first();
  const found = await fab.count();
  if (found === 0) fail(`FAB not found when clicking "${label}"`);
  await fab.click();
  // Wait for the menu to be DOM-visible before probing items.
  const menu = page.locator('.fab-menu[role="menu"]');
  const menuVisible = await menu.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
  if (!menuVisible) fail(`FAB menu did not open when clicking "${label}"`);
  const item = page.getByRole('menuitem', { name: label, exact: true });
  const cnt = await item.count();
  if (cnt === 0) fail(`FAB menu item "${label}" not found`);
  await item.click();
  // Wait for the menu to close — the item click sets menuOpen=false which unmounts the menu.
  await menu.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}

/** Assert location.hash includes a substring. */
async function assertHash(substr: string): Promise<void> {
  const hash = await page.evaluate(() => location.hash);
  if (!hash.includes(substr)) fail(`Hash expected to include "${substr}" but got "${hash}"`);
  note(`Hash OK: ${hash}`);
}

/** Wait for __IGNATIUS_CY__ to be defined. */
async function assertCyDefined(ctx: string): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 12_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail(`__IGNATIUS_CY__ not defined ${ctx}`);
  note(`__IGNATIUS_CY__ defined: ${ctx}`);
}

/** Wait for __IGNATIUS_FLOW_READY__ === true. */
async function assertFlowReady(ctx: string): Promise<void> {
  const ok = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail(`__IGNATIUS_FLOW_READY__ not true ${ctx}`);
  note(`Flow ready: ${ctx}`);
}

/** Assert a selector is visible. */
async function assertVisible(selector: string, ctx: string): Promise<void> {
  const el = page.locator(selector);
  const ok = await el.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
  if (!ok) fail(`Expected visible: ${selector} (${ctx})`);
  note(`Visible: ${selector} (${ctx})`);
}

try {
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('domcontentloaded');

  // Boot on Graph
  await assertCyDefined('boot');
  if (getCount !== 1) fail(`Expected 1 GET / on boot, got ${getCount}`);
  note(`Boot GET count: ${getCount} (correct)`);

  // Screenshot: graph
  await page.screenshot({ path: join(TMP, 'cp8a-graph.png') });

  // Graph → Dictionary
  const countBeforeDict = getCount;
  await clickFabItem('Dictionary');
  await assertHash('view=dict');
  if (getCount !== countBeforeDict) fail(`Full-page reload detected on Graph→Dictionary switch (GET / count: ${countBeforeDict}→${getCount})`);
  note('No reload on Graph→Dictionary');
  await assertVisible('[data-ignatius="dict-view"]', 'Dictionary view');
  await page.screenshot({ path: join(TMP, 'cp8a-dict.png') });

  // Dictionary → Flows
  const countBeforeFlow = getCount;
  await clickFabItem('Flows');
  await assertHash('view=flow');
  if (getCount !== countBeforeFlow) fail(`Full-page reload detected on Dictionary→Flows switch (GET / count: ${countBeforeFlow}→${getCount})`);
  note('No reload on Dictionary→Flows');
  await assertFlowReady('after Dict→Flow switch');
  await page.screenshot({ path: join(TMP, 'cp8a-flow.png') });

  // Flows → Graph (via shared FAB — "Data Graph" item)
  const countBeforeGraph = getCount;
  await clickFabItem('Data Graph');
  await assertHash('view=graph');
  if (getCount !== countBeforeGraph) fail(`Full-page reload detected on Flows→Graph switch (GET / count: ${countBeforeGraph}→${getCount})`);
  note('No reload on Flows→Graph');
  await assertCyDefined('after Flows→Graph');

  // Confirm "Process Dict" href-nav is gone from the flow FAB menu (it was a reload source)
  await clickFabItem('Flows');
  await assertFlowReady('re-enter flow for Process Dict check');
  const fab = page.locator('button.fab, button[title="Actions"]').first();
  await fab.click();
  // Wait for the menu to be visible before checking its contents.
  await page.locator('.fab-menu[role="menu"]').waitFor({ state: 'visible', timeout: 5_000 });
  // Any <a href> in the FAB menu that points to /flow-dict would be a reload risk.
  // After CP8a it must not exist.
  const flowDictLink = page.locator('.fab-menu a[href*="flow-dict"]');
  const flowDictCount = await flowDictLink.count();
  if (flowDictCount > 0) fail(`FAB still has an href link to flow-dict (reload risk)`);
  note('PASS: no href /flow-dict link in FAB');

  note('\nAll FAB cross-nav assertions PASSED.');

} catch (err) {
  if (err instanceof Error && err.message.includes('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP8a visual check PASSED.');
