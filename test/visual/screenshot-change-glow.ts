// Captures the change-review glows (docs/spec/model-change-review.md SC7, SC9) on the graph and the order-to-cash
// diagram, per theme and motion setting, two frames each plus close-up crops.

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'models/key-inherited');
const OUT = join(ROOT, 'tmp/change-glow-shots');
const PORT = 3341;
mkdirSync(OUT, { recursive: true });

const root = mkdtempSync(join(tmpdir(), 'ignatius-glow-'));
const dir = join(root, 'model');
const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });

const handle = serveCommand(dir, { port: PORT });
const baseline = join(dir, '.ignatius/baseline.json');
while (!existsSync(baseline)) await Bun.sleep(50);

const edit = (file: string, change: (text: string) => string) => writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')));
edit('data/identity/Person.md', t => t.replace('  birthdate:\n', '  nickname:\n    type: text\n    desc: "Added."\n  birthdate:\n'));
edit('data/identity/Business.md', t => `${t}\nRegistered businesses only.\n`);
writeFileSync(join(dir, 'data/identity/Visa.md'), readFileSync(join(dir, 'data/identity/Passport.md'), 'utf8')
  .replace('entity: Passport', 'entity: Visa').replace('# Passport', '# Visa'));
unlinkSync(join(dir, 'data/transactional/PaymentAllocation.md'));
edit('flows/order-to-cash/Issue-Invoice.md', t => t
  .replace('process: Issue Invoice', 'process: Issue Customer Invoice')
  .replace('  - to: ext:Customer\n', '  - to: queue:invoice-events\n    data: [sales_invoice_id]\n  - to: ext:Customer\n'));
edit('flows/order-to-cash/Create-Sales-Order/Record-Order.md', t => t.replace('process: Record Order', 'process: Record Sales Order'));
edit('flows/refund/Process-Return.md', t => t.replace('process: Process Return', 'process: Process Customer Return'));
mkdirSync(join(dir, 'flows/billing'), { recursive: true });
writeFileSync(join(dir, 'flows/billing/Send-Statement.md'), [
  '---',
  'process: Send Statement',
  'number: 1',
  'outputs:',
  '  - to: ext:Customer',
  '    data: statement',
  '---',
  '',
].join('\n'));
mkdirSync(join(dir, '.ignatius/changes'), { recursive: true });
writeFileSync(join(dir, '.ignatius/changes/glow.md'), [
  '---',
  'title: Visas, nicknames, invoice events',
  'entities:',
  '  Person: [nickname]',
  '  Visa: []',
  'flows:',
  '  order-to-cash: [invoice-events]',
  '  refund: [Process-Return]',
  '---',
  '',
].join('\n'));

const browser = await chromium.launch();
const shots: string[] = [];

try {
  for (const theme of ['dark', 'light'] as const) {
    for (const motion of ['normal', 'reduce'] as const) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: motion === 'reduce' ? 'reduce' : 'no-preference' });
      await context.addInitScript((mode) => localStorage.setItem('ignatius-theme', mode), theme);
      const page = await context.newPage();
      await page.route('**/events', route => route.abort());

      await page.goto(`http://localhost:${PORT}/#view=graph`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__IGNATIUS_CY__?.$id('PaymentAllocation').nonempty() === true, null, { timeout: 30_000 });
      await page.evaluate(() => {
        const cy = window.__IGNATIUS_CY__!;
        cy.fit(cy.elements('[change]').closedNeighborhood(), 60);
      });
      await page.waitForTimeout(500);
      for (const frame of [1, 2]) {
        const file = join(OUT, `graph-${theme}-${motion}-${frame}.png`);
        await page.screenshot({ path: file });
        shots.push(file);
        for (const id of ['Person', 'Business', 'PaymentAllocation']) {
          const center = await page.evaluate((nodeId) => {
            const cy = window.__IGNATIUS_CY__!;
            cy.zoom(2.5);
            cy.center(cy.$id(nodeId));
            return { x: cy.width() / 2, y: cy.height() / 2 };
          }, id);
          await page.waitForTimeout(100);
          const close = join(OUT, `graph-${theme}-${motion}-${frame}-${id}.png`);
          await page.screenshot({ path: close, clip: { x: center.x - 300, y: center.y - 160, width: 600, height: 320 } });
          shots.push(close);
        }
        await page.evaluate(() => {
          const cy = window.__IGNATIUS_CY__!;
          cy.fit(cy.elements('[change]').closedNeighborhood(), 60);
        });
        await page.waitForTimeout(900);
      }

      // A dfd= in the hash only selects a diagram once the Flows view is showing.
      await page.evaluate(() => { location.hash = '#view=flow'; });
      await page.waitForFunction(() => window.__IGNATIUS_FLOW_READY__ === true, null, { timeout: 20_000 });
      await page.evaluate(() => { location.hash = '#view=flow&dfd=order-to-cash'; });
      await page.waitForSelector('[data-ignatius="flow-svg"] .flow-glow', { state: 'attached', timeout: 20_000 });
      await page.waitForTimeout(500);
      for (const frame of [1, 2]) {
        const file = join(OUT, `flow-${theme}-${motion}-${frame}.png`);
        await page.screenshot({ path: file });
        shots.push(file);
        await page.waitForTimeout(900);
      }
      const marked = page.locator('[data-ignatius="flow-svg"] g[data-change]');
      const first = await marked.first().boundingBox();
      if (first) {
        await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
        for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
        await page.waitForTimeout(400);
      }
      for (const frame of [1, 2]) {
        for (let i = 0; i < await marked.count(); i++) {
          const box = await marked.nth(i).boundingBox();
          if (!box) continue;
          const close = join(OUT, `flow-${theme}-${motion}-${frame}-node${i}.png`);
          await page.screenshot({ path: close, clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 40), width: box.width + 80, height: box.height + 80 } });
          shots.push(close);
        }
        await page.waitForTimeout(900);
      }

      if (motion === 'normal') {
        const panelFile = join(OUT, `panel-${theme}.png`);
        await page.locator('.changes-panel').screenshot({ path: panelFile });
        shots.push(panelFile);
      }

      await page.locator('[data-ignatius="flow-index-button"]').click();
      await page.locator('[data-ignatius="flow-index-row"]', { hasText: 'Record Sales Order' }).hover();
      const pane = await page.locator('[data-ignatius="flow-index-pane"]').boundingBox();
      if (pane && motion === 'normal') {
        const file = join(OUT, `index-${theme}-pane.png`);
        await page.screenshot({ path: file, clip: { x: pane.x, y: pane.y, width: pane.width, height: Math.min(pane.height, 200) } });
        shots.push(file);
      }
      await page.mouse.move(0, 0);
      const tree = await page.locator('.flow-index__tree').boundingBox();
      for (const frame of [1, 2]) {
        if (!tree) break;
        const file = join(OUT, `index-${theme}-${motion}-${frame}.png`);
        await page.screenshot({ path: file, clip: { x: tree.x, y: tree.y, width: Math.min(tree.width, 420), height: Math.min(tree.height, 360) } });
        shots.push(file);
        await page.waitForTimeout(1800);
      }
      await page.keyboard.press('Escape');
      await page.locator('[data-ignatius="flow-crumb-menu-button"]').first().click();
      await page.mouse.move(0, 0);
      const menu = await page.locator('[data-ignatius="flow-level-menu"]').boundingBox();
      for (const frame of [1, 2]) {
        if (!menu) break;
        const file = join(OUT, `levelmenu-${theme}-${motion}-${frame}.png`);
        await page.screenshot({ path: file, clip: { x: menu.x - 10, y: menu.y - 10, width: menu.width + 20, height: menu.height + 20 } });
        shots.push(file);
        await page.waitForTimeout(1800);
      }
      await page.keyboard.press('Escape');

      if (motion === 'normal') {
        await page.evaluate(() => { location.hash = '#view=flow&dfd=billing'; });
        await page.waitForSelector('[data-ignatius="flow-svg"] g[data-token="proc:Send-Statement"] .flow-glow', { state: 'attached', timeout: 20_000 });
        await page.waitForTimeout(500);
        const billingFile = join(OUT, `flow-billing-${theme}.png`);
        await page.screenshot({ path: billingFile });
        shots.push(billingFile);

        await page.evaluate(() => { location.hash = '#view=dict'; });
        const removedCard = page.locator('.dict-removed-section #entity-PaymentAllocation');
        await removedCard.scrollIntoViewIfNeeded();
        const cardFile = join(OUT, `dict-removed-${theme}.png`);
        await removedCard.screenshot({ path: cardFile });
        shots.push(cardFile);
      }
      await context.close();
    }
  }
  console.log(shots.join('\n'));
} finally {
  await browser.close();
  handle.stop(true);
  rmSync(root, { recursive: true, force: true });
}
process.exit(0);
