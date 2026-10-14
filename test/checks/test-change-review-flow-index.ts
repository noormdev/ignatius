// docs/spec/model-change-review.md SC9 in the flow index and level menus, on a temp key-inherited: Record Order relabelled
// (unnoted), Process Return relabelled and given Restock Item in its sub-DFD (noted), a new `billing` flow (unnoted).

import { chromium, type Locator, type Page } from 'playwright';
import { resolve, join } from 'path';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const PORT = 3333;

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const WATCHDOG_MS = 120_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-change-review-flow-index.ts exceeded its ${WATCHDOG_MS}ms watchdog — a wait blocked indefinitely`);
  process.exit(1);
}, WATCHDOG_MS);

let failures = 0;

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

const root = mkdtempSync(join(tmpdir(), 'ignatius-change-flow-index-'));
const dir = join(root, 'model');
// Other checks serve models/key-inherited in place and leave .ignatius/ behind.
const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });

function writeProcess(file: string, label: string, number: number): void {
  writeFileSync(join(dir, file), [
    '---',
    `process: ${label}`,
    `number: ${number}`,
    'inputs:',
    '  - from: ext:Customer',
    '    data: returned item',
    'outputs:',
    '  - to: ext:Customer',
    '    data: inspection result',
    '---',
    '',
  ].join('\n'));
}

// Process Return gains a sub-DFD before serve writes the baseline, so a later addition lands inside an existing diagram.
mkdirSync(join(dir, 'flows/refund/Process-Return'), { recursive: true });
writeProcess('flows/refund/Process-Return/Inspect-Item.md', 'Inspect Item', 1);

const handle = serveCommand(dir, { port: PORT });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30_000);
// fs.watch reports file events here late and unprompted; each report refetches and rebuilds the views mid-step.
await page.route('**/events', route => route.abort());

type RowState = { change: string | null; unexplained: string | null; dot: string | null; glow: string };

async function rowState(row: Locator): Promise<RowState> {
  return row.evaluate(el => ({
    change: el.getAttribute('data-change'),
    unexplained: el.getAttribute('data-unexplained'),
    dot: el.querySelector('[data-ignatius="flow-change-dot"]')?.getAttribute('data-severity') ?? null,
    glow: getComputedStyle(el, '::before').boxShadow,
  }));
}

async function menuDot(row: Locator) {
  return row.evaluate(el => {
    const dots = el.querySelectorAll('[data-ignatius="flow-change-dot"]');
    const dot = dots[0];
    return {
      count: dots.length,
      change: dot?.getAttribute('data-change') ?? null,
      unexplained: dot?.getAttribute('data-unexplained') ?? null,
      severity: dot?.getAttribute('data-severity') ?? null,
      glow: dot ? getComputedStyle(dot, '::before').boxShadow : 'none',
      animations: dot ? ['::before', '::after'].map(pseudo => getComputedStyle(dot, pseudo).animationName) : [],
    };
  });
}

const indexRow = (target: Page, label: string) => target.locator('[data-ignatius="flow-index-row"]', { hasText: label });

async function openIndex(target: Page): Promise<void> {
  await target.locator('[data-ignatius="flow-index-button"]').click();
  await target.waitForSelector('[data-ignatius="flow-index"]', { timeout: 10_000 });
}

async function waitForFlow(target: Page, hash: string): Promise<void> {
  await target.goto(`http://localhost:${PORT}/${hash}`, { waitUntil: 'load' });
  await target.waitForFunction(() => window.__IGNATIUS_FLOW_READY__ === true, null, { timeout: 20_000 });
}

try {
  const baselinePath = join(dir, '.ignatius/baseline.json');
  const deadline = Date.now() + 10_000;
  while (!existsSync(baselinePath) && Date.now() < deadline) await sleep(50);
  assert(existsSync(baselinePath), 'serve wrote the baseline before the edits');

  const recordOrder = join(dir, 'flows/order-to-cash/Create-Sales-Order/Record-Order.md');
  writeFileSync(recordOrder, readFileSync(recordOrder, 'utf8').replace('process: Record Order', 'process: Record Sales Order'));
  const processReturn = join(dir, 'flows/refund/Process-Return.md');
  writeFileSync(processReturn, readFileSync(processReturn, 'utf8').replace('process: Process Return', 'process: Process Customer Return'));
  writeProcess('flows/refund/Process-Return/Restock-Item.md', 'Restock Item', 2);
  mkdirSync(join(dir, 'flows/billing'), { recursive: true });
  writeFileSync(join(dir, 'flows/billing/Send-Statement.md'), [
    '---',
    'process: Send Statement',
    'number: 1',
    'inputs:',
    '  - from: db:SalesInvoice',
    '    data: [party_id, sales_invoice_id, total]',
    'outputs:',
    '  - to: ext:Customer',
    '    data: statement',
    '---',
    '',
  ].join('\n'));
  mkdirSync(join(dir, '.ignatius/changes'), { recursive: true });
  writeFileSync(join(dir, '.ignatius/changes/return-wording.md'), [
    '---',
    'title: Return wording',
    'flows:',
    '  refund: [Process-Return]',
    '  Process-Return: [Restock-Item]',
    '---',
    '',
    'Support calls them customer returns; returned stock goes back on the shelf.',
    '',
  ].join('\n'));

  await waitForFlow(page, '#view=flow&dfd=order-to-cash');
  await page.waitForSelector('.changes-panel', { timeout: 10_000 });
  await openIndex(page);

  const recordRow = await rowState(indexRow(page, 'Record Sales Order'));
  assert(recordRow.change === 'changed' && recordRow.unexplained === 'true' && recordRow.dot === null,
    'the relabelled unnoted process row is marked changed and unexplained, with no dot', JSON.stringify(recordRow));
  assert(recordRow.glow !== 'none', 'a marked row draws a glow', recordRow.glow);
  const returnRow = await rowState(indexRow(page, 'Process Customer Return'));
  assert(returnRow.change === 'changed' && returnRow.unexplained === null,
    'the relabelled noted process row is marked changed and explained', JSON.stringify(returnRow));
  assert(returnRow.dot === 'added', 'a row whose sub-DFD holds only an explained addition carries a green dot', JSON.stringify(returnRow));
  const restockRow = await rowState(indexRow(page, 'Restock Item'));
  assert(restockRow.change === 'added' && restockRow.unexplained === null,
    'the noted process added inside a sub-DFD is marked added and explained', JSON.stringify(restockRow));
  const billingRow = await rowState(indexRow(page, 'Billing'));
  assert(billingRow.change === 'added' && billingRow.unexplained === 'true',
    'an added flow row is marked added and unexplained', JSON.stringify(billingRow));
  const sendRow = await rowState(indexRow(page, 'Send Statement'));
  assert(sendRow.change === 'added' && sendRow.unexplained === 'true',
    'a leaf row inside an added flow is marked added and unexplained like its flow', JSON.stringify(sendRow));

  const salesOrderRow = await rowState(indexRow(page, 'Create Sales Order'));
  assert(salesOrderRow.change === null && salesOrderRow.dot === 'unexplained' && salesOrderRow.glow === 'none',
    'a parent of an unexplained row carries a red dot and no glow', JSON.stringify(salesOrderRow));
  const orderToCashRow = await rowState(indexRow(page, 'Order To Cash'));
  assert(orderToCashRow.change === null && orderToCashRow.dot === 'unexplained',
    'every ancestor of an unexplained row carries a red dot', JSON.stringify(orderToCashRow));
  const refundRow = await rowState(indexRow(page, 'Refund'));
  assert(refundRow.change === null && refundRow.dot === 'changed',
    'an ancestor of only explained changes carries an amber dot', JSON.stringify(refundRow));
  const untouched = await rowState(indexRow(page, 'Validate Customer'));
  assert(untouched.change === null && untouched.dot === null && untouched.glow === 'none',
    'an untouched row has neither glow nor dot', JSON.stringify(untouched));

  const pulse = await indexRow(page, 'Process Customer Return').evaluate(el => getComputedStyle(el, '::before').animationName);
  assert(pulse === 'flow-glow-pulse', 'an explained row glow pulses like the canvas glow', pulse);
  const swap = await indexRow(page, 'Record Sales Order').evaluate(el => [getComputedStyle(el, '::before').animationName, getComputedStyle(el, '::after').animationName]);
  assert(swap[0] === 'flow-glow-red' && swap[1] === 'flow-glow-swap', 'an unexplained row glow swaps between its kind colour and red', JSON.stringify(swap));

  await indexRow(page, 'Record Sales Order').hover();
  const summary = await page.locator('[data-ignatius="flow-index-change"]').innerText().catch(() => '');
  assert(summary === 'Changed: label · unexplained', 'the preview pane summarises the hovered row\'s change', summary);
  await indexRow(page, 'Validate Customer').hover();
  assert(await page.locator('[data-ignatius="flow-index-change"]').count() === 0, 'the preview pane shows no summary for an untouched row');

  await page.keyboard.press('Escape');
  await page.locator('[data-ignatius="flow-crumb-menu-button"]').first().click();
  const menu = page.locator('[data-ignatius="flow-level-menu"]');
  await menu.waitFor({ timeout: 5_000 });
  const menuRow = (label: string) => menu.locator('[data-ignatius="flow-level-menu-item"]', { hasText: label });
  const billingItem = await rowState(menuRow('Billing'));
  assert(billingItem.change === null && billingItem.glow === 'none', 'a level menu row draws no row glow', JSON.stringify(billingItem));
  const billingDot = await menuDot(menuRow('Billing'));
  assert(billingDot.count === 1 && billingDot.change === 'added' && billingDot.unexplained === 'true' && billingDot.glow !== 'none',
    'a level menu row for an added flow carries one glowing dot marked added and unexplained', JSON.stringify(billingDot));
  assert(billingDot.animations.length === 2 && billingDot.animations.includes('flow-glow-red') && billingDot.animations.includes('flow-glow-swap'), 'an unexplained menu dot swaps between its kind colour and red', JSON.stringify(billingDot));
  const orderToCashDot = await menuDot(menuRow('Order To Cash'));
  assert(orderToCashDot.count === 1 && orderToCashDot.change === null && orderToCashDot.severity === 'unexplained' && orderToCashDot.animations[0] === 'none',
    'a level menu row containing an unexplained change carries one static red dot', JSON.stringify(orderToCashDot));
  await page.keyboard.press('Escape');

  await page.getByRole('checkbox', { name: 'Highlight changes' }).uncheck();
  await openIndex(page);
  const cleared = await page.locator('[data-ignatius="flow-index"] [data-change], [data-ignatius="flow-change-dot"], [data-ignatius="flow-index-change"]').count();
  assert(cleared === 0, 'overlay off removes every mark from the flow index', String(cleared));
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'Highlight changes' }).check();

  await waitForFlow(page, '#view=flow&dfd=billing');
  const canvas = await page.evaluate(() => [...document.querySelectorAll('[data-ignatius="flow-svg"] g[data-token]')].map(g => ({
    token: g.getAttribute('data-token'),
    change: g.getAttribute('data-change'),
    unexplained: g.getAttribute('data-unexplained'),
  })));
  assert(canvas.length > 0 && canvas.every(node => node.change === 'added' && node.unexplained === 'true'),
    'every node on an added flow\'s canvas is marked added and unexplained', JSON.stringify(canvas));

  const calm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await calm.route('**/events', route => route.abort());
  await waitForFlow(calm, '#view=flow&dfd=order-to-cash');
  await openIndex(calm);
  const steady = await indexRow(calm, 'Record Sales Order').evaluate(el => ['::before', '::after'].map(pseudo => {
    const style = getComputedStyle(el, pseudo);
    return { animation: style.animationName, opacity: Number(style.opacity), glow: style.boxShadow };
  }));
  assert(steady.every(layer => layer.animation === 'none' && layer.opacity > 0 && layer.glow !== 'none'),
    'reduced motion holds both row glow layers steady', JSON.stringify(steady));
  // Painted last, so its colour is the one a steady unexplained glow shows; red must stay a ring outside it.
  const topLayer = await indexRow(calm, 'Record Sales Order').evaluate(el => {
    const probe = el.appendChild(document.createElement('span'));
    probe.style.color = 'var(--change-kind)';
    const kind = getComputedStyle(probe).color;
    probe.remove();
    return { kind, top: getComputedStyle(el, '::after').boxShadow };
  });
  assert(topLayer.top.startsWith(topLayer.kind), 'reduced motion keeps an unexplained row\'s kind glow above its red glow', JSON.stringify(topLayer));
  await calm.keyboard.press('Escape');
  await calm.locator('[data-ignatius="flow-crumb-menu-button"]').first().click();
  const calmDotRow = calm.locator('[data-ignatius="flow-level-menu-item"]', { hasText: 'Billing' });
  const calmDot = await menuDot(calmDotRow);
  assert(calmDot.count === 1 && calmDot.glow !== 'none' && calmDot.animations.every(name => name === 'none'),
    'reduced motion holds a menu dot steady', JSON.stringify(calmDot));
  const calmDotFill = await calmDotRow.locator('[data-ignatius="flow-change-dot"]').evaluate(dot => {
    const probe = dot.appendChild(document.createElement('span'));
    probe.style.color = 'var(--change-kind)';
    const kind = getComputedStyle(probe).color;
    probe.remove();
    return {
      kind,
      body: getComputedStyle(dot).backgroundColor,
      layers: ['::before', '::after'].map(pseudo => getComputedStyle(dot, pseudo).backgroundColor),
    };
  });
  assert(calmDotFill.body === calmDotFill.kind && calmDotFill.layers.every(fill => fill === 'rgba(0, 0, 0, 0)'),
    'an unexplained menu dot shows red only as a ring, never a fill over its kind colour', JSON.stringify(calmDotFill));
  await calm.close();
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  failures++;
} finally {
  await page.close();
  await browser.close();
  handle.stop(true);
  rmSync(root, { recursive: true, force: true });
}

clearTimeout(watchdog);

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nAll change-review flow index checks passed.');
process.exit(0);
