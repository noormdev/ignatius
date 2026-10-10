/** test-modal-above-banner.ts — an open modal stays clickable while the global findings banner is showing. */

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { serveCommand } from '../../src/server/server';
import { assert } from '../assert';

const ROOT = resolve(import.meta.dir, '../..');
const BROKEN = join(ROOT, 'models/broken-demo');
const JSON_MODEL = join(ROOT, 'models/key-inherited');

const WATCHDOG_MS = 60_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-modal-above-banner.ts exceeded its ${WATCHDOG_MS}ms watchdog`);
  process.exit(1);
}, WATCHDOG_MS);

async function closeIsTopmost(page: Page, closeSelector: string) {
  return page.evaluate((sel) => {
    const closes = document.querySelectorAll(sel);
    const close = closes[closes.length - 1];
    const banner = document.querySelector('.graph-global-banner');
    if (!close || !banner) return { found: false, top: false, overlaps: false };
    const c = close.getBoundingClientRect();
    const b = banner.getBoundingClientRect();
    const x = c.left + c.width / 2;
    const y = c.top + c.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { found: true, top: hit !== null && (hit === close || close.contains(hit)), overlaps: y >= b.top && y <= b.bottom };
  }, closeSelector);
}

const brokenHandle = serveCommand(BROKEN, { port: 3307 });
const jsonHandle = serveCommand(JSON_MODEL, { port: 3308 });
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 420 } });
  await page.goto('http://localhost:3307/#entity=Product');
  await page.waitForSelector('.graph-global-banner', { timeout: 15_000 });
  await page.waitForSelector('.modal-close', { timeout: 15_000 });
  const entity = await closeIsTopmost(page, '.modal-close');
  assert(entity.found && entity.overlaps, `FAIL: fixture: the entity modal's close button sits inside the banner band ${JSON.stringify(entity)}`);
  assert(entity.top, `FAIL: the entity modal's close button is topmost under the banner ${JSON.stringify(entity)}`);
  await page.locator('.modal-close').click({ timeout: 5_000 });
  await page.waitForSelector('.modal-close', { state: 'detached', timeout: 5_000 });

  // No demo model has both global errors and JSON example values, so the banner is injected with its real class.
  const dict = await browser.newPage({ viewport: { width: 1280, height: 420 } });
  await dict.goto('http://localhost:3308/#view=dict');
  await dict.waitForSelector('.json-value-expand', { timeout: 15_000 });
  await dict.evaluate(() => {
    const banner = document.createElement('div');
    banner.className = 'graph-global-banner';
    banner.setAttribute('role', 'alert');
    banner.style.height = '160px';
    document.body.appendChild(banner);
  });
  await dict.locator('.json-value-expand').first().click({ timeout: 5_000 });
  await dict.waitForSelector('.modal-json .modal-close', { timeout: 5_000 });
  const fromDict = await closeIsTopmost(dict, '.modal-json .modal-close');
  assert(fromDict.found && fromDict.overlaps, `FAIL: fixture: the dictionary JSON dialog's close button sits inside the banner band ${JSON.stringify(fromDict)}`);
  assert(fromDict.top, `FAIL: a JSON dialog opened from the dictionary is topmost under the banner ${JSON.stringify(fromDict)}`);
  await dict.locator('.modal-json .modal-close').click({ timeout: 5_000 });
  await dict.waitForSelector('.modal-json', { state: 'detached', timeout: 5_000 });

  const stacked = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await stacked.goto('http://localhost:3308/#entity=PaymentMethod');
  await stacked.waitForSelector('.modal .json-value-expand', { timeout: 15_000 });
  await stacked.locator('.modal .json-value-expand').first().click({ timeout: 5_000 });
  await stacked.waitForSelector('.modal-backdrop-stacked', { timeout: 5_000 });
  await stacked.mouse.click(5, 5);
  await stacked.waitForSelector('.modal-backdrop-stacked', { state: 'detached', timeout: 5_000 });
  const backdropsLeft = await stacked.locator('.modal-backdrop').count();
  assert(backdropsLeft === 1, `FAIL: a backdrop click closes only the stacked JSON dialog, not its opener (backdrops left: ${backdropsLeft})`);

  console.log(process.exitCode ? '\nmodal-above-banner: failures above.' : '\nAll modal-above-banner checks passed.');
} finally {
  await browser.close();
  brokenHandle.stop(true);
  jsonHandle.stop(true);
  clearTimeout(watchdog);
}
