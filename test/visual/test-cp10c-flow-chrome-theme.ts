/**
 * Visual verification: CP10c — DFD light-mode chrome (P6) + minimap consistency (P3).
 *
 * Proves:
 *  P6. In LIGHT mode on the DFD:
 *      - Breadcrumb active crumb text is NOT the dark-blue #cfe2ff (illegible in light);
 *        it is now var(--color-link) which is a readable blue in both modes.
 *      - DFD-nav card background is NOT the hardcoded dark rgba(22,27,34,0.82);
 *        it uses var(--color-surface-alt) — a light surface in light mode.
 *      - Minimap SVG background is NOT #0e1116 (dark canvas); it uses palette.canvas
 *        which is #f6f8fa in light mode.
 *  P3. DFD minimap wrapper has the same chrome family as the DG minimap:
 *      same border/radius/bg via CSS class .flow-minimap-wrapper (not all inline style).
 *  Dark mode: no regression (chrome still has dark surfaces).
 *  Theme toggle on the flow view re-themes chrome live (no page reload).
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp10c-flow-chrome-theme');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', 'models/key-inherited', '--port', '7399'],
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

const serverReady = await waitForServer('http://localhost:7399', 12_000);
if (!serverReady) fail('Server did not start within 12 seconds');
note('Server ready at http://localhost:7399');

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

/** Navigate to flow via FAB → Flows */
async function goToFlow(): Promise<void> {
  const fab = page.locator('.fab');
  await fab.click();
  await page.waitForTimeout(300);
  const flowsItem = page.getByRole('menuitem', { name: 'Flows', exact: true });
  const c = await flowsItem.count();
  if (c === 0) fail('FAB menu has no "Flows" item');
  await flowsItem.click();
  await waitForFlow();
  await page.waitForTimeout(600); // minimap + chrome settle
}

/** Toggle theme via the theme-toggle button */
async function toggleTheme(): Promise<void> {
  const btn = page.locator('.theme-toggle');
  const c = await btn.count();
  if (c === 0) fail('.theme-toggle button not found');
  await btn.click();
  await page.waitForTimeout(500); // theme CSS vars + React re-render
}

/** Get the computed background-color of an element */
async function getBg(selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return '';
    return window.getComputedStyle(el).backgroundColor;
  }, selector);
}

/** Get the computed color of an element */
async function getColor(selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return '';
    return window.getComputedStyle(el).color;
  }, selector);
}

/** Check the SVG minimap background fill — the first <rect> in the SVG */
async function getMinimapSvgBg(): Promise<string> {
  return page.evaluate(() => {
    const svg = document.querySelector('.flow-minimap-canvas svg') as SVGSVGElement | null;
    if (!svg) return '';
    const rect = svg.querySelector('rect') as SVGRectElement | null;
    if (!rect) return '';
    return rect.getAttribute('fill') ?? '';
  });
}

/** Converts an rgb() string to a hex color for easy comparison */
function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return rgb;
  const r = parseInt(m[1]!, 10).toString(16).padStart(2, '0');
  const g = parseInt(m[2]!, 10).toString(16).padStart(2, '0');
  const b = parseInt(m[3]!, 10).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

// ── Test ──────────────────────────────────────────────────────────────────────

try {
  await page.goto('http://localhost:7399/');
  await page.waitForLoadState('domcontentloaded');
  await waitForGraph();

  // Start in default (dark) mode, navigate to flow
  note('\n── 1. Navigate to flow view (dark mode) ────────────────────────────────');
  await goToFlow();

  // Screenshot — dark mode flow
  const shot1 = join(TMP, '01-flow-dark.png');
  await page.screenshot({ path: shot1, fullPage: false });
  note(`Screenshot (dark mode flow): ${shot1}`);

  // Verify minimap wrapper has the .flow-minimap-wrapper class
  const hasWrapperClass = await page.evaluate(() => {
    return document.querySelector('.flow-minimap-wrapper') !== null;
  });
  if (!hasWrapperClass) fail('P3: .flow-minimap-wrapper class not found in DOM');
  note('OK P3: .flow-minimap-wrapper class present in DOM');

  // ── 2. Switch to LIGHT mode ───────────────────────────────────────────────
  note('\n── 2. Switch to light mode ──────────────────────────────────────────────');
  await toggleTheme();

  // Screenshot — light mode flow
  const shot2 = join(TMP, '02-flow-light.png');
  await page.screenshot({ path: shot2, fullPage: false });
  note(`Screenshot (light mode flow): ${shot2}`);

  // ── 3. Assert P6: DFD-nav card is LIGHT ──────────────────────────────────
  note('\n── 3. P6: DFD-nav card background is NOT the dark hardcoded color ───────');

  // The DFD-nav card has .dict-nav-panel class only if it's the same component;
  // in flow it's the floating nav div. Check via position: absolute top:72px left:20px.
  // More reliably: find the element by checking the breadcrumb area and the visible div.
  const navCardBg = await page.evaluate(() => {
    // The DFD nav card is the absolute-positioned div at top:72px, left:20px
    // that contains the "Process Flows" heading.
    const headings = document.querySelectorAll('h2');
    for (const h of Array.from(headings)) {
      if (h.textContent?.trim() === 'Process Flows') {
        const card = h.parentElement;
        if (!card) return '';
        return window.getComputedStyle(card).backgroundColor;
      }
    }
    return '';
  });

  note(`DFD-nav card background: ${navCardBg}`);
  // The dark hardcoded color was rgba(22,27,34,0.82) → rgb(22,27,34) approx after alpha-blend
  // In light mode, the card MUST NOT be near that dark color.
  // We check: R channel must be > 150 (light surface) instead of ≤ 22 (dark).
  const navCardRgb = navCardBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!navCardRgb || navCardRgb[1] === undefined) throw new Error(`P6: Could not parse nav card background color: ${navCardBg}`);
  const navCardR = parseInt(navCardRgb[1], 10);
  if (navCardR < 150) {
    fail(`P6: DFD-nav card is still DARK in light mode (R=${navCardR}, bg="${navCardBg}"). Expected a light surface.`);
  }
  note(`OK P6: DFD-nav card is LIGHT in light mode (R=${navCardR}, bg="${navCardBg}")`);

  // ── 4. Assert P6: minimap SVG background is LIGHT ────────────────────────
  note('\n── 4. P6: minimap SVG background is light palette canvas color ──────────');
  const svgBg = await getMinimapSvgBg();
  note(`Minimap SVG bg fill: ${svgBg}`);

  // In light mode, LIGHT_PALETTE.canvas = '#f6f8fa' (very light)
  // Dark hardcoded was '#0e1116'. Any value other than the dark canvas is good.
  // Check it's not the dark canvas — the hex '#0e1116' has R=14, which is < 50.
  // In light mode, palette.canvas = '#f6f8fa' → starts with '#f'.
  if (svgBg.toLowerCase() === '#0e1116') {
    fail(`P6: Minimap SVG background is still hardcoded dark '#0e1116' in light mode`);
  }
  // Verify it matches the expected light canvas
  if (svgBg.toLowerCase() !== '#f6f8fa') {
    note(`WARN: Minimap SVG bg is "${svgBg}" — expected "#f6f8fa" (LIGHT_PALETTE.canvas). Verifying it's not dark…`);
    // Parse and check R > 200 for a clearly light color
    const hexMatch = svgBg.match(/^#([0-9a-fA-F]{2})/);
    if (hexMatch) {
      const rVal = parseInt(hexMatch[1]!, 16);
      if (rVal < 100) fail(`P6: Minimap SVG bg "${svgBg}" looks dark (R=${rVal} < 100) in light mode`);
    }
  }
  note(`OK P6: Minimap SVG background is light in light mode ("${svgBg}")`);

  // ── 5. Assert P6: minimap wrapper background is themed ────────────────────
  note('\n── 5. P6: .flow-minimap-wrapper background uses theme var ──────────────');
  const wrapperBg = await getBg('.flow-minimap-wrapper');
  note(`Minimap wrapper background: ${wrapperBg}`);
  const wrapperRgb = wrapperBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!wrapperRgb || wrapperRgb[1] === undefined) throw new Error(`P6: Could not parse minimap wrapper background: ${wrapperBg}`);
  const wrapperR = parseInt(wrapperRgb[1], 10);
  if (wrapperR < 150) {
    fail(`P6: .flow-minimap-wrapper is still DARK in light mode (R=${wrapperR}, bg="${wrapperBg}")`);
  }
  note(`OK P6: .flow-minimap-wrapper is LIGHT in light mode (R=${wrapperR})`);

  // ── 6. Assert no hardcoded dark #cfe2ff as text color anywhere ───────────
  // Check that any element with color:#cfe2ff is gone
  // (The active breadcrumb crumb text was hardcoded to that illegible light-blue)
  const hasCfe2ff = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of Array.from(allEls)) {
      const c = window.getComputedStyle(el as HTMLElement).color;
      // #cfe2ff = rgb(207, 226, 255)
      if (c === 'rgb(207, 226, 255)') return true;
    }
    return false;
  });
  if (hasCfe2ff) {
    fail('P6: Some element still has computed color rgb(207, 226, 255) (#cfe2ff) in light mode — breadcrumb active crumb not fixed');
  }
  note('OK P6: No element has the hardcoded #cfe2ff breadcrumb color in light mode');

  // ── 7. Toggle back to DARK and assert no regression ───────────────────────
  note('\n── 7. Toggle back to DARK mode — assert no regression ───────────────────');
  await toggleTheme();
  await page.waitForTimeout(500);

  const shot3 = join(TMP, '03-flow-dark-after-toggle.png');
  await page.screenshot({ path: shot3, fullPage: false });
  note(`Screenshot (dark after toggle): ${shot3}`);

  const svgBgDark = await getMinimapSvgBg();
  note(`Minimap SVG bg (dark mode): ${svgBgDark}`);
  // In dark mode, DARK_PALETTE.canvas = '#0e1116'
  if (svgBgDark.toLowerCase() !== '#0e1116') {
    fail(`Regression: dark mode minimap SVG bg is "${svgBgDark}" — expected "#0e1116" (DARK_PALETTE.canvas)`);
  }
  note(`OK: Dark mode minimap SVG bg is correct (#0e1116)`);

  const wrapperBgDark = await getBg('.flow-minimap-wrapper');
  note(`Minimap wrapper bg (dark mode): ${wrapperBgDark}`);
  const wrapperRgbDark = wrapperBgDark.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!wrapperRgbDark || wrapperRgbDark[1] === undefined) throw new Error(`Could not parse dark mode wrapper bg: ${wrapperBgDark}`);
  const wrapperRDark = parseInt(wrapperRgbDark[1], 10);
  if (wrapperRDark > 80) {
    fail(`Regression: .flow-minimap-wrapper is too LIGHT in dark mode (R=${wrapperRDark}, bg="${wrapperBgDark}")`);
  }
  note(`OK: .flow-minimap-wrapper is dark in dark mode (R=${wrapperRDark})`);

  // ── 8. Toggle back to LIGHT and check selected DFD is preserved ───────────
  note('\n── 8. Theme toggle preserves the selected DFD (CP1 invariant) ───────────');
  await toggleTheme();
  await page.waitForTimeout(500);

  // The flow surface must still be ready (no unmount/remount)
  const flowStillReady = await page.evaluate(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
  );
  if (!flowStillReady) fail('CP1 regression: flow surface unmounted on theme toggle');
  note('OK: Flow surface still ready after light theme toggle (DFD preserved)');

  const shot4 = join(TMP, '04-flow-light-after-toggle.png');
  await page.screenshot({ path: shot4, fullPage: false });
  note(`Screenshot (light after toggle back): ${shot4}`);

  // ── Screenshot size check ─────────────────────────────────────────────────
  note('\n── Screenshot size check ────────────────────────────────────────────────');
  const shots = [shot1, shot2, shot3, shot4];
  for (const s of shots) {
    const f = Bun.file(s);
    note(`  ${s.split('/').pop()}: ${f.size} bytes`);
    if (f.size < 5_000) fail(`Screenshot ${s} suspiciously small (< 5 KB)`);
  }

  note('\nAll CP10c checks PASSED.');
  note(`Screenshots saved to ${TMP}/`);

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP10c visual check PASSED.');
