// Every navigation pushes a history entry and Back returns to the screen and dialog it left; closing a dialog and
// scrolling the Dictionary rewrite the current entry. Tab titles name the view and what it shows.

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'node:fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const PORT = 3347;
const BASE = `http://localhost:${PORT}`;
const NAME = 'Key-Inherited';

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };
function assert(cond: boolean, label: string) {
  if (!cond) fail(label);
  console.log(`  PASS  ${label}`);
}

async function hashMatches(page: Page, pattern: RegExp): Promise<boolean> {
  try {
    await page.waitForFunction(source => new RegExp(source).test(location.hash), pattern.source, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function titleIs(page: Page, title: string): Promise<boolean> {
  try {
    await page.waitForFunction(t => document.title === t, title, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

const historyLength = (page: Page) => page.evaluate(() => history.length);

async function sectionTop(page: Page, id: string): Promise<number> {
  return page.evaluate((target) => {
    const container = document.querySelector('[data-ignatius="dict-view"]');
    const el = document.getElementById(target);
    if (!container || !el) return Number.NaN;
    const padding = Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 0;
    return el.getBoundingClientRect().top - container.getBoundingClientRect().top - padding;
  }, id);
}

async function openBadge(page: Page, token: string): Promise<void> {
  await page.waitForSelector(`g[data-token="${token}"] g[data-ignatius="flow-info"]`, { timeout: 15_000 });
  await page.evaluate((t) => {
    document.querySelector(`g[data-token="${t}"] g[data-ignatius="flow-info"]`)
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  }, token);
  await page.locator('.modal').first().waitFor({ timeout: 5_000 });
}

const handle = serveCommand(join(ROOT, 'models/key-inherited'), { port: PORT });
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Graph entity dialog → Processes link → the Dictionary section, held in view while diagrams above render.
  await page.goto(`${BASE}/#view=graph&entity=Business`);
  await page.locator('.modal .modal-processes a', { hasText: 'Create Sales Order' }).first().waitFor({ timeout: 15_000 });
  assert(await titleIs(page, `DG - Business | ${NAME}`), 'an open entity dialog names the tab "DG - Business"');
  const beforeJump = await historyLength(page);
  await page.locator('.modal .modal-processes a', { hasText: 'Create Sales Order' }).first().click();
  assert(await hashMatches(page, /^#view=dict.*section=process:Create-Sales-Order/), 'the Processes link navigates to section=process:Create-Sales-Order');
  assert(await historyLength(page) === beforeJump + 1, 'the jump pushes one history entry');
  await page.waitForTimeout(2_500);
  const top = await sectionTop(page, 'process-Create-Sales-Order');
  assert(top >= -2 && top < 40, `Create Sales Order is at the top of the Dictionary after diagrams render (${top})`);
  assert(await titleIs(page, `DD - 1.1 Create Sales Order | ${NAME}`), 'the Dictionary names the section in the tab');

  await page.goBack();
  assert(await hashMatches(page, /view=graph.*entity=Business/), 'Back returns to the graph entry with entity=Business');
  await page.locator('.modal-header h1', { hasText: 'Business' }).waitFor({ timeout: 5_000 });
  assert(await page.locator('.modal-header h1', { hasText: 'Business' }).count() === 1, 'Back reopens the Business dialog');

  await page.goForward();
  assert(await hashMatches(page, /section=process:Create-Sales-Order/), 'Forward returns to the section');
  await page.waitForTimeout(800);
  const forwardTop = await sectionTop(page, 'process-Create-Sales-Order');
  assert(forwardTop >= -2 && forwardTop < 40, `Forward brings the section back into view (${forwardTop})`);

  // Scrolling the Dictionary rewrites section= in place, and a refresh returns there.
  const beforeScroll = await historyLength(page);
  await page.evaluate(() => {
    const container = document.querySelector('[data-ignatius="dict-view"]');
    const el = document.getElementById('process-Issue-Invoice');
    const padding = container ? Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 0 : 0;
    if (container && el) container.scrollTop += el.getBoundingClientRect().top - container.getBoundingClientRect().top - padding + 4;
  });
  assert(await hashMatches(page, /section=process:Issue-Invoice/), 'scrolling rewrites section= to the section at the top');
  assert(await historyLength(page) === beforeScroll, 'scrolling adds no history entry');
  await page.reload();
  await page.waitForTimeout(2_500);
  const reloadTop = await sectionTop(page, 'process-Issue-Invoice');
  assert(reloadTop >= -8 && reloadTop < 40, `a refresh returns to the scrolled position in the section (${reloadTop})`);

  // Show in diagram → the Flows view, one entry; Back returns to the Dictionary section.
  const beforeDiagram = await historyLength(page);
  await page.locator('#process-Issue-Invoice .open-diagram-link[data-target="in"]').click();
  assert(await hashMatches(page, /^#view=flow.*dfd=order-to-cash/), 'Show in diagram opens order-to-cash');
  assert(await historyLength(page) === beforeDiagram + 1, 'opening the diagram pushes one entry');
  assert(await titleIs(page, `DF - 1 Order To Cash | ${NAME}`), `the Flows view names the diagram in the tab (${await page.title()})`);
  await page.goBack();
  assert(await hashMatches(page, /^#view=dict.*section=process:Issue-Invoice/), 'Back returns to the Dictionary section');

  // A flow-node dialog is a history entry; closing it rewrites the entry.
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
  await page.reload();
  const beforeDialog = await historyLength(page);
  await openBadge(page, 'proc:Collect-Payment');
  assert(await hashMatches(page, /node=proc:Collect-Payment/), 'opening a process dialog writes node=proc:Collect-Payment');
  assert(await historyLength(page) === beforeDialog + 1, 'opening the dialog pushes one entry');
  assert(await titleIs(page, `DF - Collect Payment | ${NAME}`), 'an open node dialog names the tab');
  await page.keyboard.press('Escape');
  assert(await hashMatches(page, /^(?!.*node=).*dfd=order-to-cash/), 'closing the dialog drops node=');
  assert(await historyLength(page) === beforeDialog + 1, 'closing the dialog adds no entry');

  // Leaving a node dialog for an entity: Back reopens the node dialog.
  await openBadge(page, 'proc:Collect-Payment');
  await page.locator('.modal a', { hasText: 'Payment' }).first().click();
  assert(await hashMatches(page, /entity=/), 'a link in the node dialog opens an entity dialog');
  await page.goBack();
  assert(await hashMatches(page, /node=proc:Collect-Payment/), 'Back returns to the node= entry');
  await page.locator('.modal-header h1', { hasText: 'Collect Payment' }).waitFor({ timeout: 5_000 });
  assert(await page.locator('.modal-header h1', { hasText: 'Collect Payment' }).count() === 1, 'Back reopens the Collect Payment dialog');

  // A node= deep link opens its dialog.
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash&node=proc:Issue-Invoice`);
  await page.reload();
  await page.locator('.modal-header h1', { hasText: 'Issue Invoice' }).waitFor({ timeout: 15_000 });
  assert(await page.locator('.modal-header h1', { hasText: 'Issue Invoice' }).count() === 1, 'a node= deep link opens the Issue Invoice dialog');

  const dictTop = () => page.evaluate(() => document.querySelector('[data-ignatius="dict-view"]')?.scrollTop ?? -1);

  // A bare view switch is one entry, and titles with no subject name only the view.
  await page.goto(`${BASE}/#view=graph`);
  await page.reload();
  await page.waitForTimeout(1_500);
  assert(await titleIs(page, `DG | ${NAME}`), 'the Graph with nothing open is titled "DG | Key-Inherited"');
  const beforeSwitch = await historyLength(page);
  await page.keyboard.press('d');
  assert(await hashMatches(page, /^#view=dict/), 'the d key switches to the Dictionary');
  assert(await historyLength(page) === beforeSwitch + 1, 'a view switch pushes one entry');
  await page.goBack();
  assert(await hashMatches(page, /^#view=graph/), 'Back returns to the Graph');

  // Back from a jump returns to the section the reader left, even on an entry no scroll had recorded.
  await page.goto(`${BASE}/#view=dict`);
  await page.reload();
  await page.waitForTimeout(2_000);
  const personLink = page.locator('#entity-Person p a.entity-link', { hasText: 'Party' }).first();
  await personLink.scrollIntoViewIfNeeded();
  const leaving = await page.evaluate(() => {
    const container = document.querySelector('[data-ignatius="dict-view"]');
    if (!container) return null;
    const edge = container.getBoundingClientRect().top + (Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 0) + 8;
    const above = Array.from(container.querySelectorAll('section[id^="entity-"]')).filter(s => s.getBoundingClientRect().top <= edge);
    return above[above.length - 1]?.id ?? null;
  });
  await personLink.click();
  assert(await hashMatches(page, /section=entity:Party/), 'a body link jumps to section=entity:Party');
  await page.goBack();
  await page.waitForTimeout(1_000);
  const backSection = leaving ?? 'none';
  const backTop = await sectionTop(page, backSection);
  assert(await hashMatches(page, new RegExp(`section=${backSection.replace('-', ':')}`)) && backTop >= -2 && backTop < 40,
    `Back returns to the section the reader left (${backSection}, top ${backTop})`);

  // A jump taken at the very top: Back returns to the top.
  await page.goto(`${BASE}/#view=dict`);
  await page.reload();
  await page.waitForTimeout(2_000);
  await page.locator('[data-ignatius="dict-view"]').evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const link = document.querySelector<HTMLElement>('[data-ignatius="dict-view"] a.entity-link[data-entity="Business"]');
    link?.click();
  });
  assert(await hashMatches(page, /section=entity:Business/), 'a link clicked at the top jumps to Business');
  await page.goBack();
  await page.waitForTimeout(800);
  assert(await dictTop() < 5, `Back from a jump taken at the top returns to the top (${await dictTop()})`);

  // After a jump, a view switch and back keeps the reader's own position, not the jump.
  await page.goto(`${BASE}/#view=dict&section=process:Create-Sales-Order`);
  await page.reload();
  await page.waitForTimeout(2_500);
  await page.locator('[data-ignatius="dict-view"]').evaluate(el => { el.scrollTop += 3000; });
  await page.waitForTimeout(400);
  const readerTop = await dictTop();
  await page.keyboard.press('g');
  await page.waitForTimeout(500);
  await page.keyboard.press('d');
  await page.waitForTimeout(1_500);
  const returnedTop = await dictTop();
  assert(Math.abs(returnedTop - readerTop) < 4, `switching away and back keeps the reader's position, not the jump (${readerTop} → ${returnedTop})`);

  // An external's section names the tab by its label.
  await page.goto(`${BASE}/#view=dict&section=external:Customer`);
  await page.reload();
  assert(await titleIs(page, `DD - Customer | ${NAME}`), 'an external section is titled by its label');

  // Open sub-diagram from a process dialog: Back reopens the dialog.
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
  await page.reload();
  await openBadge(page, 'proc:Create-Sales-Order');
  await page.locator('.modal .open-diagram-link[data-target="sub"]').click();
  assert(await hashMatches(page, /dfd=[^&]*Create-Sales-Order/), 'Open sub-diagram shows the sub-DFD');
  await page.goBack();
  await page.locator('.modal-header h1', { hasText: 'Create Sales Order' }).waitFor({ timeout: 10_000 });
  assert(await hashMatches(page, /node=proc:Create-Sales-Order/), 'Back from the sub-diagram returns to the dialog entry and reopens it');

  // In the Flows view, an entity dialog's Processes link opens the process dialog; Back reopens the entity dialog.
  await page.goto(`${BASE}/#view=flow&entity=PaymentMethod&dfd=order-to-cash`);
  await page.reload();
  const flowProcessLink = page.locator('.modal .modal-processes a', { hasText: 'Collect Payment' }).first();
  await flowProcessLink.waitFor({ timeout: 15_000 });
  await flowProcessLink.click();
  await page.locator('.modal-header h1', { hasText: 'Collect Payment' }).waitFor({ timeout: 10_000 });
  assert(await hashMatches(page, /^(?!.*entity=).*node=proc:Collect-Payment/), 'the Processes link opens the process dialog in the Flows view');
  await page.goBack();
  await page.locator('.modal-header h1', { hasText: 'PaymentMethod' }).waitFor({ timeout: 10_000 });
  assert(await hashMatches(page, /view=flow.*entity=PaymentMethod/), 'Back reopens the PaymentMethod dialog in the Flows view');

  // A node dialog over the Dictionary: deep link, close, and Back from an entity it links to.
  await page.goto(`${BASE}/#view=dict&node=proc:Collect-Payment`);
  await page.reload();
  await page.locator('.modal-header h1', { hasText: 'Collect Payment' }).waitFor({ timeout: 15_000 });
  assert(await titleIs(page, `DD - Collect Payment | ${NAME}`), 'a node dialog over the Dictionary names the tab');
  await page.locator('.modal a', { hasText: 'PaymentMethod' }).first().click();
  assert(await hashMatches(page, /entity=PaymentMethod/), 'a link in the Dictionary node dialog opens the entity dialog');
  await page.goBack();
  await page.locator('.modal-header h1', { hasText: 'Collect Payment' }).waitFor({ timeout: 10_000 });
  assert(await hashMatches(page, /view=dict.*node=proc:Collect-Payment/), 'Back reopens the node dialog over the Dictionary');
  await page.keyboard.press('Escape');
  assert(await hashMatches(page, /^(?!.*node=)#view=dict/), 'closing the node dialog over the Dictionary drops node=');

  console.log('\nAll history navigation checks passed.');
} finally {
  await browser.close();
  handle.stop(true);
}
