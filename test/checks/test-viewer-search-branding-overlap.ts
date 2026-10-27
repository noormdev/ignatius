// The branding block, the Graph search bar and its count never sit under each other, the
// toggles or the side panels, at any width (SC13, docs/spec/graph-flow-search.md).

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { resolve, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';
import { box, LONG_SUBTITLE, onTop, overlaps, settleAt } from '../chrome-geometry';

const ROOT = resolve(import.meta.dir, '../..');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const TMP = join(ROOT, 'tmp', 'viewer-search-branding-overlap');

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}
mkdirSync(TMP, { recursive: true });

const WATCHDOG_MS = 150_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-viewer-search-branding-overlap.ts exceeded its ${WATCHDOG_MS}ms watchdog`);
  process.exit(1);
}, WATCHDOG_MS);

let failures = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.error(`  FAIL  ${label}`); failures++; }
}

// The count sits outside the bar; "123 of 456" is the widest form SC13 covers.
async function widenCount(page: Page): Promise<void> {
  await page.evaluate(() => {
    const count = document.querySelector('.viewer-search-count');
    if (count !== null) count.textContent = '123 of 456';
  });
}

async function assertGraphClear(page: Page, label: string, width: number): Promise<void> {
  await widenCount(page);
  const brand = await box(page, '.branding-block');
  const pill = await box(page, '.viewer-search-bar--graph .viewer-search-bar-inner');
  const count = await box(page, '.viewer-search-count');
  const help = await box(page, '.help-toggle');
  if (!brand || !pill || !count || !help) {
    check(false, `${label} ${width}px: chrome present`);
    return;
  }
  const clear = !overlaps(brand, pill) && !overlaps(pill, help)
    && !overlaps(count, help) && !overlaps(count, brand)
    && !overlaps(brand, help);
  const inside = pill.left >= 0 && pill.right <= width && count.left >= 0 && count.right <= width;
  if (!clear || !inside) await page.screenshot({ path: join(TMP, `${label.replace(/\W+/g, '-')}-${width}.png`) });
  check(clear && inside, `${label} ${width}px: bar ${Math.round(pill.left)}..${Math.round(pill.right)}, count ..${Math.round(count.right)} clear of brand (..${Math.round(brand.right)}) and toggles (${Math.round(help.left)}..)`);
}

async function assertOnTop(page: Page, label: string, selectors: string[]): Promise<void> {
  for (const selector of selectors) {
    const visible = await onTop(page, selector);
    if (!visible) await page.screenshot({ path: join(TMP, `covered-${label.replace(/\W+/g, '-')}.png`) });
    check(visible, `${label}: ${selector} is not covered`);
  }
}

const WIDTHS = [1920, 1440, 1101, 1100, 900, 800, 769, 768, 700, 600, 480, 375];
const servers = [
  serveCommand(join(ROOT, 'models/key-inherited'), { port: 7466 }),
  serveCommand(join(ROOT, 'models/broken-demo'), { port: 7467 }),
  serveCommand(join(ROOT, 'test/fixtures/broken-flows-model'), { port: 7468 }),
  serveCommand(join(ROOT, 'test/fixtures/flows-leveling'), { port: 7469 }),
];
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
  page.setDefaultTimeout(20_000);
  await page.goto('http://localhost:7466/#view=graph', { waitUntil: 'load' });
  await page.waitForSelector('.viewer-search-bar--graph .viewer-search-input');
  await page.waitForSelector('.branding-block');
  await page.fill('.viewer-search-bar--graph .viewer-search-input', 'a');
  await page.waitForSelector('.viewer-search-count');

  for (const width of WIDTHS) {
    await settleAt(page, width);
    await assertGraphClear(page, 'default branding', width);
  }

  await settleAt(page, 1440);
  const centred = await box(page, '.viewer-search-bar--graph .viewer-search-bar-inner');
  check(centred !== null && Math.abs((centred.left + centred.right) / 2 - 720) <= 1, '1440px: the bar stays centred when there is room');

  await page.evaluate((text) => {
    const subtitle = document.querySelector('.branding-subtitle');
    if (subtitle !== null) subtitle.textContent = text;
  }, LONG_SUBTITLE);
  for (const width of WIDTHS) {
    await settleAt(page, width);
    await assertGraphClear(page, '50-char subtitle', width);
  }
  const brandHeight = await page.evaluate(() => document.querySelector('.branding-block')?.getBoundingClientRect().height ?? 0);
  check(brandHeight <= 50, `the branding block stays one row tall with a 50-char subtitle (${Math.round(brandHeight)}px)`);

  // The Flows bar shares the compact styles; the breadcrumbs start right of a wide branding block.
  await page.goto('http://localhost:7466/#view=flow', { waitUntil: 'load' });
  await page.waitForSelector('.viewer-search-bar--flow .viewer-search-bar-inner');
  await page.waitForSelector('.flow-crumbs');
  await page.evaluate((text) => {
    const subtitle = document.querySelector('.branding-subtitle');
    if (subtitle !== null) subtitle.textContent = text;
  }, LONG_SUBTITLE);
  for (const width of [1440, 1100, 800, 480, 375]) {
    await settleAt(page, width);
    const pill = await box(page, '.viewer-search-bar--flow .viewer-search-bar-inner');
    const help = await box(page, '.help-toggle');
    const crumbs = await box(page, '.flow-crumbs');
    const brand = await box(page, '.branding-block');
    check(pill !== null && help !== null && pill.left >= 0 && pill.right <= width && !overlaps(pill, help),
      `flows ${width}px: bar ${Math.round(pill?.left ?? 0)}..${Math.round(pill?.right ?? 0)} inside the viewport and clear of the toggles`);
    check(crumbs !== null && brand !== null && !overlaps(crumbs, brand),
      `flows ${width}px: breadcrumbs (${Math.round(crumbs?.left ?? 0)}..) clear of a 50-char-subtitle branding block (..${Math.round(brand?.right ?? 0)})`);
  }
  await page.close();

  // Deep breadcrumbs beside a wide branding block wrap short of the toggles, and the bar stays below them.
  const deep = await browser.newPage({ viewport: { width: 1440, height: 800 } });
  deep.setDefaultTimeout(20_000);
  await deep.goto('http://localhost:7469/#view=flow&dfd=Login', { waitUntil: 'load' });
  await deep.waitForSelector('.flow-crumbs');
  await deep.evaluate((text) => {
    const subtitle = document.querySelector('.branding-subtitle');
    if (subtitle !== null) subtitle.textContent = text;
  }, LONG_SUBTITLE);
  for (const width of [1440, 1100, 1000, 940, 800]) {
    await settleAt(deep, width);
    await deep.waitForFunction(() => {
      const crumbs = document.querySelector('.flow-crumbs')?.getBoundingClientRect().bottom ?? 0;
      const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--flow-search-bar-top'));
      return Math.abs(top - crumbs - 12) < 1;
    }, undefined, { timeout: 5000 });
    const crumbs = await box(deep, '.flow-crumbs');
    const help = await box(deep, '.help-toggle');
    const brand = await box(deep, '.branding-block');
    const bar = await box(deep, '.viewer-search-bar--flow .viewer-search-bar-inner');
    const clear = crumbs !== null && help !== null && brand !== null && bar !== null
      && !overlaps(crumbs, help) && !overlaps(crumbs, brand) && !overlaps(crumbs, bar);
    if (!clear) await deep.screenshot({ path: join(TMP, `deep-crumbs-${width}.png`) });
    check(clear, `deep breadcrumbs ${width}px: crumbs ${Math.round(crumbs?.left ?? 0)}..${Math.round(crumbs?.right ?? 0)} clear of the branding, the toggles and the bar`);
  }
  await deep.close();

  // Models with findings open the side panels; they must not cover the bars or the count.
  const demo = await browser.newPage({ viewport: { width: 1440, height: 800 } });
  demo.setDefaultTimeout(20_000);
  await demo.goto('http://localhost:7467/#view=graph', { waitUntil: 'load' });
  await demo.waitForSelector('.side-panel-stack');
  await demo.waitForSelector('.graph-global-banner-close');
  await demo.fill('.viewer-search-bar--graph .viewer-search-input', 'a');
  await demo.waitForSelector('.viewer-search-count');
  for (const width of [1100, 900, 800]) {
    await settleAt(demo, width);
    await widenCount(demo);
    await assertOnTop(demo, `broken-demo graph with banner ${width}px`, ['.viewer-search-bar--graph .viewer-search-input', '.viewer-search-count']);
  }
  await demo.click('.graph-global-banner-close');
  for (const width of [768, 480, 375]) {
    await settleAt(demo, width);
    await widenCount(demo);
    await assertOnTop(demo, `broken-demo graph ${width}px`, ['.viewer-search-bar--graph .viewer-search-input', '.viewer-search-count']);
  }
  await demo.goto('http://localhost:7467/#view=dict', { waitUntil: 'load' });
  await demo.waitForSelector('.dict-search-input');
  for (const width of [768, 480, 375]) {
    await settleAt(demo, width);
    await assertOnTop(demo, `broken-demo dict ${width}px`, ['.dict-search-input']);
  }
  await demo.goto('http://localhost:7468/#view=flow', { waitUntil: 'load' });
  await demo.waitForSelector('.viewer-search-bar--flow .viewer-search-input');
  await demo.waitForSelector('.side-panel-stack');
  for (const width of [1100, 800, 375]) {
    await settleAt(demo, width);
    await assertOnTop(demo, `broken-flows flows ${width}px`, ['.viewer-search-bar--flow .viewer-search-input', '.viewer-search-switch-track']);
  }
} finally {
  clearTimeout(watchdog);
  await browser.close();
  for (const server of servers) server.stop(true);
}

if (failures > 0) {
  console.error(`\ntest-viewer-search-branding-overlap: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\ntest-viewer-search-branding-overlap: all assertions passed.');
process.exit(0);
