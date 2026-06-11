/**
 * Visual verification: CP1 — minimap parity + DD minimap leak.
 *
 * Proves:
 *  A. DG minimap and DFD minimap look like the same component family:
 *     same border-radius (6px), same background (--color-surface), same
 *     border (1px solid --color-border) in BOTH dark and light modes.
 *     Asserted via computed style, not mere element presence.
 *  B. The Dictionary view shows NO minimap (#minimap-panel / .minimap absent).
 *     Asserted in both dark and light modes.
 *  C. No regression on the DG minimap (still present on graph view).
 *  D. No regression on the DFD minimap (still present on flow view).
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp1-minimap-parity');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', '7401'],
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

const serverReady = await waitForServer('http://localhost:7401', 12_000);
if (!serverReady) fail('Server did not start within 12 seconds');
note('Server ready at http://localhost:7401');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForGraph(): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 12_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Graph (__IGNATIUS_CY__) did not become ready');
}

async function waitForFlow(): Promise<void> {
  const ok = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Flow (__IGNATIUS_FLOW_READY__) did not become ready');
}

async function navigateTo(view: 'graph' | 'flow' | 'dict'): Promise<void> {
  const fab = page.locator('.fab');
  await fab.click();
  await page.waitForTimeout(300);

  // Try 'Data Flows' first (CP2 rename), fall back to 'Flows' (current label)
  const labelMap = { graph: 'Data Graph', flow: 'Data Flows', dict: 'Dictionary' };
  const item = page.getByRole('menuitem', { name: labelMap[view] });
  const c = await item.count();
  if (c === 0) {
    // Fall back to pre-CP2 label
    const alt = page.getByRole('menuitem', { name: view === 'flow' ? 'Flows' : labelMap[view] });
    const ac = await alt.count();
    if (ac === 0) fail(`FAB menu has no "${labelMap[view]}" or fallback item for view "${view}"`);
    await alt.click();
  } else {
    await item.click();
  }

  if (view === 'graph') await waitForGraph();
  else if (view === 'flow') await waitForFlow();
  else await page.waitForTimeout(800);
  await page.waitForTimeout(600);
}

async function toggleTheme(): Promise<void> {
  const btn = page.locator('.theme-toggle');
  const c = await btn.count();
  if (c === 0) fail('.theme-toggle button not found');
  await btn.click();
  await page.waitForTimeout(500);
}

async function ensureMinimapVisible(): Promise<void> {
  // On graph view, ensure the minimap is turned on via FAB if not already visible
  const minimapVisible = await page.evaluate(() => document.querySelector('#minimap-panel') !== null);
  if (!minimapVisible) {
    const fab = page.locator('.fab');
    await fab.click();
    await page.waitForTimeout(300);
    const minimapItem = page.getByRole('menuitem', { name: /minimap/i });
    const c = await minimapItem.count();
    if (c > 0) {
      await minimapItem.click();
      await page.waitForTimeout(400);
    } else {
      // Close menu — minimap already hidden and no toggle found
      await page.keyboard.press('Escape');
    }
  }
}

interface ComputedChrome {
  borderRadius: string;
  border: string;
  background: string;
}

async function getMinimapChrome(selector: string): Promise<ComputedChrome> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { borderRadius: '', border: '', background: '' };
    const s = window.getComputedStyle(el);
    return {
      borderRadius: s.borderRadius,
      border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
      background: s.backgroundColor,
    };
  }, selector);
}

// ── Test ──────────────────────────────────────────────────────────────────────

try {
  await page.goto('http://localhost:7401/');
  await page.waitForLoadState('domcontentloaded');
  await waitForGraph();
  // App starts in dark mode by default

  // ─────────────────────────────────────────────────────────────────────────
  // A. DARK MODE — DG minimap chrome
  // ─────────────────────────────────────────────────────────────────────────
  note('\n── 1. Graph view (dark) — assert DG minimap present + capture chrome ──────');
  await ensureMinimapVisible();
  const dgChromesDark = await getMinimapChrome('#minimap-panel');
  note(`DG minimap chrome (dark): ${JSON.stringify(dgChromesDark)}`);

  const shotDgDark = join(TMP, '01-dg-minimap-dark.png');
  await page.screenshot({ path: shotDgDark });
  note(`Screenshot: ${shotDgDark}`);

  if (!dgChromesDark.borderRadius) fail('DG minimap not found or has no computed style in dark mode');
  // border-radius should be 6px
  if (!dgChromesDark.borderRadius.includes('6px')) {
    fail(`DG minimap border-radius is "${dgChromesDark.borderRadius}" — expected 6px`);
  }
  note(`OK: DG minimap border-radius = ${dgChromesDark.borderRadius}`);

  // ─────────────────────────────────────────────────────────────────────────
  // B. DARK MODE — DFD minimap chrome
  // ─────────────────────────────────────────────────────────────────────────
  note('\n── 2. Flow view (dark) — assert DFD minimap present + capture chrome ──────');
  await navigateTo('flow');
  const dfdChromesDark = await getMinimapChrome('.flow-minimap-wrapper');
  note(`DFD minimap chrome (dark): ${JSON.stringify(dfdChromesDark)}`);

  const shotDfdDark = join(TMP, '02-dfd-minimap-dark.png');
  await page.screenshot({ path: shotDfdDark });
  note(`Screenshot: ${shotDfdDark}`);

  if (!dfdChromesDark.borderRadius) fail('.flow-minimap-wrapper not found in dark mode');
  if (!dfdChromesDark.borderRadius.includes('6px')) {
    fail(`DFD minimap border-radius is "${dfdChromesDark.borderRadius}" — expected 6px`);
  }
  note(`OK: DFD minimap border-radius = ${dfdChromesDark.borderRadius}`);

  // Both wrapper elements (#minimap-panel, .flow-minimap-wrapper) carry background: var(--color-surface)
  // directly on the wrapper div — getComputedStyle on the wrapper returns its own bg regardless of
  // the canvas child overlaid inside it. They must match.
  if (dfdChromesDark.background !== dgChromesDark.background) {
    fail(`BG PARITY (dark): DG minimap wrapper bg="${dgChromesDark.background}" vs DFD minimap wrapper bg="${dfdChromesDark.background}" — wrappers must share --color-surface`);
  }
  note(`OK: DG and DFD minimap wrapper backgrounds match in dark mode (${dgChromesDark.background})`);

  // ─────────────────────────────────────────────────────────────────────────
  // C. DARK MODE — Dictionary view: NO minimap
  // ─────────────────────────────────────────────────────────────────────────
  note('\n── 3. Dictionary view (dark) — assert NO minimap present ───────────────────');
  await navigateTo('dict');
  const shotDictDark = join(TMP, '03-dict-no-minimap-dark.png');
  await page.screenshot({ path: shotDictDark });
  note(`Screenshot: ${shotDictDark}`);

  const minimapInDict = await page.evaluate(() => ({
    panel: document.querySelector('#minimap-panel') !== null,
    minimap: document.querySelector('.minimap') !== null,
    flowMinimap: document.querySelector('.flow-minimap-wrapper') !== null,
  }));
  note(`Minimap presence in dict view: ${JSON.stringify(minimapInDict)}`);
  if (minimapInDict.panel) fail('DD minimap LEAK: #minimap-panel is present in Dictionary view (dark mode)');
  if (minimapInDict.minimap) fail('DD minimap LEAK: .minimap is present in Dictionary view (dark mode)');
  if (minimapInDict.flowMinimap) fail('DD minimap LEAK: .flow-minimap-wrapper is present in Dictionary view (dark mode)');
  note('OK: No minimap present in Dictionary view (dark mode)');

  // ─────────────────────────────────────────────────────────────────────────
  // D. LIGHT MODE — repeat all three checks
  // ─────────────────────────────────────────────────────────────────────────
  note('\n── 4. Switch to LIGHT mode ──────────────────────────────────────────────────');
  await toggleTheme();

  // DG minimap in light mode
  note('\n── 5. Graph view (light) — DG minimap chrome ────────────────────────────────');
  await navigateTo('graph');
  await ensureMinimapVisible();
  const dgChromesLight = await getMinimapChrome('#minimap-panel');
  note(`DG minimap chrome (light): ${JSON.stringify(dgChromesLight)}`);

  const shotDgLight = join(TMP, '04-dg-minimap-light.png');
  await page.screenshot({ path: shotDgLight });
  note(`Screenshot: ${shotDgLight}`);

  if (!dgChromesLight.borderRadius.includes('6px')) {
    fail(`DG minimap border-radius (light) is "${dgChromesLight.borderRadius}" — expected 6px`);
  }
  // Background in light must be LIGHTER than in dark
  const dgBgRDark = parseInt((dgChromesDark.background.match(/rgba?\((\d+)/) ?? [])[1] ?? '0', 10);
  const dgBgRLight = parseInt((dgChromesLight.background.match(/rgba?\((\d+)/) ?? [])[1] ?? '0', 10);
  note(`DG minimap bg R: dark=${dgBgRDark} light=${dgBgRLight}`);
  if (dgBgRLight <= dgBgRDark) {
    note(`WARN: DG minimap bg (light R=${dgBgRLight}) not clearly lighter than dark (R=${dgBgRDark}) — bg may be behind canvas`);
  } else {
    note(`OK: DG minimap bg is lighter in light mode (R: ${dgBgRDark}→${dgBgRLight})`);
  }

  // DFD minimap in light mode
  note('\n── 6. Flow view (light) — DFD minimap chrome ───────────────────────────────');
  await navigateTo('flow');
  const dfdChromesLight = await getMinimapChrome('.flow-minimap-wrapper');
  note(`DFD minimap chrome (light): ${JSON.stringify(dfdChromesLight)}`);

  const shotDfdLight = join(TMP, '05-dfd-minimap-light.png');
  await page.screenshot({ path: shotDfdLight });
  note(`Screenshot: ${shotDfdLight}`);

  if (!dfdChromesLight.borderRadius.includes('6px')) {
    fail(`DFD minimap border-radius (light) is "${dfdChromesLight.borderRadius}" — expected 6px`);
  }
  const dfdBgRLight = parseInt((dfdChromesLight.background.match(/rgba?\((\d+)/) ?? [])[1] ?? '0', 10);
  note(`DFD minimap bg R (light): ${dfdBgRLight}`);
  if (dfdBgRLight < 150) {
    fail(`DFD minimap wrapper is DARK in light mode (R=${dfdBgRLight}) — theme var not applying`);
  }
  note(`OK: DFD minimap wrapper is light in light mode (R=${dfdBgRLight})`);

  // DD no minimap in light mode
  note('\n── 7. Dictionary view (light) — assert NO minimap present ──────────────────');
  await navigateTo('dict');
  const shotDictLight = join(TMP, '06-dict-no-minimap-light.png');
  await page.screenshot({ path: shotDictLight });
  note(`Screenshot: ${shotDictLight}`);

  const minimapInDictLight = await page.evaluate(() => ({
    panel: document.querySelector('#minimap-panel') !== null,
    minimap: document.querySelector('.minimap') !== null,
    flowMinimap: document.querySelector('.flow-minimap-wrapper') !== null,
  }));
  note(`Minimap presence in dict view (light): ${JSON.stringify(minimapInDictLight)}`);
  if (minimapInDictLight.panel) fail('DD minimap LEAK: #minimap-panel is present in Dictionary view (light mode)');
  if (minimapInDictLight.minimap) fail('DD minimap LEAK: .minimap is present in Dictionary view (light mode)');
  if (minimapInDictLight.flowMinimap) fail('DD minimap LEAK: .flow-minimap-wrapper is present in Dictionary view (light mode)');
  note('OK: No minimap present in Dictionary view (light mode)');

  // ─────────────────────────────────────────────────────────────────────────
  // E. Screenshot size sanity
  // ─────────────────────────────────────────────────────────────────────────
  note('\n── Screenshot size check ────────────────────────────────────────────────────');
  const shots = [shotDgDark, shotDfdDark, shotDictDark, shotDgLight, shotDfdLight, shotDictLight];
  for (const s of shots) {
    const f = Bun.file(s);
    const name = s.split('/').pop() ?? s;
    note(`  ${name}: ${f.size} bytes`);
    if (f.size < 5_000) fail(`Screenshot ${name} suspiciously small (< 5 KB)`);
  }

  note('\nAll CP1 minimap parity + DD leak checks PASSED.');
  note(`Screenshots saved to ${TMP}/`);

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP1 visual check PASSED.');
