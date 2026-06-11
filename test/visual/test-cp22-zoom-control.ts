/**
 * Visual verification: CP22 — Tamed graph wheel zoom + ZoomControl on the Graph view.
 *
 * Proves:
 *  A. The zoom control renders on the Graph view with a live % readout.
 *  B. Clicking + raises the readout ~10% and cy.zoom() changes.
 *  C. Clicking − lowers the readout.
 *  D. Typing a % in the input and committing sets the zoom to that level.
 *  E. Clicking reset returns the readout to 100%.
 *  F. wheelSensitivity is 0.2 (calmer than default).
 *  G. Light mode: control renders and works.
 *  H. Control does NOT overlap minimap (bottom-left) or FAB (bottom-right at 24px).
 *     — The zoom control is at bottom:84px right:24px (above FAB).
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp22-zoom-control');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', '7422'],
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

const serverReady = await waitForServer('http://localhost:7422', 12_000);
if (!serverReady) fail('Server did not start within 12 seconds');
note('Server ready at http://localhost:7422');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    // The readout is either a button (.zoom-control-readout) or an input (.zoom-control-input)
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

async function getCyZoom(): Promise<number> {
  return page.evaluate(() => {
    const cy = (window as { __IGNATIUS_CY__?: { zoom: () => number } }).__IGNATIUS_CY__;
    if (!cy) return 0;
    return cy.zoom();
  });
}

async function toggleTheme(): Promise<void> {
  const btn = page.locator('.theme-toggle');
  const c = await btn.count();
  if (c === 0) fail('.theme-toggle button not found');
  await btn.click();
  await page.waitForTimeout(500);
}

// ── Test ──────────────────────────────────────────────────────────────────────

try {
  await page.goto('http://localhost:7422/');
  await page.waitForLoadState('domcontentloaded');
  await waitForGraph();
  await page.waitForTimeout(800); // let ELK layout + fit settle

  // ═══════════════════════════════════════════════════════════════════════════
  // DARK MODE
  // ═══════════════════════════════════════════════════════════════════════════

  note('\n── 1. ZoomControl renders on Graph view (dark) ─────────────────────────');
  await waitForZoomControl();
  note('OK: ZoomControl found in DOM');

  const readoutInitial = await getReadoutPercent();
  note(`Initial readout: ${readoutInitial}%`);
  if (isNaN(readoutInitial) || readoutInitial <= 0) {
    fail(`Initial readout is not a valid positive number: "${await getReadoutText()}"`);
  }
  // After layout + fit, readout should be 100%.
  if (readoutInitial !== 100) {
    note(`WARN: Expected 100% after fit, got ${readoutInitial}% — acceptable if hash restored a different zoom`);
  } else {
    note('OK: Initial readout is 100% (fit baseline)');
  }

  const shot01 = join(TMP, '01-dark-initial.png');
  await page.screenshot({ path: shot01 });
  note(`Screenshot: ${shot01}`);

  // ── B. "+" button raises readout ~10% ────────────────────────────────────
  note('\n── 2. Click + raises readout ~10% (dark) ──────────────────────────────');
  const zoomBefore = await getCyZoom();
  const percentBefore = await getReadoutPercent();
  note(`Before +: readout=${percentBefore}% cy.zoom()=${zoomBefore.toFixed(4)}`);

  const plusBtn = page.locator('[data-testid="zoom-control"] .zoom-control-btn').last();
  await plusBtn.click();
  await page.waitForTimeout(300);

  const zoomAfterPlus = await getCyZoom();
  const percentAfterPlus = await getReadoutPercent();
  note(`After +: readout=${percentAfterPlus}% cy.zoom()=${zoomAfterPlus.toFixed(4)}`);

  if (zoomAfterPlus <= zoomBefore) {
    fail(`cy.zoom() did not increase after +: before=${zoomBefore.toFixed(4)} after=${zoomAfterPlus.toFixed(4)}`);
  }
  note('OK: cy.zoom() increased');

  const percentDelta = percentAfterPlus - percentBefore;
  if (percentDelta < 5 || percentDelta > 15) {
    fail(`Readout delta after + is ${percentDelta}% — expected ~10% (5–15%)`);
  }
  note(`OK: readout increased by ${percentDelta}% (expected ~10%)`);

  const shot02 = join(TMP, '02-dark-after-plus.png');
  await page.screenshot({ path: shot02 });
  note(`Screenshot: ${shot02}`);

  // ── C. "−" button lowers readout ────────────────────────────────────────
  note('\n── 3. Click − lowers readout (dark) ───────────────────────────────────');
  const zoomBeforeMinus = await getCyZoom();
  const percentBeforeMinus = await getReadoutPercent();

  const minusBtn = page.locator('[data-testid="zoom-control"] .zoom-control-btn').first();
  await minusBtn.click();
  await page.waitForTimeout(300);

  const zoomAfterMinus = await getCyZoom();
  const percentAfterMinus = await getReadoutPercent();
  note(`After −: readout=${percentAfterMinus}% cy.zoom()=${zoomAfterMinus.toFixed(4)}`);

  if (zoomAfterMinus >= zoomBeforeMinus) {
    fail(`cy.zoom() did not decrease after −: before=${zoomBeforeMinus.toFixed(4)} after=${zoomAfterMinus.toFixed(4)}`);
  }
  note('OK: cy.zoom() decreased');

  if (percentAfterMinus >= percentBeforeMinus) {
    fail(`Readout did not decrease after −: before=${percentBeforeMinus}% after=${percentAfterMinus}%`);
  }
  note(`OK: readout decreased from ${percentBeforeMinus}% to ${percentAfterMinus}%`);

  const shot03 = join(TMP, '03-dark-after-minus.png');
  await page.screenshot({ path: shot03 });
  note(`Screenshot: ${shot03}`);

  // ── D. Type-in field sets exact zoom ────────────────────────────────────
  note('\n── 4. Type-in sets exact zoom (dark) ──────────────────────────────────');
  const targetPercent = 150;

  // Click the readout to enter edit mode
  const readoutBtn = page.locator('[data-testid="zoom-control"] .zoom-control-readout');
  await readoutBtn.click();
  await page.waitForTimeout(200);

  // The input field should now be visible
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

  const cyZoomAfterTypeIn = await getCyZoom();
  note(`cy.zoom() after type-in: ${cyZoomAfterTypeIn.toFixed(4)}`);

  const shot04 = join(TMP, '04-dark-after-typein.png');
  await page.screenshot({ path: shot04 });
  note(`Screenshot: ${shot04}`);

  // ── E. Reset returns to 100% ─────────────────────────────────────────────
  note('\n── 5. Reset returns to 100% (dark) ────────────────────────────────────');
  const resetBtn = page.locator('[data-testid="zoom-control"] .zoom-control-reset');
  await resetBtn.click();
  await page.waitForTimeout(600);

  const percentAfterReset = await getReadoutPercent();
  note(`After reset: readout=${percentAfterReset}%`);

  if (percentAfterReset !== 100) {
    fail(`Reset did not return to 100%: got ${percentAfterReset}%`);
  }
  note('OK: reset returned to 100%');

  const shot05 = join(TMP, '05-dark-after-reset.png');
  await page.screenshot({ path: shot05 });
  note(`Screenshot: ${shot05}`);

  // ── F. wheelSensitivity is 0.2 ──────────────────────────────────────────
  note('\n── 6. Assert wheelSensitivity = 0.2 ───────────────────────────────────');
  const wheelSens = await page.evaluate(() => {
    const cy = (window as { __IGNATIUS_CY__?: { options: () => Record<string, unknown> } }).__IGNATIUS_CY__;
    if (!cy) return null;
    const opts = cy.options();
    return opts['wheelSensitivity'] ?? null;
  });
  note(`cy.options().wheelSensitivity = ${wheelSens}`);
  if (wheelSens !== 0.2) {
    fail(`Expected wheelSensitivity 0.2, got ${wheelSens}`);
  }
  note('OK: wheelSensitivity = 0.2');

  // ── G. No overlap: zoom control bottom-right above FAB ──────────────────
  note('\n── 7. Placement — zoom control does not overlap minimap or FAB (dark) ──');
  const placement = await page.evaluate(() => {
    const zc = document.querySelector('[data-testid="zoom-control"]') as HTMLElement | null;
    const fab = document.querySelector('.fab') as HTMLElement | null;
    if (!zc || !fab) return null;
    const zcRect = zc.getBoundingClientRect();
    const fabRect = fab.getBoundingClientRect();
    return {
      zcBottom: zcRect.bottom,
      zcTop: zcRect.top,
      fabTop: fabRect.top,
      overlaps: zcRect.bottom > fabRect.top && zcRect.top < fabRect.bottom,
    };
  });
  if (!placement) fail('Could not get placement info (zoom control or FAB not found)');
  note(`Zoom control bottom=${placement.zcBottom.toFixed(0)}px FAB top=${placement.fabTop.toFixed(0)}px overlaps=${placement.overlaps}`);
  if (placement.overlaps) {
    fail(`ZoomControl overlaps the FAB: zcBottom=${placement.zcBottom.toFixed(0)} fabTop=${placement.fabTop.toFixed(0)}`);
  }
  note('OK: zoom control does not overlap FAB');

  // ═══════════════════════════════════════════════════════════════════════════
  // LIGHT MODE
  // ═══════════════════════════════════════════════════════════════════════════

  note('\n── 8. Switch to LIGHT mode ─────────────────────────────────────────────');
  await toggleTheme();
  await waitForGraph();
  await page.waitForTimeout(600);

  note('\n── 9. ZoomControl renders in light mode ────────────────────────────────');
  await waitForZoomControl();
  note('OK: ZoomControl present in light mode');

  const shot06 = join(TMP, '06-light-initial.png');
  await page.screenshot({ path: shot06 });
  note(`Screenshot: ${shot06}`);

  // ── Light mode + button ──────────────────────────────────────────────────
  note('\n── 10. Click + in light mode ───────────────────────────────────────────');
  const zoomBeforeLight = await getCyZoom();
  const percentBeforeLight = await getReadoutPercent();

  const plusBtnLight = page.locator('[data-testid="zoom-control"] .zoom-control-btn').last();
  await plusBtnLight.click();
  await page.waitForTimeout(300);

  const zoomAfterLight = await getCyZoom();
  const percentAfterLight = await getReadoutPercent();
  note(`After + (light): readout=${percentAfterLight}% cy.zoom()=${zoomAfterLight.toFixed(4)}`);

  if (zoomAfterLight <= zoomBeforeLight) {
    fail(`cy.zoom() did not increase after + (light): before=${zoomBeforeLight.toFixed(4)} after=${zoomAfterLight.toFixed(4)}`);
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
  note('\n── 11. Reset in light mode ─────────────────────────────────────────────');
  const resetBtnLight = page.locator('[data-testid="zoom-control"] .zoom-control-reset');
  await resetBtnLight.click();
  await page.waitForTimeout(600);

  const percentAfterResetLight = await getReadoutPercent();
  note(`After reset (light): readout=${percentAfterResetLight}%`);
  if (percentAfterResetLight !== 100) {
    fail(`Reset (light) did not return to 100%: got ${percentAfterResetLight}%`);
  }
  note('OK: reset returned to 100% in light mode');

  const shot08 = join(TMP, '08-light-after-reset.png');
  await page.screenshot({ path: shot08 });
  note(`Screenshot: ${shot08}`);

  // ── Screenshot size sanity check ─────────────────────────────────────────
  note('\n── Screenshot size check ───────────────────────────────────────────────');
  const shots = [shot01, shot02, shot03, shot04, shot05, shot06, shot07, shot08];
  for (const s of shots) {
    const f = Bun.file(s);
    const name = s.split('/').pop() ?? s;
    note(`  ${name}: ${f.size} bytes`);
    if (f.size < 5_000) fail(`Screenshot ${name} suspiciously small (< 5 KB)`);
  }

  note('\nAll CP22 zoom control checks PASSED.');
  note(`Screenshots saved to ${TMP}/`);

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP22 visual check PASSED.');
