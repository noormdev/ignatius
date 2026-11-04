// A Mermaid diagram opens in a zoomable dialog on click, from a page or from inside another dialog;
// a dialog's edge drags it wider, and the width is saved. Screenshots land in tmp/mermaid-zoom-modal-resize/.

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { existsSync, mkdirSync } from 'node:fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const SHOTS = join(ROOT, 'tmp', 'mermaid-zoom-modal-resize');
const PORT = 3341;
const BASE = `http://localhost:${PORT}`;

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}
mkdirSync(SHOTS, { recursive: true });

const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };
function assert(cond: boolean, label: string) {
  if (!cond) fail(label);
  console.log(`  PASS  ${label}`);
}

async function boxOf(page: Page, selector: string) {
  return (await page.locator(selector).first().boundingBox()) ?? fail(`${selector} has no box`);
}

const handle = serveCommand(join(ROOT, 'models/key-inherited'), { port: PORT });
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const viewport = page.locator('[data-ignatius="mermaid-zoom-viewport"]');
  const level = page.locator('.mermaid-zoom-level');

  // A diagram on the Dictionary page.
  await page.goto(`${BASE}/#view=dict`);
  const diagram = page.locator('#process-Collect-Payment .mermaid-diagram[data-rendered] > svg').first();
  await diagram.waitFor({ timeout: 15_000 });
  await diagram.scrollIntoViewIfNeeded();
  await diagram.click();
  await viewport.waitFor({ timeout: 5_000 });
  assert(await viewport.locator('svg').count() === 1, 'clicking a Dictionary diagram opens it in the zoom dialog');
  await page.screenshot({ path: join(SHOTS, 'zoom-fit.png') });

  const fitLevel = await level.textContent();
  const box = await boxOf(page, '[data-ignatius="mermaid-zoom-viewport"]');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(200);
  const zoomedLevel = await level.textContent();
  assert(fitLevel !== zoomedLevel, `the wheel zooms (${fitLevel} → ${zoomedLevel})`);
  await page.screenshot({ path: join(SHOTS, 'zoom-wheel.png') });

  await page.keyboard.press('Escape');
  assert(await viewport.count() === 0, 'Escape closes the zoom dialog');

  // A diagram inside a process dialog: the dialog frame stops click propagation, so the listener must capture.
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
  await page.reload();
  await page.waitForSelector('g[data-token="proc:Collect-Payment"] g[data-ignatius="flow-info"]', { timeout: 15_000 });
  await page.evaluate(() => {
    document.querySelector('g[data-token="proc:Collect-Payment"] g[data-ignatius="flow-info"]')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
  const inDialog = page.locator('.modal .mermaid-diagram[data-rendered] > svg').first();
  await inDialog.waitFor({ timeout: 10_000 });
  await inDialog.scrollIntoViewIfNeeded();
  await inDialog.click();
  await viewport.waitFor({ timeout: 5_000 });
  assert(await viewport.count() === 1, 'clicking a diagram inside a process dialog opens the zoom dialog');
  await page.keyboard.press('Escape');
  assert(await viewport.count() === 0 && await page.locator('.modal').count() === 1, 'Escape closes only the zoom dialog, leaving the process dialog open');

  // Resize.
  await page.evaluate(() => localStorage.removeItem('ignatius-modal-width:content'));
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/#entity=PaymentMethod`);
  await page.reload();
  await page.locator('.modal-frame').first().waitFor({ timeout: 15_000 });
  const before = await boxOf(page, '.modal-frame');
  const handleBox = await boxOf(page, '.modal-resize--right');
  const hx = handleBox.x + handleBox.width / 2;
  const hy = handleBox.y + handleBox.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 150, hy, { steps: 6 });
  await page.mouse.up();
  const after = await boxOf(page, '.modal-frame');
  assert(Math.abs(after.width - before.width - 300) < 4, `dragging the right edge 150px widens the centred dialog by 300px (${before.width} → ${after.width})`);
  assert(await page.locator('.modal').count() === 1, 'releasing a drag does not close the dialog');
  await page.screenshot({ path: join(SHOTS, 'resized.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const saved = await page.evaluate(() => localStorage.getItem('ignatius-modal-width:content'));
  assert(saved === String(Math.round(after.width)), `the width is saved (${saved})`);

  await page.goto(`${BASE}/#entity=Party`);
  await page.reload();
  await page.locator('.modal-frame').first().waitFor({ timeout: 15_000 });
  const reopened = await boxOf(page, '.modal-frame');
  assert(Math.abs(reopened.width - after.width) < 2, 'the next dialog opens at the saved width');
  await page.locator('.modal-resize--right').dblclick();
  const reset = await boxOf(page, '.modal-frame');
  assert(Math.abs(reset.width - before.width) < 2 && await page.evaluate(() => localStorage.getItem('ignatius-modal-width:content')) === null,
    'a double-click on the edge restores the default width and clears it');

  console.log(`\nAll mermaid zoom and modal resize checks passed. Screenshots in ${SHOTS}`);
} finally {
  await browser.close();
  handle.stop(true);
}
