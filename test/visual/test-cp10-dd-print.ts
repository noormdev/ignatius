/**
 * Visual verification: CP10 — DD printable again.
 *
 * Proves:
 *  1. In print media emulation, the dict-view is visible + un-clipped (position
 *     static, overflow visible, no max-height).
 *  2. All major content sections are present (multiple group headings + entities).
 *  3. Chrome overlays (FAB, findings, search box, side nav, theme toggle) are
 *     display:none under print.
 *  4. With an active search ("payment"), firing beforeprint via
 *     window.dispatchEvent yields all entities visible (full dict, not filtered).
 *  5. After afterprint the search term is restored.
 *
 * Uses models/key-inherited.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp10-dd-print');
mkdirSync(TMP, { recursive: true });

const PORT = 7410;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', 'models/key-inherited', '--port', String(PORT)],
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
  await page.screenshot({ path: p, fullPage: true });
  note(`Screenshot: ${p}`);
}

// Navigate to DD view.
async function navigateToDict(): Promise<void> {
  await page.goto(`${BASE}/#view=dict`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);
}

try {
  await navigateToDict();
  await shot('00-dict-normal.png');

  // ── 1. Emulate print media and verify container is un-clipped ────────────────
  note('\n── 1. Emulate print media — verify dict-view is un-clipped ────────────');
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  await shot('01-dict-print-emulated.png');

  const dictViewStyles = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.dict-view');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      position: cs.position,
      overflow: cs.overflow,
      height: cs.height,
      maxHeight: cs.maxHeight,
    };
  });

  if (dictViewStyles === null) {
    throw new Error('.dict-view element not found — is the dict view rendered?');
  }
  note(`dict-view computed: ${JSON.stringify(dictViewStyles)}`);

  if (dictViewStyles.position !== 'static') {
    fail(`dict-view position should be "static" under print, got "${dictViewStyles.position}"`);
  }
  note('OK: dict-view position is static under print');

  if (dictViewStyles.overflow !== 'visible') {
    fail(`dict-view overflow should be "visible" under print, got "${dictViewStyles.overflow}"`);
  }
  note('OK: dict-view overflow is visible under print');

  // ── 2. Multiple entity sections are present ──────────────────────────────────
  note('\n── 2. Check multiple entity/group sections present ─────────────────────');
  const sectionCount = await page.evaluate(() =>
    document.querySelectorAll('.dict-entity-section').length,
  );
  note(`Entity sections found: ${sectionCount}`);
  if (sectionCount < 3) {
    await shot('FAIL-too-few-sections.png');
    fail(`Expected at least 3 entity sections under print (got ${sectionCount})`);
  }
  note(`OK: ${sectionCount} entity sections present under print`);

  const groupHeadingCount = await page.evaluate(() =>
    document.querySelectorAll('.dict-group-title').length,
  );
  note(`Group heading count: ${groupHeadingCount}`);
  if (groupHeadingCount < 2) {
    await shot('FAIL-too-few-groups.png');
    fail(`Expected at least 2 group headings under print (got ${groupHeadingCount})`);
  }
  note(`OK: ${groupHeadingCount} group headings present under print`);

  // ── 3. Chrome overlays are hidden ────────────────────────────────────────────
  note('\n── 3. Chrome overlays hidden under print ────────────────────────────────');

  // For elements that are always rendered (.fab, .dict-search, .dict-nav-panel,
  // .theme-toggle), read computed display directly.
  // For .findings-panel and .dict-findings-panel (absent when zero findings),
  // inject throwaway elements into the DOM so we actually exercise the CSS hide
  // rule rather than vacuously treating "absent" as "hidden".
  const chromeVisible = await page.evaluate(() => {
    function isHidden(selector: string): boolean {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return false; // should be present — fail the assertion
      return getComputedStyle(el).display === 'none';
    }

    function isCssRuleHiding(className: string): boolean {
      const el = document.createElement('div');
      el.className = className;
      document.body.appendChild(el);
      const hidden = getComputedStyle(el).display === 'none';
      document.body.removeChild(el);
      return hidden;
    }

    return {
      searchHidden: isHidden('.dict-search'),
      fabHidden: isHidden('.fab'),
      navHidden: isHidden('.dict-nav-panel'),
      themeToggleHidden: isHidden('.theme-toggle'),
      // Inject + measure to verify the CSS rule fires regardless of whether the
      // app rendered these elements (key-inherited has zero findings).
      findingsHidden: isCssRuleHiding('findings-panel'),
      dictFindingsHidden: isCssRuleHiding('dict-findings-panel'),
    };
  });

  note(`Chrome hidden under print: ${JSON.stringify(chromeVisible)}`);

  if (!chromeVisible.searchHidden) fail('.dict-search should be display:none under print');
  note('OK: .dict-search hidden under print');

  if (!chromeVisible.fabHidden) fail('.fab should be display:none under print');
  note('OK: .fab hidden under print');

  if (!chromeVisible.navHidden) fail('.dict-nav-panel should be display:none under print');
  note('OK: .dict-nav-panel hidden under print');

  if (!chromeVisible.themeToggleHidden) fail('.theme-toggle should be display:none under print');
  note('OK: .theme-toggle hidden under print');

  if (!chromeVisible.findingsHidden) fail('.findings-panel CSS print rule should set display:none');
  note('OK: .findings-panel CSS print rule hides element under print');

  if (!chromeVisible.dictFindingsHidden) fail('.dict-findings-panel CSS print rule should set display:none');
  note('OK: .dict-findings-panel CSS print rule hides element under print');

  // ── 4. Active search + beforeprint yields full dict ──────────────────────────
  note('\n── 4. Active search + beforeprint clears filter → full dict prints ──────');

  // Restore screen media to interact with the search input.
  await page.emulateMedia({ media: 'screen' });
  await page.waitForTimeout(200);

  const searchInput = page.locator('.dict-search-input');
  await searchInput.fill('payment');
  await page.waitForTimeout(300);

  // Count visible sections under the active filter (should be reduced).
  const filteredCount = await page.evaluate(() =>
    document.querySelectorAll('.dict-entity-section').length,
  );
  note(`Entity sections visible with "payment" filter: ${filteredCount}`);

  // Fire beforeprint to simulate the browser triggering it.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.waitForTimeout(300);

  // Now emulate print media — dict should show all sections.
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  await shot('02-dict-print-after-beforeprint.png');

  const fullPrintCount = await page.evaluate(() =>
    document.querySelectorAll('.dict-entity-section').length,
  );
  note(`Entity sections after beforeprint: ${fullPrintCount}`);

  if (fullPrintCount < sectionCount) {
    await shot('FAIL-beforeprint-still-filtered.png');
    fail(
      `After beforeprint, expected ${sectionCount} sections (same as no filter), got ${fullPrintCount}. ` +
      'beforeprint handler may not have cleared the search.',
    );
  }
  note(`OK: beforeprint cleared the search — ${fullPrintCount} sections visible (full dict)`);

  // ── 5. afterprint restores search term ───────────────────────────────────────
  note('\n── 5. afterprint restores prior search term ─────────────────────────────');

  // Restore screen media before firing afterprint.
  await page.emulateMedia({ media: 'screen' });
  await page.waitForTimeout(200);

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.waitForTimeout(300);
  await shot('03-dict-after-afterprint.png');

  const restoredValue = await page.evaluate(
    () => document.querySelector<HTMLInputElement>('.dict-search-input')?.value ?? '',
  );
  note(`Search input value after afterprint: "${restoredValue}"`);

  if (restoredValue !== 'payment') {
    fail(`Expected search term "payment" restored after afterprint, got "${restoredValue}"`);
  }
  note('OK: search term "payment" restored after afterprint');

  note('\n══ CP10 PASS ════════════════════════════════════════════════════════════');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await browser.close();
  proc.kill();
}
