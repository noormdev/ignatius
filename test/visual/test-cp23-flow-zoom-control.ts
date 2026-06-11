/**
 * Visual verification: CP23 — ZoomControl on the Flows view + tamed SVG wheel zoom.
 *
 * Proves:
 *  A. The zoom control renders on the Flows view with a live % readout.
 *  B. Clicking + raises the readout ~10% and the DFD SVG scale changes.
 *  C. Clicking − lowers the readout.
 *  D. Typing a % in the input and committing sets the zoom to that level.
 *  E. Clicking reset returns the readout to 100%.
 *  F. Light mode: control renders and works.
 *  G. Control does NOT overlap the flow minimap (bottom-left) or FAB (bottom-right).
 *  H. Quick regression: graph ZoomControl still works on the Graph view.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp23-flow-zoom-control');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', '7423'],
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

const serverReady = await waitForServer('http://localhost:7423', 12_000);
if (!serverReady) fail('Server did not start within 12 seconds');
note('Server ready at http://localhost:7423');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForFlowReady(): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Flow (__IGNATIUS_FLOW_READY__) did not become ready');
}

async function waitForGraph(): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Graph (__IGNATIUS_CY__) did not become ready');
}

async function waitForZoomControl(): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!document.querySelector('[data-testid="zoom-control"]'),
    { timeout: 8_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('ZoomControl ([data-testid="zoom-control"]) not found in DOM');
}

async function getReadoutText(): Promise<string> {
  return page.evaluate(() => {
    const ctrl = document.querySelector('[data-testid="zoom-control"]');
    if (!ctrl) return '';
    const readout = ctrl.querySelector('.zoom-control-readout') ?? ctrl.querySelector('.zoom-control-input');
    if (!readout) return '';
    return (readout as HTMLElement).textContent?.trim()
      ?? (readout as HTMLInputElement).value?.trim()
      ?? '';
  });
}

async function getReadoutPercent(): Promise<number> {
  const text = await getReadoutText();
  return parseInt(text.replace('%', ''), 10);
}

/** Read the SVG scale transform from the inner DFD group. */
async function getFlowScale(): Promise<number> {
  return page.evaluate(() => {
    const g = document.querySelector('[data-ignatius="flow-svg"] g');
    if (!g) return 0;
    const t = g.getAttribute('transform') ?? '';
    // format: "translate(tx,ty) scale(s)"
    const m = t.match(/scale\(([^)]+)\)/);
    if (!m) return 0;
    return parseFloat(m[1]);
  });
}

async function toggleTheme(): Promise<void> {
  const btn = page.locator('.theme-toggle');
  const c = await btn.count();
  if (c === 0) fail('.theme-toggle button not found');
  await btn.click();
  await page.waitForTimeout(500);
}

async function switchToFlowView(): Promise<void> {
  // Navigate to flow view via hash
  await page.evaluate(() => {
    location.hash = '#view=flow';
  });
  await page.waitForTimeout(400);
  await waitForFlowReady();
  await page.waitForTimeout(600); // let initial render settle
}

// ── Test ──────────────────────────────────────────────────────────────────────

try {
  await page.goto('http://localhost:7423/');
  await page.waitForLoadState('domcontentloaded');
  await waitForGraph();
  await page.waitForTimeout(800);

  // ═══════════════════════════════════════════════════════════════════════════
  // DARK MODE — FLOW VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  note('\n── Switch to Flows view (dark) ─────────────────────────────────────────');
  await switchToFlowView();

  // ── A. ZoomControl renders ───────────────────────────────────────────────
  note('\n── 1. ZoomControl renders on Flows view (dark) ─────────────────────────');
  await waitForZoomControl();
  note('OK: ZoomControl found in DOM');

  const readoutInitial = await getReadoutPercent();
  note(`Initial readout: ${readoutInitial}%`);
  if (isNaN(readoutInitial) || readoutInitial <= 0) {
    fail(`Initial readout is not valid: "${await getReadoutText()}"`);
  }
  if (readoutInitial !== 100) {
    note(`WARN: Expected 100% at flow baseline (scale=1), got ${readoutInitial}%`);
  } else {
    note('OK: Initial readout is 100% (fit baseline)');
  }

  const shot01 = join(TMP, '01-dark-initial.png');
  await page.screenshot({ path: shot01 });
  note(`Screenshot: ${shot01}`);

  // ── B. "+" raises readout ~10% and DFD scale changes ────────────────────
  note('\n── 2. Click + raises readout ~10% (dark) ──────────────────────────────');
  const scaleBefore = await getFlowScale();
  const percentBefore = await getReadoutPercent();
  note(`Before +: readout=${percentBefore}% scale=${scaleBefore.toFixed(4)}`);

  const plusBtn = page.locator('[data-testid="zoom-control"] .zoom-control-btn').last();
  await plusBtn.click();
  await page.waitForTimeout(300);

  const scaleAfterPlus = await getFlowScale();
  const percentAfterPlus = await getReadoutPercent();
  note(`After +: readout=${percentAfterPlus}% scale=${scaleAfterPlus.toFixed(4)}`);

  if (scaleAfterPlus <= scaleBefore) {
    fail(`SVG scale did not increase after +: before=${scaleBefore.toFixed(4)} after=${scaleAfterPlus.toFixed(4)}`);
  }
  note('OK: SVG scale increased');

  const delta = percentAfterPlus - percentBefore;
  if (delta < 5 || delta > 15) {
    fail(`Readout delta after + is ${delta}% — expected ~10% (5–15%)`);
  }
  note(`OK: readout increased by ${delta}% (expected ~10%)`);

  const shot02 = join(TMP, '02-dark-after-plus.png');
  await page.screenshot({ path: shot02 });
  note(`Screenshot: ${shot02}`);

  // ── C. "−" lowers readout ────────────────────────────────────────────────
  note('\n── 3. Click − lowers readout (dark) ───────────────────────────────────');
  const scaleBeforeMinus = await getFlowScale();
  const percentBeforeMinus = await getReadoutPercent();

  const minusBtn = page.locator('[data-testid="zoom-control"] .zoom-control-btn').first();
  await minusBtn.click();
  await page.waitForTimeout(300);

  const scaleAfterMinus = await getFlowScale();
  const percentAfterMinus = await getReadoutPercent();
  note(`After −: readout=${percentAfterMinus}% scale=${scaleAfterMinus.toFixed(4)}`);

  if (scaleAfterMinus >= scaleBeforeMinus) {
    fail(`SVG scale did not decrease after −: before=${scaleBeforeMinus.toFixed(4)} after=${scaleAfterMinus.toFixed(4)}`);
  }
  note('OK: SVG scale decreased');

  if (percentAfterMinus >= percentBeforeMinus) {
    fail(`Readout did not decrease after −: before=${percentBeforeMinus}% after=${percentAfterMinus}%`);
  }
  note(`OK: readout decreased from ${percentBeforeMinus}% to ${percentAfterMinus}%`);

  const shot03 = join(TMP, '03-dark-after-minus.png');
  await page.screenshot({ path: shot03 });
  note(`Screenshot: ${shot03}`);

  // ── D. Type-in sets exact zoom ───────────────────────────────────────────
  note('\n── 4. Type-in sets exact zoom (dark) ──────────────────────────────────');
  const targetPercent = 150;

  const readoutBtn = page.locator('[data-testid="zoom-control"] .zoom-control-readout');
  await readoutBtn.click();
  await page.waitForTimeout(200);

  const inputField = page.locator('[data-testid="zoom-control"] .zoom-control-input');
  const inputVisible = await inputField.isVisible().catch(() => false);
  if (!inputVisible) fail('Type-in input not visible after clicking readout');

  await inputField.fill(String(targetPercent));
  await inputField.press('Enter');
  await page.waitForTimeout(300);

  const percentAfterTypeIn = await getReadoutPercent();
  note(`After type-in ${targetPercent}%: readout=${percentAfterTypeIn}%`);

  if (Math.abs(percentAfterTypeIn - targetPercent) > 3) {
    fail(`Type-in: expected readout ~${targetPercent}%, got ${percentAfterTypeIn}%`);
  }
  note(`OK: type-in set readout to ${percentAfterTypeIn}% (target ${targetPercent}%)`);

  const scaleAfterTypeIn = await getFlowScale();
  note(`SVG scale after type-in: ${scaleAfterTypeIn.toFixed(4)}`);

  const shot04 = join(TMP, '04-dark-after-typein.png');
  await page.screenshot({ path: shot04 });
  note(`Screenshot: ${shot04}`);

  // ── E. Reset returns to 100% ─────────────────────────────────────────────
  note('\n── 5. Reset returns to 100% (dark) ────────────────────────────────────');
  const resetBtn = page.locator('[data-testid="zoom-control"] .zoom-control-reset');
  await resetBtn.click();
  await page.waitForTimeout(400);

  const percentAfterReset = await getReadoutPercent();
  const scaleAfterReset = await getFlowScale();
  note(`After reset: readout=${percentAfterReset}% scale=${scaleAfterReset.toFixed(4)}`);

  if (percentAfterReset !== 100) {
    fail(`Reset did not return to 100%: got ${percentAfterReset}%`);
  }
  if (Math.abs(scaleAfterReset - 1.0) > 0.01) {
    fail(`SVG scale after reset should be ~1.0, got ${scaleAfterReset.toFixed(4)}`);
  }
  note('OK: reset returned to 100% (scale=1.0)');

  const shot05 = join(TMP, '05-dark-after-reset.png');
  await page.screenshot({ path: shot05 });
  note(`Screenshot: ${shot05}`);

  // ── G. Placement — no overlap with minimap or FAB ────────────────────────
  note('\n── 6. Placement — zoom control does not overlap minimap or FAB (dark) ──');
  const placement = await page.evaluate(() => {
    const zc = document.querySelector('[data-testid="zoom-control"]') as HTMLElement | null;
    const fab = document.querySelector('.fab') as HTMLElement | null;
    const minimap = document.querySelector('.flow-minimap-wrapper') as HTMLElement | null;
    if (!zc || !fab) return null;
    const zcRect = zc.getBoundingClientRect();
    const fabRect = fab.getBoundingClientRect();
    const mmRect = minimap?.getBoundingClientRect() ?? null;
    return {
      zcRight: zcRect.right,
      zcLeft: zcRect.left,
      zcBottom: zcRect.bottom,
      fabTop: fabRect.top,
      overlapsFab: zcRect.bottom > fabRect.top && zcRect.top < fabRect.bottom,
      overlapsMinimap: mmRect
        ? (zcRect.right > mmRect.left && zcRect.left < mmRect.right &&
           zcRect.bottom > mmRect.top && zcRect.top < mmRect.bottom)
        : false,
    };
  });
  if (!placement) fail('Could not get placement info (zoom control or FAB not found)');
  note(`ZoomControl: bottom=${placement.zcBottom.toFixed(0)}, FAB top=${placement.fabTop.toFixed(0)}`);
  note(`overlapsFab=${placement.overlapsFab}, overlapsMinimap=${placement.overlapsMinimap}`);
  if (placement.overlapsFab) fail(`ZoomControl overlaps the FAB`);
  if (placement.overlapsMinimap) fail(`ZoomControl overlaps the flow minimap`);
  note('OK: zoom control does not overlap FAB or minimap');

  // ═══════════════════════════════════════════════════════════════════════════
  // LIGHT MODE
  // ═══════════════════════════════════════════════════════════════════════════

  note('\n── Switch to LIGHT mode ────────────────────────────────────────────────');
  await toggleTheme();
  await waitForFlowReady();
  await page.waitForTimeout(600);

  note('\n── 7. ZoomControl renders in light mode ────────────────────────────────');
  await waitForZoomControl();
  note('OK: ZoomControl present in light mode (Flows view)');

  const shot06 = join(TMP, '06-light-initial.png');
  await page.screenshot({ path: shot06 });
  note(`Screenshot: ${shot06}`);

  // ── Light mode + button ──────────────────────────────────────────────────
  note('\n── 8. Click + in light mode ────────────────────────────────────────────');
  const scaleBeforeLight = await getFlowScale();
  const percentBeforeLight = await getReadoutPercent();

  const plusBtnLight = page.locator('[data-testid="zoom-control"] .zoom-control-btn').last();
  await plusBtnLight.click();
  await page.waitForTimeout(300);

  const scaleAfterLight = await getFlowScale();
  const percentAfterLight = await getReadoutPercent();
  note(`After + (light): readout=${percentAfterLight}% scale=${scaleAfterLight.toFixed(4)}`);

  if (scaleAfterLight <= scaleBeforeLight) {
    fail(`SVG scale did not increase after + (light): before=${scaleBeforeLight.toFixed(4)} after=${scaleAfterLight.toFixed(4)}`);
  }
  const lightDelta = percentAfterLight - percentBeforeLight;
  if (lightDelta < 5 || lightDelta > 15) {
    fail(`Readout delta after + (light) is ${lightDelta}% — expected ~10%`);
  }
  note(`OK: readout increased by ${lightDelta}% in light mode`);

  const shot07 = join(TMP, '07-light-after-plus.png');
  await page.screenshot({ path: shot07 });
  note(`Screenshot: ${shot07}`);

  // ── Light mode reset ─────────────────────────────────────────────────────
  note('\n── 9. Reset in light mode ──────────────────────────────────────────────');
  const resetBtnLight = page.locator('[data-testid="zoom-control"] .zoom-control-reset');
  await resetBtnLight.click();
  await page.waitForTimeout(400);

  const percentAfterResetLight = await getReadoutPercent();
  note(`After reset (light): readout=${percentAfterResetLight}%`);
  if (percentAfterResetLight !== 100) {
    fail(`Reset (light) did not return to 100%: got ${percentAfterResetLight}%`);
  }
  note('OK: reset returned to 100% in light mode');

  const shot08 = join(TMP, '08-light-after-reset.png');
  await page.screenshot({ path: shot08 });
  note(`Screenshot: ${shot08}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // REGRESSION: Graph ZoomControl still works
  // ═══════════════════════════════════════════════════════════════════════════

  note('\n── 10. Regression: switch back to Graph view ───────────────────────────');
  await toggleTheme(); // back to dark
  await page.evaluate(() => { location.hash = '#view=graph'; });
  await page.waitForTimeout(400);
  await waitForGraph();
  await page.waitForTimeout(600);

  await waitForZoomControl();
  note('OK: ZoomControl still present on Graph view');

  const graphPercent = await getReadoutPercent();
  note(`Graph readout: ${graphPercent}%`);
  if (isNaN(graphPercent) || graphPercent <= 0) {
    fail(`Graph ZoomControl readout invalid: "${await getReadoutText()}"`);
  }
  note('OK: Graph ZoomControl regression check passed');

  const shot09 = join(TMP, '09-dark-graph-regression.png');
  await page.screenshot({ path: shot09 });
  note(`Screenshot: ${shot09}`);

  // ── Screenshot size sanity check ─────────────────────────────────────────
  note('\n── Screenshot size check ───────────────────────────────────────────────');
  const shots = [shot01, shot02, shot03, shot04, shot05, shot06, shot07, shot08, shot09];
  for (const s of shots) {
    const f = Bun.file(s);
    const name = s.split('/').pop() ?? s;
    note(`  ${name}: ${f.size} bytes`);
    if (f.size < 5_000) fail(`Screenshot ${name} suspiciously small (< 5 KB)`);
  }

  note('\nAll CP23 flow zoom control checks PASSED.');
  note(`Screenshots saved to ${TMP}/`);

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP23 visual check PASSED.');
