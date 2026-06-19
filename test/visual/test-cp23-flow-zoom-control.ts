/**
 * Visual verification: CP23 / CP3 (viewer-ux-polish #3) — ZoomControl on the
 * Flows view under native-1:1 zoom semantics + tamed SVG wheel zoom.
 *
 * Native-1:1 contract (the #3 fix): `100%` means one diagram (world) unit renders
 * as one CSS pixel, independent of model size — NOT the fit-to-screen baseline.
 * The DFD `<svg>` keeps its viewBox = world content box, so the on-screen scale =
 * `internalScale × fitScale` (where `internalScale` is the inner `<g>` transform's
 * scale and `fitScale` is the viewBox→container ratio). The readout reports that
 * true on-screen ratio: `Math.round(internalScale × fitScale × 100)`. Initial view
 * and Home/reset still fit-to-screen — at fit `internalScale === 1`, so the readout
 * shows `Math.round(fitScale × 100)` (sub-100 on a large model, >100 on a small one),
 * NOT a forced 100.
 *
 * Proves:
 *  A. The zoom control renders on the Flows view with a live % readout that is a
 *     valid positive percent (the true fit percent, whatever it is — not forced 100).
 *  B. Clicking + raises the readout ~10% and the DFD internalScale changes.
 *  C. Clicking − lowers the readout.
 *  D. Typing a % in the input and committing sets the zoom to that true level.
 *  E. Clicking reset returns the readout to the SAME initial fit percent (not 100).
 *  F. CP3 native 1:1 — typing 100 makes the on-screen scale (internalScale × fitScale)
 *     ≈ 1.0, i.e. internalScale ≈ 1/fitScale (so when fit ≠ 100%, typing 100 moves
 *     internalScale away from 1).
 *  G. Light mode: control renders and works.
 *  H. Control does NOT overlap the flow minimap (bottom-left) or FAB (bottom-right).
 *  I. Quick regression: graph ZoomControl still works on the Graph view.
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

/** Read the inner-<g> transform scale (the `internalScale`; 1 = fit-to-container). */
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

/**
 * Derive `fitScale` (viewBox→container ratio under xMidYMid-meet) directly from
 * the DFD <svg> in the browser: the smaller of width/vbW and height/vbH. This is
 * the on-screen pixels-per-world-unit when internalScale === 1, so the true
 * on-screen scale is `internalScale × fitScale`. Returns 0 if the SVG is absent.
 */
async function getFlowFitScale(): Promise<number> {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-ignatius="flow-svg"]');
    if (!svg) return 0;
    const vb = svg.getAttribute('viewBox') ?? '';
    const parts = vb.trim().split(/\s+/).map(Number);
    if (parts.length !== 4) return 0;
    const vbW = parts[2] ?? 0;
    const vbH = parts[3] ?? 0;
    const rect = svg.getBoundingClientRect();
    if (vbW <= 0 || vbH <= 0 || rect.width <= 0 || rect.height <= 0) return 0;
    return Math.min(rect.width / vbW, rect.height / vbH);
  });
}

/** On-screen pixels-per-world-unit = internalScale × fitScale (1.0 = native 1:1). */
async function getFlowScreenScale(): Promise<number> {
  const internal = await getFlowScale();
  const fit = await getFlowFitScale();
  return internal * fit;
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

  // CP3: initial view fits-to-screen but the readout shows the TRUE percent
  // (Math.round(fitScale × 100)) — NOT a forced 100. Capture it; reset must
  // return to this same value.
  const readoutInitial = await getReadoutPercent();
  const initialInternalScale = await getFlowScale();
  const initialFitScale = await getFlowFitScale();
  note(`Initial readout: ${readoutInitial}% (internalScale=${initialInternalScale.toFixed(4)} fitScale=${initialFitScale.toFixed(4)})`);
  if (isNaN(readoutInitial) || readoutInitial <= 0) {
    fail(`Initial readout is not valid: "${await getReadoutText()}"`);
  }
  note(`OK: initial fit readout is a valid positive percent (${readoutInitial}%) — fit is internalScale=1, so this is round(fitScale×100), not a forced 100`);

  const shot01 = join(TMP, '01-dark-initial.png');
  await page.screenshot({ path: shot01 });
  note(`Screenshot: ${shot01}`);

  // ── B. "+" raises readout ~10% (relative) and DFD internalScale changes ──
  // Under native-1:1 the true percent = internalScale × fitScale × 100. The +
  // button bumps internalScale by ~10% (×1.1), so the readout grows by ~10%
  // RELATIVELY (ratio ≈ 1.1), independent of fitScale — a fixed percentage-point
  // band would be wrong on a model whose fit ≠ 100%.
  note('\n── 2. Click + raises readout ~10% relatively (dark) ───────────────────');
  const scaleBefore = await getFlowScale();
  const percentBefore = await getReadoutPercent();
  note(`Before +: readout=${percentBefore}% internalScale=${scaleBefore.toFixed(4)}`);

  const plusBtn = page.locator('[data-testid="zoom-control"] .zoom-control-btn').last();
  await plusBtn.click();
  await page.waitForTimeout(300);

  const scaleAfterPlus = await getFlowScale();
  const percentAfterPlus = await getReadoutPercent();
  note(`After +: readout=${percentAfterPlus}% internalScale=${scaleAfterPlus.toFixed(4)}`);

  if (scaleAfterPlus <= scaleBefore) {
    fail(`internalScale did not increase after +: before=${scaleBefore.toFixed(4)} after=${scaleAfterPlus.toFixed(4)}`);
  }
  note('OK: internalScale increased');

  const plusRatio = percentAfterPlus / percentBefore;
  if (plusRatio < 1.05 || plusRatio > 1.15) {
    fail(`Readout ratio after + is ${plusRatio.toFixed(3)} — expected ~1.1 (×1.1 internal step)`);
  }
  note(`OK: readout grew ${percentBefore}% → ${percentAfterPlus}% (ratio ${plusRatio.toFixed(3)} ≈ 1.1)`);

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

  // ── E. Reset returns to the SAME initial fit percent (CP3 — not forced 100) ─
  note('\n── 5. Reset returns to the initial fit percent (dark) ──────────────────');
  const resetBtn = page.locator('[data-testid="zoom-control"] .zoom-control-reset');
  await resetBtn.click();
  await page.waitForTimeout(400);

  const percentAfterReset = await getReadoutPercent();
  const scaleAfterReset = await getFlowScale();
  note(`After reset: readout=${percentAfterReset}% internalScale=${scaleAfterReset.toFixed(4)} (initial fit was ${readoutInitial}%)`);

  // CP3: Home/reset fits-to-screen, so the readout returns to the SAME initial
  // fit percent — NOT a forced 100. Allow ±1% for layout/round jitter.
  if (Math.abs(percentAfterReset - readoutInitial) > 1) {
    fail(`Reset did not return to the initial fit percent: got ${percentAfterReset}%, expected ~${readoutInitial}%`);
  }
  // At fit the inner-<g> internalScale is 1 (the viewBox = world box convention).
  if (Math.abs(scaleAfterReset - 1.0) > 0.01) {
    fail(`internalScale after fit-reset should be ~1.0, got ${scaleAfterReset.toFixed(4)}`);
  }
  note(`OK: reset returned to the initial fit percent (${percentAfterReset}%, internalScale=1.0)`);

  const shot05 = join(TMP, '05-dark-after-reset.png');
  await page.screenshot({ path: shot05 });
  note(`Screenshot: ${shot05}`);

  // ── F. CP3 native 1:1 — typing 100 yields on-screen scale ≈ 1.0 ───────────
  note('\n── 5b. CP3: type 100 → native 1:1 (on-screen scale ≈ 1.0) (dark) ───────');
  const readoutBtnNative = page.locator('[data-testid="zoom-control"] .zoom-control-readout');
  await readoutBtnNative.click();
  await page.waitForTimeout(200);
  const inputFieldNative = page.locator('[data-testid="zoom-control"] .zoom-control-input');
  const nativeInputVisible = await inputFieldNative.isVisible().catch(() => false);
  if (!nativeInputVisible) fail('Type-in input not visible after clicking readout (native 1:1 step)');
  await inputFieldNative.fill('100');
  await inputFieldNative.press('Enter');
  await page.waitForTimeout(300);

  const nativeReadout = await getReadoutPercent();
  const nativeInternalScale = await getFlowScale();
  const nativeFitScale = await getFlowFitScale();
  const nativeScreenScale = await getFlowScreenScale();
  note(`After type 100: readout=${nativeReadout}% internalScale=${nativeInternalScale.toFixed(4)} fitScale=${nativeFitScale.toFixed(4)} on-screen(scale×fit)=${nativeScreenScale.toFixed(4)}`);

  // The readout at native 1:1 should report ~100% (true on-screen scale).
  if (Math.abs(nativeReadout - 100) > 3) {
    fail(`Native 1:1: expected readout ~100%, got ${nativeReadout}%`);
  }
  // The defining invariant: on-screen pixels-per-world-unit ≈ 1.0.
  if (Math.abs(nativeScreenScale - 1.0) > 0.05) {
    fail(`Native 1:1: on-screen scale (internalScale × fitScale) should be ~1.0, got ${nativeScreenScale.toFixed(4)}`);
  }
  // internalScale ≈ 1/fitScale (so when fit ≠ 100%, internalScale ≠ 1).
  const expectedInternalNative = 1 / nativeFitScale;
  if (Math.abs(nativeInternalScale - expectedInternalNative) > 0.05 * Math.max(1, expectedInternalNative)) {
    fail(`Native 1:1: internalScale should be ~1/fitScale (${expectedInternalNative.toFixed(4)}), got ${nativeInternalScale.toFixed(4)}`);
  }
  if (Math.abs(initialFitScale - 1.0) > 0.02 && Math.abs(nativeInternalScale - 1.0) <= 0.02) {
    fail(`Native 1:1: fit was non-100% (fitScale=${initialFitScale.toFixed(4)}) but internalScale stayed ~1 — native 1:1 should have moved it away from 1`);
  }
  note(`OK: native 1:1 verified — on-screen scale ${nativeScreenScale.toFixed(4)} ≈ 1.0; internalScale ${nativeInternalScale.toFixed(4)} ≈ 1/fitScale ${expectedInternalNative.toFixed(4)}`);

  const shot05b = join(TMP, '05b-dark-native-1to1.png');
  await page.screenshot({ path: shot05b });
  note(`Screenshot: ${shot05b}`);

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
  note(`After + (light): readout=${percentAfterLight}% internalScale=${scaleAfterLight.toFixed(4)}`);

  if (scaleAfterLight <= scaleBeforeLight) {
    fail(`internalScale did not increase after + (light): before=${scaleBeforeLight.toFixed(4)} after=${scaleAfterLight.toFixed(4)}`);
  }
  // Relative ~10% growth (×1.1 internal step), independent of fitScale.
  const lightRatio = percentAfterLight / percentBeforeLight;
  if (lightRatio < 1.05 || lightRatio > 1.15) {
    fail(`Readout ratio after + (light) is ${lightRatio.toFixed(3)} — expected ~1.1`);
  }
  note(`OK: readout grew ${percentBeforeLight}% → ${percentAfterLight}% (ratio ${lightRatio.toFixed(3)} ≈ 1.1) in light mode`);

  const shot07 = join(TMP, '07-light-after-plus.png');
  await page.screenshot({ path: shot07 });
  note(`Screenshot: ${shot07}`);

  // ── Light mode reset (CP3 — returns to the fit percent, not forced 100) ────
  note('\n── 9. Reset in light mode ──────────────────────────────────────────────');
  const resetBtnLight = page.locator('[data-testid="zoom-control"] .zoom-control-reset');
  await resetBtnLight.click();
  await page.waitForTimeout(400);

  const percentAfterResetLight = await getReadoutPercent();
  note(`After reset (light): readout=${percentAfterResetLight}% (same diagram fit was ${readoutInitial}%)`);
  // Same diagram + viewport as dark mode, so reset returns to the same fit percent.
  if (Math.abs(percentAfterResetLight - readoutInitial) > 1) {
    fail(`Reset (light) did not return to the fit percent: got ${percentAfterResetLight}%, expected ~${readoutInitial}%`);
  }
  note(`OK: reset returned to the fit percent (${percentAfterResetLight}%) in light mode`);

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
  const shots = [shot01, shot02, shot03, shot04, shot05, shot05b, shot06, shot07, shot08, shot09];
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
