/** test-settings-always-open.ts — "Always open examples", set from FAB → Settings, opens long example tables in place, in the flow dialog root too, and survives a reload. */

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { serveCommand } from '../../src/server/server';
import { assert } from '../assert';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const PORT = 3337;
const BASE = `http://localhost:${PORT}`;

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const WATCHDOG_MS = 90_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-settings-always-open.ts exceeded its ${WATCHDOG_MS}ms watchdog`);
  process.exit(1);
}, WATCHDOG_MS);

function extendFixture(path: string, anchor: string, extraRows: string) {
  const text = readFileSync(path, 'utf8');
  const extended = text.replace(anchor, anchor + extraRows);
  if (extended === text) throw new Error(`fixture: anchor not found in ${path}`);
  writeFileSync(path, extended);
}

// key-inherited keeps every example table at 3 rows or fewer, so Product and one Collect-Payment entry gain rows.
const root = mkdtempSync(join(tmpdir(), 'ignatius-settings-'));
const dir = join(root, 'model');
const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });
extendFixture(
  join(dir, 'data/catalog/Product.md'),
  '    sku: SW-DESKTOP-MAC\n    name: Meridian Desktop Client (macOS)\n    list_price: 129.00\n',
  '  - product_id: 13\n    sku: SW-DESKTOP-LNX\n    name: Meridian Desktop Client (Linux)\n    list_price: 129.00\n',
);
extendFixture(
  join(dir, 'flows/order-to-cash/Collect-Payment.md'),
  '        - { card: "****1234", amount: 199.00, currency: USD }\n',
  '        - { card: "****9876", amount: 12.50, currency: EUR }\n        - { card: "****5555", amount: 75.00, currency: USD }\n',
);

const PRODUCT_EXAMPLES = '#entity-Product details.dict-examples';
const SUBSCRIPTION_EXAMPLES = '#entity-Subscription details.dict-examples';
const PAYMENT_DETAILS = '.modal details.modal-examples:has(> summary:text("payment details"))';

function isOpen(page: Page, selector: string) {
  return page.locator(selector).evaluate(el => el instanceof HTMLDetailsElement && el.open);
}

async function setAlwaysOpen(page: Page, on: boolean) {
  await page.click('.fab');
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const box = page.getByRole('dialog', { name: 'Settings' }).getByLabel('Always open examples');
  await box.setChecked(on);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached', timeout: 5_000 });
}

async function openCollectPayment(page: Page) {
  const dispatched = await page.evaluate(() => {
    const badge = document.querySelector('g[data-token="proc:Collect-Payment"] g[data-ignatius="flow-info"]');
    if (!badge) return false;
    badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    return true;
  });
  assert(dispatched, 'FAIL: fixture: Collect-Payment ⓘ badge is on the order-to-cash diagram');
  await page.waitForSelector(PAYMENT_DETAILS, { timeout: 5_000 });
}

const handle = serveCommand(dir, { port: PORT });

try {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.route('**/events', route => route.abort());
    await page.goto(`${BASE}/#view=dict`);
    await page.waitForSelector(PRODUCT_EXAMPLES, { timeout: 15_000 });

    const rows = await page.locator(`${PRODUCT_EXAMPLES} tbody tr`).count();
    assert(rows === 4, `FAIL: fixture: Product shows 4 example rows (got ${rows})`);
    assert(!(await isOpen(page, PRODUCT_EXAMPLES)), 'FAIL: with the setting off, a 4-row example table starts closed');

    await setAlwaysOpen(page, true);
    assert(await isOpen(page, PRODUCT_EXAMPLES), 'FAIL: turning the setting on opens an already-rendered 4-row example table');
    const stored = await page.evaluate(() => localStorage.getItem('ignatius-settings'));
    assert(stored === '{"alwaysOpenExamples":true}', `FAIL: the setting is written to ignatius-settings (got ${stored})`);

    await page.reload();
    await page.waitForSelector(PRODUCT_EXAMPLES, { timeout: 15_000 });
    assert(await isOpen(page, PRODUCT_EXAMPLES), 'FAIL: after a reload the 4-row example table is still open');

    await page.goto(`${BASE}/#entity=Product`);
    await page.waitForSelector('.modal details.modal-examples', { timeout: 15_000 });
    assert(await isOpen(page, '.modal details.modal-examples'), 'FAIL: the entity modal opens its 4-row example table too');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal details.modal-examples', { state: 'detached', timeout: 5_000 });

    await page.goto(`${BASE}/#view=dict`);
    await page.waitForSelector(PRODUCT_EXAMPLES, { timeout: 15_000 });
    await setAlwaysOpen(page, false);
    assert(!(await isOpen(page, PRODUCT_EXAMPLES)), 'FAIL: turning the setting off returns a 4-row table to closed');

    // A short table stays `open` in React's eyes after the user collapses it, so only a remount honours the setting.
    const shortRows = await page.locator(`${SUBSCRIPTION_EXAMPLES} tbody tr`).count();
    assert(shortRows === 3, `FAIL: fixture: Subscription shows 3 example rows (got ${shortRows})`);
    await page.locator(`${SUBSCRIPTION_EXAMPLES} > summary`).click();
    assert(!(await isOpen(page, SUBSCRIPTION_EXAMPLES)), 'FAIL: fixture: the user can collapse a 3-row table by hand');
    await setAlwaysOpen(page, true);
    assert(await isOpen(page, SUBSCRIPTION_EXAMPLES), 'FAIL: turning the setting on reopens a table the user had collapsed');

    // Flow dialogs render in their own React root; load with the setting off so a value read at load would be stale.
    await setAlwaysOpen(page, false);
    await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
    await page.reload();
    await page.waitForFunction(() => window.__IGNATIUS_FLOW_READY__ === true, { timeout: 15_000 });
    await openCollectPayment(page);
    const flowRows = await page.locator(`${PAYMENT_DETAILS} tbody tr`).count();
    assert(flowRows === 4, `FAIL: fixture: the payment details example shows 4 rows (got ${flowRows})`);
    assert(!(await isOpen(page, PAYMENT_DETAILS)), 'FAIL: with the setting off, a 4-row process example starts closed');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal', { state: 'detached', timeout: 5_000 });

    await setAlwaysOpen(page, true);
    await openCollectPayment(page);
    assert(await isOpen(page, PAYMENT_DETAILS), 'FAIL: the setting turned on in the flow view opens a 4-row process example');
    assert(pageErrors.length === 0, `FAIL: no page errors (got ${pageErrors.join(' | ')})`);

    console.log(process.exitCode ? '\nsettings-always-open: failures above.' : '\nAll settings-always-open checks passed.');
  } finally {
    await browser.close();
  }
} finally {
  handle.stop(true);
  rmSync(root, { recursive: true, force: true });
  clearTimeout(watchdog);
}
