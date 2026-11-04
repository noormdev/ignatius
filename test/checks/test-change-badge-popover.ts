// An entity's change badge opens a popover naming what changed and the note that explains it, or that none does;
// it stays inside the viewport and closes on Escape without closing the dialog under it. Shots: tmp/change-badge-popover/.

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const FIXTURE = join(ROOT, 'models/key-inherited');
const SHOTS = join(ROOT, 'tmp', 'change-badge-popover');
const PORT = 3343;
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

const root = mkdtempSync(join(tmpdir(), 'ignatius-change-popover-'));
const dir = join(root, 'model');
const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });

const handle = serveCommand(dir, { port: PORT });
const browser = await chromium.launch();

try {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !existsSync(join(dir, '.ignatius/baseline.json'))) await Bun.sleep(200);
  assert(existsSync(join(dir, '.ignatius/baseline.json')), 'serve writes the baseline');

  const personFile = join(dir, 'data/identity/Person.md');
  writeFileSync(personFile, readFileSync(personFile, 'utf8').replace('  birthdate:\n', '  nickname:\n    type: text\n    desc: "Added."\n  birthdate:\n'));
  const businessFile = join(dir, 'data/identity/Business.md');
  writeFileSync(businessFile, `${readFileSync(businessFile, 'utf8')}\nA business may trade under several names.\n`);
  mkdirSync(join(dir, '.ignatius/changes'), { recursive: true });
  const issueInvoice = join(dir, 'flows/order-to-cash/Issue-Invoice.md');
  writeFileSync(issueInvoice, readFileSync(issueInvoice, 'utf8').replace('number: 2\n', 'number: 2\ndescription: "Bills the customer for a confirmed order."\n'));
  const collectPayment = join(dir, 'flows/order-to-cash/Collect-Payment.md');
  writeFileSync(collectPayment, `${readFileSync(collectPayment, 'utf8')}\nRetries a declined card once.\n`);
  writeFileSync(join(dir, '.ignatius/changes/invoice-description.md'), [
    '---',
    'title: Describe invoicing',
    'flows:',
    '  order-to-cash: [Issue-Invoice]',
    '---',
    '',
    'The flow index now says what Issue Invoice does.',
    '',
  ].join('\n'));
  writeFileSync(join(dir, '.ignatius/changes/person-nickname.md'), [
    '---',
    'title: Give people a nickname',
    'entities:',
    '  Person: [nickname]',
    '---',
    '',
    'Support staff greet customers by nickname.',
    '',
  ].join('\n'));
  await Bun.sleep(1_000);

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const popover = page.locator('[data-ignatius="change-popover"]');

  await page.goto(`${BASE}/#entity=Person`);
  const badge = page.locator('.modal .change-badge--button');
  await badge.waitFor({ timeout: 15_000 });
  await badge.click();
  await popover.waitFor({ timeout: 5_000 });
  const explained = await popover.innerText();
  assert(explained.includes('Person.nickname') && explained.includes('Give people a nickname') && explained.includes('Support staff greet customers by nickname.'),
    'a noted change lists the column and the note that explains it');
  await page.screenshot({ path: join(SHOTS, 'explained.png') });

  const topBefore = await popover.evaluate(el => el.getBoundingClientRect().top);
  await page.locator('.modal').first().evaluate(el => { el.scrollTop += 40; });
  await page.waitForTimeout(200);
  const moved = await popover.count() === 1 ? await popover.evaluate(el => el.getBoundingClientRect().top) : null;
  assert(moved !== null && Math.abs(topBefore - moved - 40) < 2, `a scroll behind the popover moves it with its badge (${topBefore} → ${moved})`);

  await page.locator('.modal-header h1').click();
  assert(await popover.count() === 0, 'a click outside closes the popover');

  await badge.click();
  await popover.waitFor({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  assert(await popover.count() === 0 && await page.locator('.modal').count() === 1, 'Escape closes the popover and leaves the entity dialog open');

  await page.goto(`${BASE}/#entity=Business`);
  await page.reload();
  await badge.waitFor({ timeout: 15_000 });
  await badge.click();
  await popover.waitFor({ timeout: 5_000 });
  const unexplained = await popover.innerText();
  assert(unexplained.includes('no note covers this') && unexplained.includes('No change note covers these changes.'),
    'an unnoted change says no note covers it');
  await page.screenshot({ path: join(SHOTS, 'unexplained.png') });

  // Dictionary process cards carry the same badge: a noted flow change and an unnoted one.
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/#view=dict`);
  await page.reload();
  const processBadge = page.locator('#process-Issue-Invoice .change-badge--button');
  await processBadge.waitFor({ timeout: 15_000 });
  await processBadge.scrollIntoViewIfNeeded();
  await processBadge.click();
  await popover.waitFor({ timeout: 5_000 });
  const flowExplained = await popover.innerText();
  assert(flowExplained.includes('Issue Invoice') && flowExplained.includes('Describe invoicing') && flowExplained.includes('The flow index now says what Issue Invoice does.'),
    `a Dictionary process card explains its noted flow change (${flowExplained.replace(/\n/g, ' / ')})`);
  await page.screenshot({ path: join(SHOTS, 'process-explained.png') });
  await page.keyboard.press('Escape');
  const unnotedBadge = page.locator('#process-Collect-Payment .change-badge--button');
  await unnotedBadge.scrollIntoViewIfNeeded();
  await unnotedBadge.click();
  await popover.waitFor({ timeout: 5_000 });
  assert((await popover.innerText()).includes('no note covers this'), 'a Dictionary process card flags an unnoted flow change');
  await page.keyboard.press('Escape');

  // A badge near the bottom of the window opens its popover above it.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/#view=dict`);
  await page.reload();
  const dictBadge = page.locator('#entity-Person .change-badge--button');
  await dictBadge.waitFor({ timeout: 15_000 });
  await dictBadge.evaluate(el => {
    const scroller = el.closest('[data-ignatius="dict-view"]') ?? document.scrollingElement;
    const rect = el.getBoundingClientRect();
    scroller?.scrollBy(0, rect.bottom - (window.innerHeight - 24));
  });
  await page.waitForTimeout(300);
  await dictBadge.click();
  await popover.waitFor({ timeout: 5_000 });
  const placed = await popover.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
  });
  assert(placed.top >= 0 && placed.bottom <= placed.viewport, `a popover opened near the bottom stays inside the viewport (${JSON.stringify(placed)})`);
  await page.screenshot({ path: join(SHOTS, 'flipped.png') });

  console.log(`\nAll change badge popover checks passed. Screenshots in ${SHOTS}`);
} finally {
  await browser.close();
  handle.stop(true);
  rmSync(root, { recursive: true, force: true });
}
