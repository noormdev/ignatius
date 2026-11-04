// A wiki-link to a process that owns a sub-DFD opens that diagram; its Dictionary section and ⓘ dialog link there too.
// A title link to a leaf process still scrolls to its section. Screenshots land in tmp/wikilink-opens-sub-dfd/.

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const FIXTURE = join(ROOT, 'models/key-inherited');
const SHOTS = join(ROOT, 'tmp', 'wikilink-opens-sub-dfd');
const PORT = 3345;
const BASE = `http://localhost:${PORT}`;
const ON_SUB_DFD = /view=flow.*dfd=[^&]*Create-Sales-Order(&|$)/;

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

const root = mkdtempSync(join(tmpdir(), 'ignatius-sub-dfd-link-'));
const dir = join(root, 'model');
const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });

function appendLine(relative: string, line: string): void {
  const file = join(dir, relative);
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n${line}\n`);
}
appendLine('flows/order-to-cash/Collect-Payment.md', 'Orders come from [[Create Sales Order]].');
appendLine('flows/order-to-cash/Issue-Invoice.md', 'Paid through [[Collect Payment]].');
appendLine('data/transactional/SalesOrder.md', 'Written by [[Create Sales Order]] and invoiced by [[Issue Invoice]].');
const salesOrderFile = join(dir, 'data/transactional/SalesOrder.md');
writeFileSync(salesOrderFile, readFileSync(salesOrderFile, 'utf8').replace(
  'desc: "Ordering party — foreign key to Party."',
  'desc: "The ordering [[Party]], placed through [[Create Sales Order]]."',
));

async function hashMatches(page: Page, pattern: RegExp): Promise<boolean> {
  try {
    await page.waitForFunction(source => new RegExp(source).test(location.hash), pattern.source, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function openBadge(page: Page, token: string): Promise<void> {
  await page.waitForSelector(`g[data-token="${token}"] g[data-ignatius="flow-info"]`, { timeout: 15_000 });
  await page.evaluate((t) => {
    const badge = document.querySelector(`g[data-token="${t}"] g[data-ignatius="flow-info"]`);
    badge?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  }, token);
  await page.locator('.modal').first().waitFor({ timeout: 5_000 });
}

async function freshDict(page: Page): Promise<void> {
  await page.goto(`${BASE}/#view=dict`);
  await page.reload();
}

const handle = serveCommand(dir, { port: PORT });
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Dictionary: the decomposed process's section links to its diagram.
  await freshDict(page);
  const sectionLink = page.locator('#process-Create-Sales-Order .open-diagram-link[data-target="sub"]');
  await sectionLink.waitFor({ timeout: 15_000 });
  assert(await page.locator('#process-Collect-Payment .open-diagram-link[data-target="sub"]').count() === 0, 'a leaf process section has no Open sub-diagram link');
  assert(await page.locator('#process-Collect-Payment .open-diagram-link[data-target="in"]').count() === 1, 'every process section has a Show in diagram link');
  await sectionLink.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'dict-section.png') });
  await sectionLink.click();
  assert(await hashMatches(page, ON_SUB_DFD), 'Dictionary: Open sub-diagram shows the sub-DFD');

  // Dictionary: Show in diagram opens the diagram a leaf process is drawn in.
  await freshDict(page);
  const showIn = page.locator('#process-Collect-Payment .open-diagram-link[data-target="in"]');
  await showIn.waitFor({ timeout: 15_000 });
  await showIn.click();
  assert(await hashMatches(page, /view=flow.*dfd=order-to-cash(&|$)/), 'Dictionary: Show in diagram opens order-to-cash for Collect Payment');

  // Dictionary: a body wiki-link naming the process by its title opens the diagram.
  await freshDict(page);
  const bodyLink = page.locator('#process-Collect-Payment a.entity-link', { hasText: 'Create Sales Order' });
  await bodyLink.waitFor({ timeout: 15_000 });
  await bodyLink.click();
  assert(await hashMatches(page, ON_SUB_DFD), 'Dictionary: [[Create Sales Order]] in a process body shows the sub-DFD');

  // Dictionary: the same link in an entity body routes the same way.
  await freshDict(page);
  const entityLink = page.locator('#entity-SalesOrder p > a.entity-link', { hasText: 'Create Sales Order' });
  await entityLink.waitFor({ timeout: 15_000 });
  await entityLink.click();
  assert(await hashMatches(page, ON_SUB_DFD), 'Dictionary: [[Create Sales Order]] in an entity body shows the sub-DFD');

  // Dictionary: a title link to a leaf process is rewritten to its id and scrolls to its section.
  await freshDict(page);
  const leafLink = page.locator('#process-Issue-Invoice a.entity-link', { hasText: 'Collect Payment' });
  await leafLink.waitFor({ timeout: 15_000 });
  assert(await leafLink.getAttribute('data-entity') === 'Collect-Payment', 'Dictionary: [[Collect Payment]] is rewritten to the id Collect-Payment');
  await leafLink.click();
  await page.waitForTimeout(800);
  const sectionTop = await page.evaluate(() => document.getElementById('process-Collect-Payment')?.getBoundingClientRect().top ?? -1);
  const onDict = /view=dict/.test(await page.evaluate(() => location.hash));
  assert(onDict && sectionTop >= 0 && sectionTop < 200, `Dictionary: [[Collect Payment]] scrolls to the leaf process section (top ${sectionTop})`);

  // Column descriptions render [[links]]: an entity link jumps to its section, a process link opens its sub-DFD.
  await freshDict(page);
  const descEntity = page.locator('#entity-SalesOrder td.col-desc a.entity-link', { hasText: 'Party' });
  await descEntity.waitFor({ timeout: 15_000 });
  await descEntity.click();
  assert(await hashMatches(page, /view=dict.*section=entity:Party(&|$)/), 'Dictionary: [[Party]] in a column description jumps to the Party section');
  await freshDict(page);
  const descProcess = page.locator('#entity-SalesOrder td.col-desc a.entity-link', { hasText: 'Create Sales Order' });
  await descProcess.waitFor({ timeout: 15_000 });
  await descProcess.click();
  assert(await hashMatches(page, ON_SUB_DFD), 'Dictionary: [[Create Sales Order]] in a column description shows the sub-DFD');

  // Graph entity dialog: an entity link in a column description switches the dialog.
  await page.goto(`${BASE}/#view=graph&entity=SalesOrder`);
  await page.reload();
  const modalDesc = page.locator('.modal td.col-desc a.entity-link', { hasText: 'Party' });
  await modalDesc.waitFor({ timeout: 15_000 });
  await modalDesc.click();
  assert(await hashMatches(page, /entity=Party(&|$)/), 'Graph dialog: [[Party]] in a column description opens Party');

  // Graph entity dialog: links to flow nodes leave the dialog for the Flows view, and Back returns to it.
  const graphDialog = async () => {
    await page.goto(`${BASE}/#view=graph&entity=SalesOrder`);
    await page.reload();
    await page.locator('.modal-header h1', { hasText: 'SalesOrder' }).waitFor({ timeout: 15_000 });
  };
  await graphDialog();
  await page.locator('.modal p > a.entity-link', { hasText: 'Create Sales Order' }).click();
  assert(await hashMatches(page, ON_SUB_DFD), 'Graph dialog: [[Create Sales Order]] in the body shows the sub-DFD');
  await page.goBack();
  await page.locator('.modal-header h1', { hasText: 'SalesOrder' }).waitFor({ timeout: 10_000 });
  assert(await hashMatches(page, /view=graph.*entity=SalesOrder/), 'Graph dialog: Back from the sub-DFD reopens SalesOrder');
  await graphDialog();
  await page.locator('.modal td.col-desc a.entity-link', { hasText: 'Create Sales Order' }).click();
  assert(await hashMatches(page, ON_SUB_DFD), 'Graph dialog: [[Create Sales Order]] in a column description shows the sub-DFD');
  await graphDialog();
  await page.locator('.modal p > a.entity-link', { hasText: 'Issue Invoice' }).click();
  await page.locator('.modal-header h1', { hasText: 'Issue Invoice' }).waitFor({ timeout: 15_000 });
  assert(await hashMatches(page, /view=flow.*dfd=order-to-cash.*node=proc:Issue-Invoice/), 'Graph dialog: [[Issue Invoice]] opens its diagram with its dialog');
  await page.goBack();
  await page.locator('.modal-header h1', { hasText: 'SalesOrder' }).waitFor({ timeout: 10_000 });
  assert(await hashMatches(page, /view=graph.*entity=SalesOrder/), 'Graph dialog: one Back from the process dialog reopens SalesOrder');

  // Flows entity dialog: the same links open in the Flows view, and Back reopens the dialog.
  const flowDialog = async () => {
    await page.goto(`${BASE}/#view=flow&entity=SalesOrder&dfd=order-to-cash`);
    await page.reload();
    await page.locator('.modal-header h1', { hasText: 'SalesOrder' }).waitFor({ timeout: 15_000 });
  };
  await flowDialog();
  await page.locator('.modal p > a.entity-link', { hasText: 'Issue Invoice' }).click();
  await page.locator('.modal-header h1', { hasText: 'Issue Invoice' }).waitFor({ timeout: 10_000 });
  assert(await hashMatches(page, /^(?!.*entity=).*node=proc:Issue-Invoice/), 'Flows dialog: [[Issue Invoice]] opens the process dialog');
  await page.goBack();
  await page.locator('.modal-header h1', { hasText: 'SalesOrder' }).waitFor({ timeout: 10_000 });
  assert(await hashMatches(page, /view=flow.*entity=SalesOrder/), 'Flows dialog: Back reopens SalesOrder');
  await flowDialog();
  await page.locator('.modal p > a.entity-link', { hasText: 'Create Sales Order' }).click();
  assert(await hashMatches(page, ON_SUB_DFD), 'Flows dialog: [[Create Sales Order]] shows the sub-DFD');

  // Flows: the link inside a process dialog closes the dialog and opens the diagram.
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
  await page.reload();
  await openBadge(page, 'proc:Collect-Payment');
  await page.locator('.modal a.entity-link', { hasText: 'Create Sales Order' }).click();
  assert(await hashMatches(page, ON_SUB_DFD), 'Flows: [[Create Sales Order]] in a dialog shows the sub-DFD');
  assert(await page.locator('.modal').count() === 0, 'Flows: the dialog closes when its link opens a diagram');

  // Flows: the ⓘ badge still opens the process dialog, which links to the diagram.
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
  await page.reload();
  await openBadge(page, 'proc:Create-Sales-Order');
  const dialogLink = page.locator('.modal .open-diagram-link[data-target="sub"]');
  assert(await dialogLink.count() === 1, 'Flows: the ⓘ badge opens the process dialog with an Open sub-diagram link');
  assert(await page.locator('.modal .open-diagram-link[data-target="in"]').count() === 0, 'Flows: the dialog does not offer the diagram already on screen');
  await page.screenshot({ path: join(SHOTS, 'flow-dialog.png') });
  await dialogLink.click();
  assert(await hashMatches(page, ON_SUB_DFD), 'Flows: Open sub-diagram shows the sub-DFD');
  await page.screenshot({ path: join(SHOTS, 'sub-dfd.png') });

  console.log(`\nAll sub-DFD wikilink checks passed. Screenshots in ${SHOTS}`);
} finally {
  await browser.close();
  handle.stop(true);
  rmSync(root, { recursive: true, force: true });
}
