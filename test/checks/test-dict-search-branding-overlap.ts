/**
 * test-dict-search-branding-overlap.ts — the DD search bar must never sit under
 * the branding block, and its lens toggle never under the help and theme toggles.
 *
 * `.branding-block` is position:fixed at left:16px with z-index 50; the DD
 * search bar is fixed, full-bleed, z-index 30. Above ~1100px viewport the bar's
 * centred max-width:1100px inner leaves enough slack on the left that the two
 * clear each other by accident. Below that the inner goes full-bleed and the
 * brand painted straight over the search input.
 *
 * The fix indents the bar by the branding block's MEASURED width (published as
 * `--branding-gutter` by App.tsx via a ResizeObserver), so this check asserts
 * the real rendered geometry at several widths — including a 50-character title
 * (the parser's cap), which is what would break a hard-coded gutter.
 *
 * Serves models/key-inherited in-process, so the server ends with the check;
 * skips when dist/static is not built.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';
import { box, LONG_SUBTITLE, overlaps, settleAt as settle } from '../chrome-geometry';
import type { Box } from '../chrome-geometry';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'dict-search-branding-overlap');
if (!existsSync(join(ROOT, 'dist/static/index.js'))) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}
mkdirSync(TMP, { recursive: true });

const PORT = 7462;
const BASE = `http://localhost:${PORT}`;

const fail = (m: string): never => { console.error('  FAIL  ' + m); process.exit(1); };
const pass = (m: string) => console.log('  PASS  ' + m);

const server = serveCommand(join(ROOT, 'models/key-inherited'), { port: PORT });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

/** Horizontal gap between the brand's right edge and the input's left edge. */
async function measureGap(): Promise<{ gap: number; brand: Box; input: Box }> {
  const brand = await box(page, '.branding-block');
  const input = await box(page, '.dict-search-input');
  if (brand === null) return fail('.branding-block has no bounding box');
  if (input === null) return fail('.dict-search-input has no bounding box');
  return { gap: input.left - brand.right, brand, input };
}

await page.goto(`${BASE}/#view=dict`, { waitUntil: 'load' });
await page.waitForSelector('.dict-search-input', { timeout: 10_000 });
await page.waitForSelector('.branding-block', { timeout: 10_000 });

// ── 1. The gutter var is actually published ────────────────────────────────
const gutter = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--branding-gutter').trim(),
);
if (!/^\d+px$/.test(gutter) || parseInt(gutter, 10) <= 0) {
  fail(`--branding-gutter should be a positive px value, got "${gutter}"`);
}
pass(`--branding-gutter published as ${gutter}`);

// ── 2. No overlap across widths — narrow ones are the regression ────────────
const WIDTHS = [1920, 1440, 1280, 1100, 1050, 900, 800, 769, 768, 700, 480, 375];
// A fixed sleep here once failed 3/3 on a loaded machine; settle() waits on the geometry's inputs.
const settleAt = (width: number) => settle(page, width, 900);

async function toggleBoxes(): Promise<{ lens: Box; hint: Box; help: Box; theme: Box }> {
  const lens = await box(page, '.dict-lens-toggle');
  const hint = await box(page, '.dict-search-bar-inner .kbd-hint');
  const help = await box(page, '.help-toggle');
  const theme = await box(page, '.theme-toggle');
  if (lens === null || hint === null || help === null || theme === null) return fail('lens, B hint, help or theme toggle has no bounding box');
  return { lens, hint, help, theme };
}

async function assertRow(label: string): Promise<void> {
  for (const width of WIDTHS) {
    await settleAt(width);

    const { gap, brand, input } = await measureGap();
    if (overlaps(brand, input)) {
      await page.screenshot({ path: join(TMP, `overlap-${width}.png`) });
      fail(
        `${label} ${width}px: branding block covers the search input ` +
        `(brand ends at ${Math.round(brand.right)}, input starts at ${Math.round(input.left)})`,
      );
    }
    const sameRow = input.top < brand.bottom;
    if (sameRow && gap < 0) fail(`${label} ${width}px: negative horizontal gap (${Math.round(gap)}px)`);
    const { lens, hint, help, theme } = await toggleBoxes();
    for (const [name, control] of [['lens', lens], ['B hint', hint]] as const) {
      if (overlaps(control, help) || overlaps(control, theme)) {
        await page.screenshot({ path: join(TMP, `toggle-overlap-${width}.png`) });
        fail(`${label} ${width}px: the ${name} runs under the help or theme toggle (ends at ${Math.round(control.right)}, help starts at ${Math.round(help.left)})`);
      }
      if (control.right > width) fail(`${label} ${width}px: the ${name} leaves the viewport`);
    }
    const inputWidth = input.right - input.left;
    if (inputWidth < 120) fail(`${label} ${width}px: the search input is too narrow to use (${Math.round(inputWidth)}px)`);
    pass(`${label} ${width}px: no overlap, ${sameRow ? `gap ${Math.round(gap)}px` : 'bar on its own row'}, input ${Math.round(inputWidth)}px`);
  }
}

await assertRow('default branding');

// ── 3. A 50-char title (the parser's cap) must still clear ──────────────────
// This is the case a hard-coded gutter would fail: the block gets much wider,
// and only a measured gutter grows with it.
await settleAt(1050);
await page.evaluate(() => {
  const el = document.querySelector('.branding-title');
  if (el !== null) el.textContent = 'A'.repeat(50);
});
// The widened title reaches the bar through the ResizeObserver and --branding-gutter.
await settleAt(1050);

const wide = await measureGap();
if (overlaps(wide.brand, wide.input)) {
  await page.screenshot({ path: join(TMP, 'overlap-long-title.png') });
  fail(
    `50-char title at 1050px: branding block covers the search input ` +
    `(brand ends at ${Math.round(wide.brand.right)}, input starts at ${Math.round(wide.input.left)})`,
  );
}
pass(`50-char title at 1050px: no overlap, gap ${Math.round(wide.gap)}px`);

await page.screenshot({ path: join(TMP, 'final-1050-long-title.png') });

// ── 4. A 50-char subtitle too: the widest block the parser allows, at every width ──
await page.evaluate((text) => {
  const el = document.querySelector('.branding-subtitle');
  if (el !== null) el.textContent = text;
}, LONG_SUBTITLE);
await assertRow('50-char title and subtitle');

await browser.close();
server.stop(true);
console.log('\ntest-dict-search-branding-overlap: all assertions passed.');
process.exit(0);
