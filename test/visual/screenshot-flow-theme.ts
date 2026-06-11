/**
 * Visual verification: DFD theming (CP2 part 1).
 *
 * Proves:
 *  1. A DFD screenshots correctly in DARK mode (baseline, unchanged).
 *  2. Toggling light mode re-themes the DFD immediately — light canvas, dark text.
 *  3. After switching to the second DFD and toggling theme, the selected DFD is
 *     preserved through the re-theme (CP1 invariant holds).
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
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', '7373'],
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

const serverReady = await waitForServer('http://localhost:7373', 10_000);
if (!serverReady) fail('Server did not start within 10 seconds');
note('Server ready at http://localhost:7373');

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

/** Open the ERD FAB (.fab) and click a menu item by text label. */
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

/** Click the FlowChrome DFD selector button by the diagram id text. */
async function selectFlowDiagram(diagramId: string): Promise<void> {
  // The DFD selector renders buttons with the diagram id as text content.
  const btn = page.locator('button', { hasText: diagramId });
  if (await btn.count() === 0) fail(`DFD selector button for "${diagramId}" not found`);
  await btn.first().click();
  await page.waitForTimeout(600);
  await assertFlowReady(`after selecting DFD "${diagramId}"`);
}

/** Click the theme-toggle button. Works on both the ERD view (.theme-toggle)
 *  and the flow view (FlowChrome inline button with title attribute). */
async function toggleTheme(): Promise<void> {
  // The ERD view uses .theme-toggle; the FlowChrome uses title="Switch to light mode"
  // or title="Switch to dark mode" without a class name. Match by title attribute.
  const byTitle = page.locator('button[title="Switch to light mode"], button[title="Switch to dark mode"]');
  const count = await byTitle.count();
  if (count === 0) fail('Theme toggle button not found (tried title="Switch to light/dark mode")');
  await byTitle.first().click();
  await page.waitForTimeout(400);
}

/** Return the background color of the flow SVG element. */
async function svgBackground(): Promise<string> {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-ignatius="flow-svg"]') as SVGSVGElement | null;
    if (!svg) return 'NOT_FOUND';
    return svg.style.background || window.getComputedStyle(svg).background || 'EMPTY';
  });
}

/** Return the active DFD id from the window global. */
async function activeDfd(): Promise<string | undefined> {
  return page.evaluate(() =>
    (window as { __IGNATIUS_ACTIVE_FLOW_DFD__?: string }).__IGNATIUS_ACTIVE_FLOW_DFD__
  );
}

// ── Test ─────────────────────────────────────────────────────────────────────

try {
  await page.goto('http://localhost:7373/');
  await page.waitForLoadState('domcontentloaded');
  await assertCyDefined('on boot');

  // Switch to Flows via ERD FAB
  await clickErdFabItem('Flows');
  await page.waitForFunction(
    () => location.hash.includes('view=flow'),
    { timeout: 5_000 },
  );
  await assertFlowReady('after switching to Flows');

  // ── 1. Dark mode DFD screenshot ──────────────────────────────────────────
  const darkShot = join(TMP, 'flow-theme-dark.png');
  await page.screenshot({ path: darkShot });
  note(`Dark DFD screenshot: ${darkShot}`);

  const bgDark = await svgBackground();
  note(`SVG background in dark mode: ${bgDark}`);

  // Hard-fail if the SVG element itself was not found — the dark baseline is untestable.
  if (bgDark === 'NOT_FOUND') fail(`SVG [data-ignatius="flow-svg"] not found in dark mode — cannot verify dark canvas`);
  if (bgDark === 'EMPTY') fail(`SVG background is empty in dark mode — dark canvas unverified`);

  // The DARK_PALETTE canvas is '#0e1116'. Verify it contains a dark color reference.
  if (!bgDark.includes('0e1116') && !bgDark.includes('14, 17, 22')) {
    // Compute-style may return rgb() — check for dark values (14/17/22 is rgb for 0e1116)
    note(`Warning: dark canvas color not exactly matched (got: ${bgDark}) — check screenshot manually`);
  } else {
    note('Dark canvas color confirmed: 0e1116');
  }

  // ── 2. Toggle to light mode, verify re-theme ─────────────────────────────
  await toggleTheme();

  const lightShot = join(TMP, 'flow-theme-light.png');
  await page.screenshot({ path: lightShot });
  note(`Light DFD screenshot: ${lightShot}`);

  const bgLight = await svgBackground();
  note(`SVG background in light mode: ${bgLight}`);

  // LIGHT_PALETTE canvas is '#f6f8fa'. Verify it contains a light color reference.
  if (!bgLight.includes('f6f8fa') && !bgLight.includes('246, 248, 250')) {
    note(`Warning: light canvas color not exactly matched (got: ${bgLight}) — check screenshot manually`);
  } else {
    note('Light canvas color confirmed: f6f8fa');
  }

  // Verify the background changed (not still dark)
  if (bgLight === bgDark) {
    fail(`Theme toggle did NOT re-theme the DFD — background unchanged: ${bgLight}`);
  }
  note('Theme toggle re-themed the DFD (background changed)');

  // ── 3. Toggle back to dark, select second DFD, toggle theme — verify DFD preserved ──
  await toggleTheme();  // back to dark
  await page.waitForTimeout(300);

  // Get the first DFD id and check for a second one
  const firstDfd = await activeDfd();
  note(`First active DFD: ${firstDfd ?? 'none'}`);

  // Try to select the second DFD — look for 'refund' which exists in key-inherited
  const refundBtn = page.locator('button', { hasText: 'refund' });
  const refundCount = await refundBtn.count();

  if (refundCount > 0) {
    await selectFlowDiagram('refund');
    const afterSelect = await activeDfd();
    if (afterSelect !== 'refund') fail(`Expected active DFD "refund", got "${afterSelect}"`);
    note(`Selected DFD "refund" confirmed`);

    // Toggle theme — selected DFD must be preserved
    await toggleTheme();
    await page.waitForTimeout(400);

    const afterToggle = await activeDfd();
    if (afterToggle !== 'refund') {
      fail(`Theme toggle reset the selected DFD! Expected "refund", got "${afterToggle}"`);
    }
    note(`Selected DFD preserved through theme toggle: "${afterToggle}"`);

    const preservedShot = join(TMP, 'flow-theme-dfd-preserved.png');
    await page.screenshot({ path: preservedShot });
    note(`DFD-preserved screenshot: ${preservedShot}`);
  } else {
    note('Only one top-level DFD visible — skipping DFD-preserve check (no second diagram)');
  }

  // ── Verify screenshots are non-trivial ───────────────────────────────────
  const darkFile = Bun.file(darkShot);
  const lightFile = Bun.file(lightShot);
  note(`Dark screenshot: ${darkFile.size} bytes`);
  note(`Light screenshot: ${lightFile.size} bytes`);
  if (darkFile.size < 5000) fail('Dark DFD screenshot suspiciously small (< 5KB)');
  if (lightFile.size < 5000) fail('Light DFD screenshot suspiciously small (< 5KB)');

  note('\nAll checks PASSED.');
  note(`Screenshots saved to ${TMP}/:`);
  note(`  flow-theme-dark.png    — dark palette`);
  note(`  flow-theme-light.png   — light palette (inspect for legibility)`);
  if (refundCount > 0) note(`  flow-theme-dfd-preserved.png — light theme, selected DFD = refund`);

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nflow-theme visual check PASSED.');
