/**
 * test-help-overlay.ts — CI-runnable Playwright check for the view-aware help
 * overlay (the "what am I looking at?" modal).
 *
 * Proves the wiring end-to-end on the real app (not just the pure resolver,
 * which test-shortcuts.ts T16 covers):
 *  1. The top-bar (?) button opens the help modal on every view.
 *  2. The modal content is view-aware: graph shows "Entity types", flow shows
 *     "Symbols", dict shows its lens rows.
 *  3. The `?` key opens the modal too.
 *  4. Escape closes it.
 *  5. Editable guard: typing `?` in the search box inserts a literal `?` and
 *     does NOT open the modal.
 *
 * Serves models/key-inherited via the source CLI — no compiled binary needed.
 * Screenshots land in tmp/help-overlay/ for manual inspection.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'help-overlay');
mkdirSync(TMP, { recursive: true });

const PORT = 7455;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

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

if (!(await waitForServer(BASE, 12_000))) fail('Server did not start within 12 seconds');
note(`Server ready at ${BASE}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

async function shot(name: string): Promise<void> {
  const p = join(TMP, name);
  await page.screenshot({ path: p, fullPage: false });
  note(`Screenshot: ${p}`);
}

async function helpOpen(): Promise<boolean> {
  return (await page.locator('.help-modal').count()) > 0;
}

try {
  // ── graph view: button opens, content view-aware, screenshot ───────────────
  await page.goto(`${BASE}/#view=graph`);
  await page.waitForSelector('.help-toggle', { timeout: 10_000 });
  await page.waitForTimeout(500);

  if (await helpOpen()) fail('help modal open before any trigger on graph');

  await page.locator('.help-toggle').click();
  await page.waitForSelector('.help-modal', { timeout: 5_000 });
  if (!(await page.getByText('Entity types').count())) {
    fail('graph help missing "Entity types" section');
  }
  if (!(await page.getByText('Key-inherited').count())) {
    fail('graph help missing "Key-inherited" modeling-style row');
  }
  note('✓ graph: (?) button opens help with Entity types + Key-inherited rows');
  await shot('graph-help.png');

  // Escape closes.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (await helpOpen()) fail('Escape did not close help on graph');
  note('✓ graph: Escape closes help');

  // `?` key opens it.
  await page.keyboard.press('?');
  await page.waitForTimeout(200);
  if (!(await helpOpen())) fail('`?` key did not open help on graph');
  note('✓ graph: `?` key opens help');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ── flow view: Symbols section ─────────────────────────────────────────────
  await page.goto(`${BASE}/#view=flow`);
  await page.waitForSelector('.help-toggle', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.locator('.help-toggle').click();
  await page.waitForSelector('.help-modal', { timeout: 5_000 });
  if (!(await page.getByText('Symbols').count())) fail('flow help missing "Symbols" section');
  note('✓ flow: help shows Symbols section');
  await shot('flow-help.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ── dict view: open + editable guard ───────────────────────────────────────
  await page.goto(`${BASE}/#view=dict`);
  await page.waitForSelector('.dict-search-input', { timeout: 10_000 });
  await page.waitForTimeout(500);

  await page.locator('.help-toggle').click();
  await page.waitForSelector('.help-modal', { timeout: 5_000 });
  if (!(await page.getByText('Spotlight').count())) fail('dict help missing "Spotlight" row');
  note('✓ dict: help shows Spotlight row');
  await shot('dict-help.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (await helpOpen()) fail('Escape did not close help on dict');

  // Editable guard: typing `?` in the search box inserts the char, no modal.
  await page.locator('.dict-search-input').click();
  await page.locator('.dict-search-input').type('?');
  await page.waitForTimeout(200);
  if (await helpOpen()) fail('typing `?` in search box opened help (editable guard failed)');
  const val = await page.locator('.dict-search-input').inputValue();
  if (!val.includes('?')) fail(`search box did not receive the literal '?' (value="${val}")`);
  note('✓ dict: `?` in search box inserts a literal char, does not open help');

  note('\nPASS: help overlay verified (button + `?` key + Escape + view-aware + editable guard)');
} finally {
  await browser.close();
  proc.kill();
}
