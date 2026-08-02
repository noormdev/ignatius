/**
 * test-dict-search-branding-overlap.ts — the DD search bar must never sit under
 * the branding block.
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
 * Serves models/key-inherited via the source CLI — no compiled binary needed.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'dict-search-branding-overlap');
mkdirSync(TMP, { recursive: true });

const PORT = 7462;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('  FAIL  ' + m); process.exit(1); };
const pass = (m: string) => console.log('  PASS  ' + m);

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

type Box = { x: number; y: number; width: number; height: number };

/** Horizontal gap between the brand's right edge and the input's left edge. */
async function measureGap(): Promise<{ gap: number; brand: Box; input: Box }> {
  const brandEl = page.locator('.branding-block');
  const inputEl = page.locator('.dict-search-input');
  const brand = await brandEl.boundingBox();
  const input = await inputEl.boundingBox();
  if (brand === null) fail('.branding-block has no bounding box');
  if (input === null) fail('.dict-search-input has no bounding box');
  return { gap: input.x - (brand.x + brand.width), brand, input };
}

/** True when the two boxes overlap on BOTH axes (i.e. actually cover each other). */
function overlaps(a: Box, b: Box): boolean {
  const xOverlap = a.x < b.x + b.width && b.x < a.x + a.width;
  const yOverlap = a.y < b.y + b.height && b.y < a.y + a.height;
  return xOverlap && yOverlap;
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
const WIDTHS = [1920, 1440, 1280, 1100, 1050, 900, 800];
// `setViewportSize` resolves before the page has necessarily re-laid-out, and
// the bar's indent is computed from 100vw — so a stale viewport yields the
// PREVIOUS width's padding and the boxes read as overlapping. Wait for the
// viewport the CSS actually sees, then for the geometry to settle; on timeout
// fall through so the assert below reports real numbers rather than a bare
// Playwright error. A fixed sleep here passed locally and twice in CI, then
// failed 3/3 on a loaded machine.
async function settleAt(width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForFunction(w => window.innerWidth === w, width, { timeout: 5000 });
  try {
    await page.waitForFunction(() => {
      const b = document.querySelector('.branding-block')?.getBoundingClientRect();
      const i = document.querySelector('.dict-search-input')?.getBoundingClientRect();
      return b !== undefined && i !== undefined && i.x >= b.x + b.width;
    }, undefined, { timeout: 5000 });
  } catch {}
}

for (const width of WIDTHS) {
  await settleAt(width);

  const { gap, brand, input } = await measureGap();
  if (overlaps(brand, input)) {
    await page.screenshot({ path: join(TMP, `overlap-${width}.png`) });
    fail(
      `${width}px: branding block covers the search input ` +
      `(brand ends at ${Math.round(brand.x + brand.width)}, input starts at ${Math.round(input.x)})`,
    );
  }
  if (gap < 0) fail(`${width}px: negative horizontal gap (${Math.round(gap)}px)`);
  pass(`${width}px: no overlap, gap ${Math.round(gap)}px`);
}

// ── 3. A 50-char title (the parser's cap) must still clear ──────────────────
// This is the case a hard-coded gutter would fail: the block gets much wider,
// and only a measured gutter grows with it.
await settleAt(1050);
await page.evaluate(() => {
  const el = document.querySelector('.branding-title');
  if (el !== null) el.textContent = 'A'.repeat(50);
});
// The widened title has to reach the ResizeObserver, then --branding-gutter,
// then the bar's padding — three hops, so poll for the outcome.
try {
  await page.waitForFunction(() => {
    const b = document.querySelector('.branding-block')?.getBoundingClientRect();
    const i = document.querySelector('.dict-search-input')?.getBoundingClientRect();
    return b !== undefined && i !== undefined && i.x >= b.x + b.width;
  }, undefined, { timeout: 5000 });
} catch {}

const wide = await measureGap();
if (overlaps(wide.brand, wide.input)) {
  await page.screenshot({ path: join(TMP, 'overlap-long-title.png') });
  fail(
    `50-char title at 1050px: branding block covers the search input ` +
    `(brand ends at ${Math.round(wide.brand.x + wide.brand.width)}, input starts at ${Math.round(wide.input.x)})`,
  );
}
pass(`50-char title at 1050px: no overlap, gap ${Math.round(wide.gap)}px`);

await page.screenshot({ path: join(TMP, 'final-1050-long-title.png') });

await browser.close();
proc.kill();
console.log('\ntest-dict-search-branding-overlap: all assertions passed.');
