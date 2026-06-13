/**
 * Visual verification: DD fixed search bar + debounce.
 *
 * Proves:
 *  1. The DD search bar stays pinned at the top of the viewport when the
 *     dictionary is scrolled (position:fixed, so y is always the same).
 *  2. Content scrolls BEHIND the bar — the bar has a non-transparent background
 *     (computed backgroundColor != rgba(0,0,0,0)).
 *  3. Typing is debounced: immediately after typing, the entity list is NOT
 *     yet filtered; ~400ms later the filter has applied.
 *  4. Clearing the input restores the full list (debounced too).
 *
 * CP17: The bar is position:fixed (not sticky-within-content). Tests updated to
 * check .dict-search-bar-inner for the non-transparent background, and to scroll
 * the .dict-view container directly (the bar floats above).
 *
 * Uses models/key-inherited.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'dd-sticky-search');
mkdirSync(TMP, { recursive: true });

const PORT = 7431;
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

try {
  // No networkidle — the SSE /events stream keeps the connection open forever.
  await page.goto(`${BASE}/#view=dict`);
  await page.waitForSelector('.dict-view', { timeout: 10_000 });
  await page.waitForSelector('.dict-search-input', { timeout: 10_000 });
  await page.waitForTimeout(500);

  // ── 1. Fixed: bar stays at the same viewport y after a deep scroll ─────────
  // CP17: bar is position:fixed — it lives outside the scrolled content.
  const boxBefore = await page.locator('.dict-search-bar').boundingBox();
  if (!boxBefore) fail('.dict-search-bar has no bounding box');
  await shot('01-top-of-dict.png');

  await page.evaluate(() => {
    const v = document.querySelector('.dict-view');
    if (v) v.scrollTop = 1500;
  });
  await page.waitForTimeout(300);

  const boxAfter = await page.locator('.dict-search-bar').boundingBox();
  if (!boxAfter) fail('.dict-search-bar has no bounding box after scroll');
  await shot('02-scrolled-1500.png');

  if (boxBefore && boxAfter) {
    if (Math.abs(boxAfter.y - boxBefore.y) > 2) {
      fail(`fixed search bar moved on scroll: y ${boxBefore.y} → ${boxAfter.y} (expected fixed)`);
    }
    note(`✓ search bar fixed at y=${boxAfter.y} after 1500px scroll`);
  }

  // Input must still be visible and interactable while scrolled.
  const inputVisible = await page.locator('.dict-search-input').isVisible();
  if (!inputVisible) fail('search input not visible after scroll');
  note('✓ search input visible while scrolled');

  // ── 2. Non-transparent background: bar's frosted bg is not fully transparent ─
  // CP17: background is on .dict-search-bar-inner (the frosted inner element).
  const bg = await page.evaluate(() => {
    const el = document.querySelector('.dict-search-bar-inner');
    return el ? getComputedStyle(el).backgroundColor : '';
  });
  if (bg === '' || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
    fail(`fixed search bar background is transparent (${bg}) — should be semi-transparent frosted`);
  }
  note(`✓ fixed search bar has non-transparent background: ${bg}`);

  // ── 3. Debounce: filter does NOT apply immediately, applies after ~400ms ───
  await page.evaluate(() => {
    const v = document.querySelector('.dict-view');
    if (v) v.scrollTop = 0;
  });
  await page.waitForTimeout(200);

  const countAll = await page.locator('.dict-entity-section').count();
  if (countAll === 0) fail('no entity sections rendered');
  note(`entity sections (no search): ${countAll}`);

  // pressSequentially with no delay = burst typing; debounce should hold.
  await page.locator('.dict-search-input').pressSequentially('payment');
  const countImmediate = await page.locator('.dict-entity-section').count();
  if (countImmediate !== countAll) {
    fail(`filter applied immediately after typing (${countAll} → ${countImmediate}) — debounce not active`);
  }
  note('✓ filter NOT applied immediately after burst typing (debounce holding)');

  await page.waitForTimeout(450);
  const countDebounced = await page.locator('.dict-entity-section').count();
  if (countDebounced >= countAll) {
    fail(`filter never applied after debounce window (${countAll} → ${countDebounced})`);
  }
  note(`✓ filter applied after debounce: ${countAll} → ${countDebounced} sections`);
  await shot('03-search-payment-debounced.png');

  // ── 4. Clearing restores the full list ──────────────────────────────────────
  await page.locator('.dict-search-input').fill('');
  await page.waitForTimeout(450);
  const countCleared = await page.locator('.dict-entity-section').count();
  if (countCleared !== countAll) {
    fail(`clearing search did not restore full list (${countAll} → ${countCleared})`);
  }
  note('✓ clearing search restores full list');
  await shot('04-cleared.png');

  note('\nPASS: DD sticky search + debounce verified');
} finally {
  await browser.close();
  proc.kill();
}
