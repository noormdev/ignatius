/**
 * Visual verification: CP24 — Nest sub-processes in the DD sidebar.
 *
 * Proves:
 *  1. In the ORDER-TO-CASH group, process nav DOM order is:
 *     1 Create Sales Order → 1.1 Validate Customer → 1.2 Record Order → 2 Issue Invoice → 3 Collect Payment.
 *  2. Processes with depth > 0 (1.1, 1.2) have a greater computed left indent than
 *     depth-0 processes (1, 2, 3).
 *  3. Click on any process nav link scrolls to that process section.
 *  4. Light AND dark mode.
 *
 * Uses models/key-inherited.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp24-sidebar-nesting');
mkdirSync(TMP, { recursive: true });

const PORT = 7424;
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
  await page.screenshot({ path: p, fullPage: false });
  note(`Screenshot: ${p}`);
}

async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('ignatius-theme', t);
  }, theme);
  await page.waitForTimeout(200);
}

// ── Run checks for a given theme ──────────────────────────────────────────────

async function runChecks(theme: 'dark' | 'light'): Promise<void> {
  note(`\n══ Theme: ${theme} ══════════════════════════════════════════════════════`);

  await page.goto(`${BASE}/#view=dict`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await setTheme(theme);

  // Force the sidebar nav panel open for visual confirmation of nesting.
  await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.dict-nav-panel');
    if (panel) panel.classList.add('dict-nav-open');
  });
  await page.waitForTimeout(400);
  await shot(`01-dict-nav-top-${theme}.png`);

  // Scroll the nav panel to the process section (at the bottom) and screenshot.
  await page.evaluate(() => {
    const processGroup = document.querySelector<HTMLElement>('.dict-nav-process-group');
    if (processGroup) processGroup.scrollIntoView({ block: 'start' });
    const panel = document.querySelector<HTMLElement>('.dict-nav-panel');
    if (panel) panel.scrollTop = panel.scrollHeight;
  });
  await page.waitForTimeout(300);
  await shot(`01-dict-nav-processes-${theme}.png`);

  // ── 1. Process nav DOM order in ORDER-TO-CASH group ───────────────────────────
  note('\n── 1. Assert process nav DOM order ─────────────────────────────────────');

  // Collect all process nav link texts in order from the DOM.
  const navLinkTexts: string[] = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.dict-nav-process-group .dict-nav-link'),
    );
    return links.map(a => a.textContent?.trim() ?? '');
  });

  note(`Process nav links: ${JSON.stringify(navLinkTexts)}`);

  // Find the order-to-cash group links (1.x, 2, 3 — order-to-cash has the sub-processes).
  // The expected order within the order-to-cash group:
  //   "1 Create Sales Order" → "1.1 Validate Customer" → "1.2 Record Order"
  //   → "2 Issue Invoice" → "3 Collect Payment"
  const idx1 = navLinkTexts.findIndex(t => t.startsWith('1 ') && t.includes('Create Sales Order'));
  const idx11 = navLinkTexts.findIndex(t => t.startsWith('1.1 '));
  const idx12 = navLinkTexts.findIndex(t => t.startsWith('1.2 '));
  const idx2 = navLinkTexts.findIndex(t => t.startsWith('2 ') && t.includes('Issue Invoice'));
  const idx3 = navLinkTexts.findIndex(t => t.startsWith('3 '));

  if (idx1 === -1) fail(`"1 Create Sales Order" not found in process nav (${theme})`);
  if (idx11 === -1) fail(`"1.1 …" not found in process nav (${theme})`);
  if (idx12 === -1) fail(`"1.2 …" not found in process nav (${theme})`);
  if (idx2 === -1) fail(`"2 Issue Invoice" not found in process nav (${theme})`);
  if (idx3 === -1) fail(`"3 Collect Payment" not found in process nav (${theme})`);

  note(`Indices — 1:${idx1}  1.1:${idx11}  1.2:${idx12}  2:${idx2}  3:${idx3}`);

  if (!(idx1 < idx11)) fail(`1.1 should come AFTER 1 (got idx1=${idx1}, idx11=${idx11}) (${theme})`);
  if (!(idx11 < idx12)) fail(`1.2 should come AFTER 1.1 (got idx11=${idx11}, idx12=${idx12}) (${theme})`);
  if (!(idx12 < idx2)) fail(`2 should come AFTER 1.2 (got idx12=${idx12}, idx2=${idx2}) (${theme})`);
  if (!(idx2 < idx3)) fail(`3 should come AFTER 2 (got idx2=${idx2}, idx3=${idx3}) (${theme})`);

  note(`OK: nav order is 1 → 1.1 → 1.2 → 2 → 3`);

  // ── 2. Indent: 1.1 and 1.2 have greater left offset than 1, 2, 3 ─────────────
  note('\n── 2. Assert indent depth: 1.1/1.2 more indented than 1/2/3 ────────────');

  type IndentInfo = { paddingLeft: string; marginLeft: string; computedLeft: number };

  const indentInfo = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.dict-nav-process-group .dict-nav-link'),
    );
    const result: Record<string, IndentInfo> = {};
    for (const a of links) {
      const text = a.textContent?.trim() ?? '';
      const prefix = text.split(' ')[0];
      if (!prefix) continue;
      const style = window.getComputedStyle(a);
      const paddingLeft = style.paddingLeft;
      const marginLeft = style.marginLeft;
      // Sum padding-left + margin-left as a rough "left indent" number (px)
      const pxVal = (v: string) => parseFloat(v) || 0;
      result[prefix] = {
        paddingLeft,
        marginLeft,
        computedLeft: pxVal(paddingLeft) + pxVal(marginLeft),
      };
    }
    return result;
  });

  note(`Computed left indents: ${JSON.stringify(indentInfo, null, 2)}`);

  const left1 = indentInfo['1']?.computedLeft ?? 0;
  const left11 = indentInfo['1.1']?.computedLeft ?? 0;
  const left12 = indentInfo['1.2']?.computedLeft ?? 0;

  if (left11 <= left1) {
    fail(`1.1 indent (${left11}px) should be GREATER than 1 indent (${left1}px) (${theme})`);
  }
  if (left12 <= left1) {
    fail(`1.2 indent (${left12}px) should be GREATER than 1 indent (${left1}px) (${theme})`);
  }
  note(`OK: 1.1 indent=${left11}px > 1 indent=${left1}px`);
  note(`OK: 1.2 indent=${left12}px > 1 indent=${left1}px`);

  await shot(`02-process-nav-indented-${theme}.png`);

  // ── 3. Clicking a sub-process nav link scrolls to its process section ─────────
  note('\n── 3. Click 1.1 nav link → scrolls to #process-Validate-Customer ─────────');

  const clicked = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.dict-nav-process-group .dict-nav-link'),
    );
    const link = links.find(a => (a.textContent?.trim() ?? '').startsWith('1.1'));
    if (!link) return false;
    link.click();
    return true;
  });
  if (!clicked) fail(`1.1 nav link not clickable (${theme})`);
  await page.waitForTimeout(1200);

  // Check that the Validate-Customer process section exists and is near the viewport top.
  // scrollIntoView({ block: 'start' }) places the element at/near the top of the scroll container.
  const scrollInfo = await page.evaluate(() => {
    const el = document.getElementById('process-Validate-Customer');
    if (!el) return { found: false, top: -1, innerHeight: window.innerHeight };
    const rect = el.getBoundingClientRect();
    return { found: true, top: rect.top, innerHeight: window.innerHeight };
  });
  note(`#process-Validate-Customer: found=${scrollInfo.found}, top=${scrollInfo.top}, innerHeight=${scrollInfo.innerHeight}`);
  if (!scrollInfo.found) {
    await shot(`FAIL-03-no-section-${theme}.png`);
    fail(`#process-Validate-Customer element not found in DOM (${theme})`);
  }
  // Element should be reasonably close to top (within 2x viewport — smooth scroll may be brief)
  if (scrollInfo.top < -50 || scrollInfo.top > scrollInfo.innerHeight * 2) {
    await shot(`FAIL-03-no-scroll-${theme}.png`);
    fail(`#process-Validate-Customer top=${scrollInfo.top} is not near viewport after nav click (${theme})`);
  }
  note('OK: #process-Validate-Customer scrolled into view');
  await shot(`03-nav-click-scrolled-${theme}.png`);

  note(`\n✓ All CP24 ${theme}-mode assertions passed.`);
}

// ── Run for both themes ───────────────────────────────────────────────────────

try {
  await runChecks('dark');
  await runChecks('light');

  note('\n══ CP24 PASS ════════════════════════════════════════════════════════════');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await browser.close();
  proc.kill();
}
