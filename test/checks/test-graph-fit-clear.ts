// The branding, search bar and toggles sit over the canvas top and the footer over its bottom; a fit, on
// load or from the Fit button, leaves every table clear of them (a Tree's root always sits top-left).

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from '../../src/server/server';
import { box, overlaps } from '../chrome-geometry';
import type { Box } from '../chrome-geometry';

const ROOT = resolve(import.meta.dir, '../..');

if (!existsSync(join(ROOT, 'dist/static/index.js'))) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const WATCHDOG_MS = 90_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-graph-fit-clear.ts exceeded its ${WATCHDOG_MS}ms watchdog`);
  process.exit(1);
}, WATCHDOG_MS);

const CHROME = ['.branding-block', '.viewer-search-bar--graph .viewer-search-bar-inner', '.help-toggle', '.branding-footer'];

let failures = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.error(`  FAIL  ${label}`); failures++; }
}

// Tables drawn under a piece of chrome, as "table under selector".
async function covered(page: Page): Promise<string[]> {
  const tables: { id: string; box: Box }[] = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    const panel = document.querySelector('.graph-panel')?.getBoundingClientRect();
    if (!cy || !panel) return [];
    return cy.nodes('[classification]').map((n) => {
      const b = n.renderedBoundingBox({ includeLabels: false });
      return { id: n.id(), box: { left: panel.left + b.x1, right: panel.left + b.x2, top: panel.top + b.y1, bottom: panel.top + b.y2 } };
    });
  });
  if (tables.length === 0) return ['no tables rendered'];
  const hits: string[] = [];
  for (const selector of CHROME) {
    const chrome = await box(page, selector);
    // A selector GraphView's fit also reads that stops matching would let the fit, and this check, ignore it.
    if (chrome === null) {
      hits.push(`${selector} not found`);
      continue;
    }
    for (const t of tables) if (overlaps(t.box, chrome)) hits.push(`${t.id} under ${selector}`);
  }
  return hits;
}

const PORT = 3335;
const handle = serveCommand(join(ROOT, 'models/orm-pure'), { port: PORT });
await new Promise<void>(r => setTimeout(r, 400));
const browser = await chromium.launch();

try {
  const VIEWPORTS: [number, number][] = [[1600, 1000], [1440, 900], [1280, 720]];
  for (const [width, height] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(30_000);
    await page.goto(`http://localhost:${PORT}/#view=graph`, { waitUntil: 'load' });
    await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
    await page.waitForTimeout(2000);
    const onLoad = await covered(page);
    check(onLoad.length === 0, `${width}×${height} on load: no table under the chrome (${onLoad.join(', ') || 'none'})`);
    await page.getByRole('button', { name: 'Fit to screen' }).click();
    await page.waitForTimeout(300);
    const onFit = await covered(page);
    check(onFit.length === 0, `${width}×${height} after Fit: no table under the chrome (${onFit.join(', ') || 'none'})`);
    await page.close();
  }
} catch (err) {
  check(false, err instanceof Error ? err.message : String(err));
} finally {
  clearTimeout(watchdog);
  await browser.close();
  handle.stop();
}

if (failures > 0) {
  console.error(`\nFAIL: test-graph-fit-clear (${failures})`);
  process.exit(1);
}
console.log('PASS: test-graph-fit-clear');
