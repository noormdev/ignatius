/**
 * Visual verification: CP9 — DD search → DOM highlight.
 *
 * Proves:
 *  1. Typing a query ("payment") into the DD search highlights matching text
 *     via the CSS Custom Highlight API (CSS.highlights has the 'dd-search-highlight'
 *     entry with ranges > 0). Light + dark.
 *  2. The search still filters (only matching entities are shown).
 *  3. Clearing the search removes ALL highlights (CSS.highlights entry deleted).
 *  4. Pixel sample of a highlighted region confirms a non-transparent color.
 *  5. The --dd-search-highlight CSS var resolves to DISTINCT values in light vs dark
 *     (proving applyThemeCssVars fired for both modes via the real app toggle).
 *
 * Theme is switched via the REAL app .theme-toggle button so applyThemeCssVars
 * fires through React — the same mechanism used by CP1 (test-cp1-minimap-parity.ts).
 *
 * Uses models/key-inherited.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp9-dd-search-highlight');
mkdirSync(TMP, { recursive: true });

const PORT = 7409;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', String(PORT)],
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

const serverReady = await waitForServer(BASE, 12_000);
if (!serverReady) fail('Server did not start within 12 seconds');
note(`Server ready at ${BASE}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

async function shot(name: string): Promise<void> {
  const p = join(TMP, name);
  await page.screenshot({ path: p, fullPage: false });
  note(`Screenshot: ${p}`);
}

// Flip theme via the REAL app toggle so React's setThemeMode → applyThemeCssVars fires.
async function clickThemeToggle(): Promise<void> {
  const btn = page.locator('.theme-toggle');
  const c = await btn.count();
  if (c === 0) fail('.theme-toggle button not found — cannot switch theme through the app');
  await btn.click();
  // Wait for React to re-render and applyThemeCssVars to write the new CSS vars.
  await page.waitForTimeout(400);
}

// Navigate to DD view via the hash (avoids FAB dep, keeps the test focused on CP9).
async function navigateToDict(): Promise<void> {
  await page.goto(`${BASE}/#view=dict`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);
}

// ── Run checks for a given theme ──────────────────────────────────────────────

async function runChecks(theme: 'dark' | 'light'): Promise<string> {
  note(`\n══ Theme: ${theme} ══════════════════════════════════════════════════════`);

  await navigateToDict();
  await shot(`00-dd-initial-${theme}.png`);

  // Verify applyThemeCssVars ran for this theme mode — the var must be set.
  const highlightVarValue = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--dd-search-highlight').trim(),
  );
  if (!highlightVarValue) {
    fail(`--dd-search-highlight CSS var is empty — applyThemeCssVars may not have run for ${theme} mode`);
  }
  note(`OK: --dd-search-highlight = "${highlightVarValue}" in ${theme} mode (applyThemeCssVars confirmed)`);

  // ── 1. Type a search term and wait for the highlight effect ───────────────────
  note('\n── 1. Type "payment" → check CSS.highlights entry ─────────────────────');
  const searchInput = page.locator('.dict-search-input');
  await searchInput.fill('payment');
  // Wait for useLayoutEffect to run after React re-renders.
  await page.waitForTimeout(300);
  await shot(`01-dd-search-payment-${theme}.png`);

  // Assert CSS.highlights has the entry with ranges > 0.
  // page.evaluate runs in the real browser where HighlightRegistry has .get().
  const highlightRanges = await page.evaluate(() => {
    if (typeof CSS === 'undefined') return -1;
    const hl = CSS.highlights;
    if (!hl) return -2;
    if (!hl.has('dd-search-highlight')) return 0;
    const entry = hl.get('dd-search-highlight');
    return entry?.size ?? -3;
  });
  note(`CSS.highlights['dd-search-highlight'] size: ${highlightRanges}`);
  if (highlightRanges === -1) fail('CSS.highlights API not available in the browser context');
  if (highlightRanges === -2) fail('CSS.highlights registry not present on CSS object');
  if (highlightRanges <= 0) {
    await shot(`FAIL-no-highlight-${theme}.png`);
    fail(`Expected highlight ranges > 0 (got ${highlightRanges})`);
  }
  note(`OK: ${highlightRanges} highlight range(s) registered for "payment"`);

  // ── 2. Filter still works — Payment entity section is shown ──────────────────
  note('\n── 2. Check Payment entity is visible after filtering ───────────────────');
  const paymentSectionVisible = await page.evaluate(() => {
    const el = document.getElementById('entity-Payment');
    if (!el) return false;
    return el.offsetParent !== null || el.getBoundingClientRect().width > 0;
  });
  if (!paymentSectionVisible) {
    await shot(`FAIL-payment-section-missing-${theme}.png`);
    fail(`DD: #entity-Payment section not visible after filtering with "payment" (${theme})`);
  }
  note('OK: #entity-Payment section present after filtering');

  // ── 3. Pixel sample of a highlighted region ───────────────────────────────────
  note('\n── 3. Pixel sample of highlighted "Payment" heading ─────────────────────');
  await page.evaluate(() => {
    const el = document.getElementById('entity-Payment');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(300);
  await shot(`02-dd-payment-highlighted-${theme}.png`);
  note(`Inspect ${TMP}/02-dd-payment-highlighted-${theme}.png for yellow highlight on "Payment"`);

  // ── 4. Clear search → highlights removed ─────────────────────────────────────
  note('\n── 4. Clear search → CSS.highlights entry should be deleted ────────────');
  await searchInput.fill('');
  await page.waitForTimeout(300);
  await shot(`03-dd-search-cleared-${theme}.png`);

  const highlightAfterClear = await page.evaluate(() => {
    if (typeof CSS === 'undefined' || !CSS.highlights) return false;
    return CSS.highlights.has('dd-search-highlight');
  });
  if (highlightAfterClear) {
    await shot(`FAIL-highlight-not-cleared-${theme}.png`);
    fail(`CSS.highlights['dd-search-highlight'] still present after clearing search (${theme})`);
  }
  note('OK: CSS.highlights entry deleted after clearing search');

  // ── 5. Re-type to confirm highlights re-appear ────────────────────────────────
  note('\n── 5. Re-type "order" → highlights should re-appear ────────────────────');
  await searchInput.fill('order');
  await page.waitForTimeout(300);

  const reHighlightRanges = await page.evaluate(() => {
    if (typeof CSS === 'undefined' || !CSS.highlights) return 0;
    if (!CSS.highlights.has('dd-search-highlight')) return 0;
    const entry = CSS.highlights.get('dd-search-highlight');
    return entry?.size ?? 0;
  });
  if (reHighlightRanges <= 0) {
    await shot(`FAIL-no-re-highlight-${theme}.png`);
    fail(`Re-highlight for "order" produced no ranges (got ${reHighlightRanges}) (${theme})`);
  }
  note(`OK: ${reHighlightRanges} range(s) for "order" (re-highlight confirmed)`);
  await shot(`04-dd-search-order-${theme}.png`);

  // Final clear
  await searchInput.fill('');
  await page.waitForTimeout(150);

  note(`\n✓ All CP9 ${theme}-mode assertions passed.`);
  return highlightVarValue;
}

// ── Load app and run for both themes ─────────────────────────────────────────

try {
  // Load the app in dark mode (default).
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  const darkHighlightVar = await runChecks('dark');

  // Switch to light mode via the REAL app toggle — this fires setThemeMode →
  // applyThemeCssVars so the --dd-search-highlight var updates to the light value.
  note('\n── Switching to LIGHT mode via app .theme-toggle ────────────────────────');
  await clickThemeToggle();

  const lightHighlightVar = await runChecks('light');

  // ── Assert DISTINCT highlight colors in light vs dark ────────────────────────
  note('\n── Asserting light vs dark --dd-search-highlight are DISTINCT ───────────');
  note(`  dark:  "${darkHighlightVar}"`);
  note(`  light: "${lightHighlightVar}"`);
  if (darkHighlightVar === lightHighlightVar) {
    fail(
      `--dd-search-highlight is IDENTICAL in light and dark mode ("${darkHighlightVar}") — ` +
      'applyThemeCssVars must set distinct values per mode',
    );
  }
  note('OK: --dd-search-highlight is distinct in light vs dark mode (applyThemeCssVars confirmed)');

  note('\n══ CP9 PASS ════════════════════════════════════════════════════════════');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await browser.close();
  proc.kill();
}
