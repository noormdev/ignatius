/**
 * Playwright check: graph arrangement edits, driven by real pointer and
 * keyboard gestures.
 *
 *   1. Dragging a node, then Ctrl+Z, puts it back; Ctrl+Shift+Z moves it again.
 *   2. Select mode (S): a background drag box-selects; dragging one selected
 *      node moves the others with it; S again leaves select mode.
 *   3. Right-click hides a node; undo/redo cover it; the "N hidden" list
 *      shows it again; a hidden node stays hidden across a reload; hiding every
 *      member of a subtype cluster hides its joiner too.
 *   4. A model edit keeps the user's arrangement: after a new entity file
 *      appears, a node the user moved stays where it was and the new entity
 *      sits next to the table it references.
 *   5. Reset layout runs without a hidden node; showing it after a view switch
 *      seats it clear of the others, near its neighbour.
 *   6. Undoing a layout-mode switch restores the mode as well as the positions.
 *      In the Tree layout a parent→child line is right-angled, and stays so
 *      after a drag; leaving Tree drops the routing. A click during a pending
 *      switch does not cancel it.
 *   7. Searching for a hidden entity shows it before selecting it.
 *
 * Serves a copy of models/key-inherited (step 4 writes into it) on port 7441.
 * Screenshots land in tmp/graph-edits/. NOT run by `bun run test`.
 */

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { resolve, join } from 'path';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { HOVER_INTENT_MS } from '../../src/app/logic/motion';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'graph-edits');
const MODEL = join(TMP, 'model');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
cpSync(join(ROOT, 'models', 'key-inherited'), MODEL, { recursive: true });

const PORT = 7441;
const BASE = `http://localhost:${PORT}`;
const note = (m: string) => console.log(m);
let failures = 0;
const check = (ok: boolean, m: string) => {
  if (ok) note(`PASS: ${m}`);
  else { console.error(`FAIL: ${m}`); failures++; }
};

const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', MODEL, '--port', String(PORT)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

async function waitForServer(url: string, timeout = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return true; } catch {}
    await Bun.sleep(200);
  }
  return false;
}

type Point = { x: number; y: number };

// Page coordinates of a node's centre.
async function screenPoint(page: Page, id: string): Promise<Point> {
  return page.evaluate((nodeId) => {
    const cy = (() => { const c = window.__IGNATIUS_CY__; if (!c) throw new Error('no live cytoscape core'); return c; })();
    const rp = cy.$id(nodeId).renderedPosition();
    const rect = cy.container().getBoundingClientRect();
    return { x: rect.left + rp.x, y: rect.top + rp.y };
  }, id);
}

async function modelPosition(page: Page, id: string): Promise<Point> {
  return page.evaluate((nodeId) => {
    const p = (() => { const c = window.__IGNATIUS_CY__; if (!c) throw new Error('no live cytoscape core'); return c; })().$id(nodeId).position();
    return { x: p.x, y: p.y };
  }, id);
}

async function hasClass(page: Page, id: string, cls: string): Promise<boolean> {
  return page.evaluate(([nodeId, cls]) => (() => { const c = window.__IGNATIUS_CY__; if (!c) throw new Error('no live cytoscape core'); return c; })().$id(nodeId).hasClass(cls),
    [id, cls] as const);
}

async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ids: string[] = [];
    (() => { const c = window.__IGNATIUS_CY__; if (!c) throw new Error('no live cytoscape core'); return c; })().nodes(':selected').forEach((n: { id(): string }) => { ids.push(n.id()); });
    return ids;
  });
}

async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function rightClick(page: Page, id: string): Promise<void> {
  const p = await screenPoint(page, id);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(HOVER_INTENT_MS + 150); // past the hover delay, so a stuck fade would show
}

const near = (a: Point, b: Point, tolerance = 1) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;

async function waitForLayout(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__IGNATIUS_PERF__?.layoutStopAt, null, { timeout: 60_000 });
  await page.waitForTimeout(300);
}

async function showAll(page: Page): Promise<void> {
  await page.locator('.graph-edit-hidden').click();
  await page.getByText('Show all').click();
  await page.waitForTimeout(300);
}

try {
  if (!(await waitForServer(BASE))) throw new Error('server did not start');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('graph-edits-seeded')) {
      localStorage.setItem('ignatius-layout-mode', 'hierarchical');
      sessionStorage.setItem('graph-edits-seeded', '1');
    }
  });
  await page.goto(BASE);
  await waitForLayout(page);

  // 1. drag + undo/redo
  const partyStart = await modelPosition(page, 'Party');
  const partyScreen = await screenPoint(page, 'Party');
  await drag(page, partyScreen, { x: partyScreen.x + 160, y: partyScreen.y + 40 });
  const partyMoved = await modelPosition(page, 'Party');
  check(!near(partyStart, partyMoved, 20), 'drag moves Party');
  await page.keyboard.press('Control+z');
  check(near(await modelPosition(page, 'Party'), partyStart), 'Ctrl+Z puts Party back');
  await page.keyboard.press('Control+Shift+Z');
  check(near(await modelPosition(page, 'Party'), partyMoved), 'Ctrl+Shift+Z moves Party again');
  await page.keyboard.press('Control+z');

  // 2. select mode, box select, group drag
  await page.keyboard.press('s');
  check(await page.locator('[aria-label="Select mode"][aria-pressed="true"]').count() === 1, 'S turns select mode on');
  const business = await screenPoint(page, 'Business');
  const person = await screenPoint(page, 'Person');
  const boxFrom = { x: Math.min(business.x, person.x) - 60, y: Math.min(business.y, person.y) - 30 };
  const boxTo = { x: Math.max(business.x, person.x) + 60, y: Math.max(business.y, person.y) + 30 };
  await drag(page, boxFrom, boxTo);
  const selected = await selectedIds(page);
  check(selected.includes('Business') && selected.includes('Person'), `box selects Business and Person (got ${selected.join(', ')})`);
  await page.screenshot({ path: join(TMP, '01-box-selected.png') });
  const personBefore = await modelPosition(page, 'Person');
  const businessBefore = await modelPosition(page, 'Business');
  await drag(page, business, { x: business.x, y: business.y + 120 });
  const personAfter = await modelPosition(page, 'Person');
  const businessAfter = await modelPosition(page, 'Business');
  const dy = (p: Point, q: Point) => q.y - p.y;
  check(dy(businessBefore, businessAfter) > 30 && Math.abs(dy(personBefore, personAfter) - dy(businessBefore, businessAfter)) < 1,
    'dragging Business moves the selected Person by the same amount');
  await page.keyboard.press('Control+z');
  check(near(await modelPosition(page, 'Person'), personBefore) && near(await modelPosition(page, 'Business'), businessBefore),
    'one Ctrl+Z undoes the whole group drag');
  await page.keyboard.press('s');
  check(await page.locator('[aria-label="Select mode"][aria-pressed="false"]').count() === 1, 'S turns select mode off');

  // 3. hide / show
  await page.mouse.click(5, 450); // background: clear the selection
  await rightClick(page, 'Identity');
  check(await hasClass(page, 'Identity', 'user-hidden'), 'right-click hides Identity');
  check(await page.locator('.graph-edit-hidden[aria-label="1 hidden"]').count() === 1, 'edit bar counts 1 hidden');
  const fadedAfterHide = await page.evaluate(() => (() => { const c = window.__IGNATIUS_CY__; if (!c) throw new Error('no live cytoscape core'); return c; })().nodes('.faded').length);
  check(fadedAfterHide === 0, `hiding the hovered node clears its hover fade (${fadedAfterHide} nodes still faded)`);
  await page.screenshot({ path: join(TMP, '02-identity-hidden.png') });
  await page.keyboard.press('Control+z');
  check(!(await hasClass(page, 'Identity', 'user-hidden')), 'Ctrl+Z shows Identity again');
  await page.keyboard.press('Control+Shift+Z');
  check(await hasClass(page, 'Identity', 'user-hidden'), 'Ctrl+Shift+Z hides it again');
  await page.locator('.graph-edit-hidden').click();
  await page.screenshot({ path: join(TMP, '03-hidden-list.png') });
  await page.getByText('Show all').click();
  check(!(await hasClass(page, 'Identity', 'user-hidden')), '"Show all" brings Identity back');
  await rightClick(page, 'Identity');
  await page.waitForTimeout(300);
  await page.reload();
  await waitForLayout(page);
  check(await hasClass(page, 'Identity', 'user-hidden'), 'a hidden node stays hidden across a reload');
  await showAll(page);
  await rightClick(page, 'Person');
  await rightClick(page, 'Business');
  check(await hasClass(page, '_joiner_Party_x', 'user-hidden'), 'hiding every member of a subtype cluster hides its joiner');
  await showAll(page);
  check(!(await hasClass(page, '_joiner_Party_x', 'user-hidden')), 'showing a member brings the joiner back');

  // 4. carry-over across a model edit
  const ssnScreen = await screenPoint(page, 'SSN');
  await drag(page, ssnScreen, { x: ssnScreen.x + 200, y: ssnScreen.y - 120 });
  await page.waitForTimeout(600); // debounced save
  const ssnMoved = await modelPosition(page, 'SSN');
  const gen = await page.evaluate(() => window.__IGNATIUS_CY_GEN__ ?? 0);
  writeFileSync(join(MODEL, 'data', 'transactional', 'Refund.md'), [
    '---',
    'entity: Refund',
    'group: transactional',
    'pk: [party_id, payment_method_id, payment_id, refund_no]',
    'columns:',
    '  party_id: { type: integer, desc: "Party." }',
    '  payment_method_id: { type: integer, desc: "Method." }',
    '  payment_id: { type: integer, desc: "Payment refunded." }',
    '  refund_no: { type: integer, desc: "Refund within the payment." }',
    'relationships:',
    '  - target: Payment',
    '    on: { party_id: party_id, payment_method_id: payment_method_id, payment_id: payment_id }',
    '    predicate: { fwd: is returned by, rev: returns }',
    '---',
    '',
    '# Refund',
    '',
    'Money returned against a [[Payment]].',
    '',
  ].join('\n'));
  await page.waitForFunction((g) => (window.__IGNATIUS_CY_GEN__ ?? 0) > g
    && (window.__IGNATIUS_CY__?.$id('Refund').nonempty() ?? false), gen, { timeout: 30_000 });
  await waitForLayout(page);
  await page.waitForTimeout(500);
  check(near(await modelPosition(page, 'SSN'), ssnMoved), 'SSN keeps the spot the user dragged it to after the model edit');
  const refund = await modelPosition(page, 'Refund');
  const payment = await modelPosition(page, 'Payment');
  const gap = Math.hypot(refund.x - payment.x, refund.y - payment.y);
  check(gap < 400, `the new Refund sits next to Payment (${Math.round(gap)} units away)`);
  await page.screenshot({ path: join(TMP, '04-after-model-edit.png') });

  // 5. Reset layout without a hidden node, then a view switch, then show it.
  await rightClick(page, 'Identity');
  await page.locator('button.fab').click();
  await page.getByRole('menuitem', { name: 'Reset layout' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(TMP, '05-reset-without-identity.png') });
  check(await hasClass(page, 'Identity', 'user-hidden'), 'Identity stays hidden through Reset layout');
  await page.keyboard.press('d');
  await page.waitForTimeout(500);
  await page.keyboard.press('g');
  await waitForLayout(page);
  await showAll(page);
  const overlaps = await page.evaluate(() => {
    const cy = (() => { const c = window.__IGNATIUS_CY__; if (!c) throw new Error('no live cytoscape core'); return c; })();
    const me = cy.$id('Identity').boundingBox();
    const hits: string[] = [];
    cy.nodes(':childless:visible').not(cy.$id('Identity')).forEach((n: { id(): string; boundingBox(): { x1: number; x2: number; y1: number; y2: number } }) => {
      const b = n.boundingBox();
      if (b.x1 < me.x2 && me.x1 < b.x2 && b.y1 < me.y2 && me.y1 < b.y2) hits.push(n.id());
    });
    return hits;
  });
  check(overlaps.length === 0, `Identity shown after Reset and a view switch overlaps nothing (overlaps: ${overlaps.join(', ') || 'none'})`);
  const identityBack = await modelPosition(page, 'Identity');
  const party = await modelPosition(page, 'Party');
  const toParty = Math.hypot(identityBack.x - party.x, identityBack.y - party.y);
  check(toParty < 600, `shown Identity sits near Party (${Math.round(toParty)} units away)`);
  await page.screenshot({ path: join(TMP, '06-identity-shown.png') });

  // 6. Undo a layout-mode switch. L steps hierarchical → tree.
  const stored = () => page.evaluate(() => localStorage.getItem('ignatius-layout-mode'));
  const partyHier = await modelPosition(page, 'Party');
  await page.keyboard.press('l');
  await page.waitForFunction(() => localStorage.getItem('ignatius-layout-mode') === 'tree', null, { timeout: 5_000 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const modeAfterUndo = await stored();
  check(modeAfterUndo === 'hierarchical', `undoing the mode switch restores the stored mode (got ${modeAfterUndo})`);
  check(near(await modelPosition(page, 'Party'), partyHier), 'undoing the mode switch restores the hierarchical positions');

  // 6a. Tree layout: a parent→child line drops down then turns right into
  //     the child, and stays right-angled after the child is dragged.
  await page.keyboard.press('l');
  await page.waitForFunction(() => localStorage.getItem('ignatius-layout-mode') === 'tree', null, { timeout: 5_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(TMP, '07-tree.png') });
  // Any parent→child tree line into a table (not a subtype diamond).
  const picked = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    const edge = cy?.edges('.tree-edge').not('.tree-label-source').filter(e => e.target().data('joiner') !== 'true')[0];
    return edge ? { id: edge.id(), parent: edge.source().id(), child: edge.target().id() } : null;
  });
  check(picked !== null, `the tree layout routes parent→child lines (${JSON.stringify(picked)})`);
  const treeLine = () => page.evaluate((line) => {
    const cy = (() => { const c = window.__IGNATIUS_CY__; if (!c) throw new Error('no live cytoscape core'); return c; })();
    const edge = cy.$id(line?.id ?? '');
    if (edge.empty() || !line) return null;
    const pts = [edge.sourceEndpoint(), ...(edge.segmentPoints() ?? []), edge.targetEndpoint()];
    const square = pts.every((p, i) => i === 0 || Math.abs(p.x - (pts[i - 1]?.x ?? p.x)) < 0.5 || Math.abs(p.y - (pts[i - 1]?.y ?? p.y)) < 0.5);
    return {
      tree: edge.hasClass('tree-edge'),
      square,
      bends: pts.length - 2,
      childRight: cy.$id(line.child).position('x') > cy.$id(line.parent).position('x'),
    };
  }, picked);
  const before = await treeLine();
  check(before?.tree === true && before.square && before.bends >= 1 && before.childRight,
    `${picked?.parent} → ${picked?.child} is a right-angled tree line into a child to its right (${JSON.stringify(before)})`);
  const childScreen = await screenPoint(page, picked?.child ?? '');
  await drag(page, childScreen, { x: childScreen.x + 90, y: childScreen.y + 60 });
  const after = await treeLine();
  check(after?.square === true, `the tree line stays right-angled after a drag (${JSON.stringify(after)})`);
  await page.keyboard.press('Control+z');

  // 6a2. Undo while a switch away from Tree computes keeps Tree and its routing.
  await page.keyboard.press('l');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const afterCancel = await page.evaluate(() => ({
    mode: localStorage.getItem('ignatius-layout-mode'),
    routed: window.__IGNATIUS_CY__?.edges('.tree-edge, .tree-cross').length ?? 0,
  }));
  check(afterCancel.mode === 'tree' && afterCancel.routed > 0,
    `undo during a pending switch keeps Tree routed (${JSON.stringify(afterCancel)})`);

  // 6b. A plain click while a mode switch computes must not cancel it.
  //     L steps tree → organic, whose search takes a moment.
  const partyBeforeSwitch = await modelPosition(page, 'Party');
  await page.keyboard.press('l');
  await page.waitForTimeout(150);
  const paymentScreen = await screenPoint(page, 'Payment');
  await page.mouse.click(paymentScreen.x, paymentScreen.y);
  await page.waitForTimeout(5000);
  await page.keyboard.press('Escape');
  const modeAfterClick = await stored();
  check(modeAfterClick === 'organic', `the switch still lands after a click (mode ${modeAfterClick})`);
  check(!near(await modelPosition(page, 'Party'), partyBeforeSwitch, 5), 'the organic positions landed under the organic label');
  const lingering = await page.evaluate(() => window.__IGNATIUS_CY__?.edges('.tree-edge, .tree-cross').length ?? -1);
  check(lingering === 0, `leaving the tree layout drops its line routing (${lingering} edges still routed)`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  // 7. Search for a hidden entity.
  await rightClick(page, 'SalesOrder');
  await page.keyboard.press('/');
  await page.keyboard.type('SalesOrder');
  await page.waitForTimeout(600); // the search term is debounced
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check(!(await hasClass(page, 'SalesOrder', 'user-hidden')), 'searching for a hidden entity shows it');

  await browser.close();
} finally {
  proc.kill();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
note('\nAll graph-edit checks passed.');
