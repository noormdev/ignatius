/**
 * test-large-model-nav.ts — the flow index, breadcrumb level menus, hover
 * delay, and animation cutoff in the running app (docs/spec/large-model-nav.md).
 *
 * Why it matters: on a model with dozens of flows the only way to a flow was
 * drilling down, and every pointer pass over a diagram faded the whole view.
 * This drives a served fixture through a browser and checks what a user sees:
 *   1. a crumb gets a ▾ only when its level has another diagram, and the menu
 *      lists them with descriptions, filters them, and switches flows by
 *      pointer or keyboard;
 *   2. the root chip and the `i` key open the index, whose rows open the exact
 *      diagram even when two flows decompose a same-named process, and the
 *      URL keeps that diagram across a reload;
 *   3. a hover fades nothing until the pointer rests HOVER_INTENT_MS, and
 *      opening a dialog clears it at once;
 *   4. a diagram or dictionary over ANIMATION_ELEMENT_LIMIT drops its fades.
 *
 * Generates its fixture under tmp/. Skips when dist/static is not built. The
 * two same-named `Submit` sub-DFDs make the Dictionary log React duplicate-key
 * warnings (its process rows key on bare ids); that is known and out of scope.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { serveCommand } from '../../src/server/server';
import { HOVER_INTENT_MS } from '../../src/app/logic/motion';

const ROOT = resolve(import.meta.dir, '../..');
const BUNDLE = join(ROOT, 'dist/static/index.js');
if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const FIXTURE = join(ROOT, 'tmp/large-model-nav-fixture');
const WIDE_PROCESSES = 80;
const ENTITIES = 70;
// Enough one-process flows that the System level holds more than the level
// menu's filter threshold (8), so the filter and keyboard paths render.
const EXTRA_FLOWS = 7;
const FLOW_COUNT = 3 + EXTRA_FLOWS;

function processFile(name: string, number: number, description?: string): string {
  return [
    '---',
    `process: ${name}`,
    `number: ${number}`,
    ...(description ? [`description: ${description}`] : []),
    'inputs:',
    '  - from: ext:Clerk',
    '    data: request',
    'outputs:',
    '  - to: ext:Clerk',
    '    data: response',
    '---',
    '',
  ].join('\n');
}

rmSync(FIXTURE, { recursive: true, force: true });
for (const dir of ['externals', 'groups', 'data', 'flows/alpha/Submit', 'flows/beta/Submit', 'flows/wide']) {
  mkdirSync(join(FIXTURE, dir), { recursive: true });
}
writeFileSync(join(FIXTURE, 'ignatius.yml'), 'name: NavFixture\ndescription: A fixture for flow navigation.\n');
writeFileSync(join(FIXTURE, 'externals/Clerk.md'), '---\nexternal: Clerk\n---\n');
writeFileSync(join(FIXTURE, 'groups/misc.md'), '---\nlabel: Misc\ncolor: "#888888"\n---\n');
for (let i = 0; i < ENTITIES; i++) {
  writeFileSync(join(FIXTURE, `data/Thing${i}.md`), `---\nentity: Thing${i}\ngroup: misc\npk: [id]\ncolumns:\n  id: { type: integer }\n---\n`);
}
writeFileSync(join(FIXTURE, 'flows/alpha/index.md'), '---\ndescription: Alpha takes orders.\n---\n');
writeFileSync(join(FIXTURE, 'flows/alpha/Submit.md'), processFile('Submit', 1, 'Alpha submits.'));
writeFileSync(join(FIXTURE, 'flows/alpha/Cancel.md'), processFile('Cancel', 2));
writeFileSync(join(FIXTURE, 'flows/alpha/Submit/Check.md'), processFile('Check', 1));
writeFileSync(join(FIXTURE, 'flows/alpha/Submit/Price.md'), processFile('Price', 2));
writeFileSync(join(FIXTURE, 'flows/beta/Submit.md'), processFile('Submit', 1, 'Beta submits.'));
writeFileSync(join(FIXTURE, 'flows/beta/Hold.md'), processFile('Hold', 2));
writeFileSync(join(FIXTURE, 'flows/beta/Submit/Place.md'), processFile('Place', 1));
for (let i = 1; i <= EXTRA_FLOWS; i++) {
  mkdirSync(join(FIXTURE, `flows/extra-${i}`), { recursive: true });
  writeFileSync(join(FIXTURE, `flows/extra-${i}/Step.md`), processFile('Step', 1));
}
for (let i = 1; i <= WIDE_PROCESSES; i++) {
  writeFileSync(join(FIXTURE, `flows/wide/Step${String(i).padStart(3, '0')}.md`), processFile(`Step ${i}`, i));
}

let failures = 0;
function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

const PORT = 3318;
const handle = serveCommand(FIXTURE, { port: PORT });
await new Promise<void>(r => setTimeout(r, 400));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const BASE = `http://localhost:${PORT}/`;

async function waitForFlow(): Promise<void> {
  await page.waitForFunction(() => window.__IGNATIUS_FLOW_READY__ === true, null, { timeout: 30_000 });
  await page.waitForTimeout(150);
}
const crumbTexts = async () => (await page.locator('[data-ignatius="flow-crumb"]').allInnerTexts()).map(t => t.replace(/\s*▾\s*$/, ''));
const svgText = async () => (await page.locator('[data-ignatius="flow-svg"]').textContent()) ?? '';
const dimmedCount = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-ignatius="flow-svg"] g[data-token]')].filter(g => g.getAttribute('opacity') !== '1').length);
const transitionCount = () => page.evaluate(() =>
  [...document.querySelectorAll<SVGGElement>('[data-ignatius="flow-svg"] g[data-token]')].filter(g => g.style.transition !== '').length);

try {
  // ── 0. Landing: the System overview, no derived crumbs ──────────────────
  await page.goto(`${BASE}#view=flow`);
  await waitForFlow();
  const indexChip = page.locator('[data-ignatius="flow-index-button"]');
  assert((await svgText()).includes('Alpha') && (await svgText()).includes('Beta'), 'Flows opens on the overview that shows every flow');
  assert(JSON.stringify(await crumbTexts()) === '[]', 'the derived Context and System levels get no crumb', JSON.stringify(await crumbTexts()));
  const homeButton = page.locator('[data-ignatius="flow-home-button"]');
  assert(await homeButton.getAttribute('aria-current') === 'page', 'the Home button is current on the overview');
  assert(await page.locator('.flow-crumbs__back').count() === 0, 'the overview has no Back button');
  await indexChip.click();
  const derivedRows = await page.locator('[data-ignatius="flow-index-row"][data-path$="__context__"], [data-ignatius="flow-index-row"][data-path$="__system__"]').count();
  assert(derivedRows === 0, 'the index has no Context or System rows; the flows are its top level', `derived rows=${derivedRows}`);
  assert((await page.locator('[data-ignatius="flow-index-pane"]').innerText()).includes('A fixture for flow navigation.'), 'opened from the overview, the pane describes the model');
  await page.keyboard.press('Escape');

  await page.goto(`${BASE}#view=flow&dfd=beta`);
  await waitForFlow();

  // ── 1. Level menus ──────────────────────────────────────────────────────
  assert(JSON.stringify(await crumbTexts()) === '["2 Beta"]', 'a flow deep link shows only the authored crumb', JSON.stringify(await crumbTexts()));
  assert(await homeButton.getAttribute('aria-current') === null, 'Home is not current inside a flow');
  const menuButtons = page.locator('[data-ignatius="flow-crumb-menu-button"]');
  assert(await menuButtons.count() === 1, 'the flow crumb has a ▾ listing its sibling flows', `count=${await menuButtons.count()}`);

  const menu = page.locator('[data-ignatius="flow-level-menu"]');
  const items = page.locator('[data-ignatius="flow-level-menu-item"]');
  await menuButtons.first().click();
  assert(await items.count() === FLOW_COUNT, `the level menu lists all ${FLOW_COUNT} flows`, `count=${await items.count()}`);
  assert((await items.filter({ hasText: 'Alpha' }).innerText()).includes('Alpha takes orders.'), 'a menu entry shows its flow description from index.md');
  assert((await items.filter({ hasText: 'Beta' }).getAttribute('aria-selected')) === 'true', 'the current flow is marked in its menu');
  await page.keyboard.press('Escape');
  assert(await menu.count() === 0, 'Esc closes the menu');

  await menuButtons.first().click();
  await page.locator('.flow-crumbs__sep').first().click();
  assert(await menu.count() === 0, 'a click outside closes the menu');

  await menuButtons.first().click();
  assert(await page.locator('.flow-level-menu__filter').count() === 1, `a level with more than eight diagrams shows a filter`);
  await page.keyboard.type('Extra');
  assert(await items.count() === EXTRA_FLOWS, 'typing filters the entries', `count=${await items.count()}`);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('alpha');
  await page.keyboard.press('Enter');
  await waitForFlow();
  assert((await crumbTexts()).at(-1) === '1 Alpha', 'Enter on the filtered entry switches to that flow', JSON.stringify(await crumbTexts()));
  assert(await menu.count() === 0, 'the menu closes after a pick');

  await menuButtons.first().click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForFlow();
  assert((await crumbTexts()).at(-1) === '2 Beta', '↓ then Enter picks the next flow', JSON.stringify(await crumbTexts()));

  // ── 2. Flow index ───────────────────────────────────────────────────────
  await page.locator('[data-ignatius="flow-index-button"]').click();
  assert(await page.locator('[data-ignatius="flow-index"]').count() === 1, 'the Process Flows chip opens the index');
  const wideRows = await page.locator('[data-ignatius="flow-index-row"][data-path$="/wide"] .flow-index__num').allInnerTexts();
  assert(wideRows.length === WIDE_PROCESSES + 1, 'the index lists the wide flow and each of its processes', `rows=${wideRows.length}`);
  const wideSteps = wideRows.filter(n => n.includes('.')).map(n => Number(n.split('.')[1]));
  assert(wideSteps.every((n, i) => n === i + 1), 'index rows run in number order', wideSteps.slice(0, 12).join(','));

  const betaSubmit = page.locator('[data-ignatius="flow-index-row"][data-path$="/beta/Submit"]').first();
  await betaSubmit.hover();
  assert((await page.locator('[data-ignatius="flow-index-pane"]').innerText()).includes('Beta submits.'), 'hovering a row shows its description in the pane');
  await betaSubmit.click();
  await waitForFlow();
  assert(await page.locator('[data-ignatius="flow-index"]').count() === 0, 'choosing a row closes the index');
  const svgAfterPick = await svgText();
  assert(svgAfterPick.includes('Place') && !svgAfterPick.includes('Price'), 'the row opens beta/Submit, not the same-named alpha/Submit');
  const pickedHash = await page.evaluate(() => location.hash);
  assert(pickedHash.includes('dfd=beta/Submit'), 'the URL carries the diagram path, not a bare id', pickedHash);
  await page.reload();
  await waitForFlow();
  const svgAfterReload = await svgText();
  assert(svgAfterReload.includes('Place') && !svgAfterReload.includes('Price'), 'a reload lands on the same sub-DFD');
  await homeButton.click();
  await waitForFlow();
  assert(JSON.stringify(await crumbTexts()) === '[]' && await homeButton.getAttribute('aria-current') === 'page', 'Home returns from a sub-DFD to the overview in one click', JSON.stringify(await crumbTexts()));
  await page.goBack();
  await waitForFlow();

  await page.keyboard.press('i');
  assert(await page.locator('[data-ignatius="flow-index"]').count() === 1, '`i` opens the index');
  await page.keyboard.press('i');
  assert(await page.locator('[data-ignatius="flow-index"]').count() === 0, '`i` closes the index');
  await page.keyboard.press('i');
  await page.keyboard.press('Escape');
  assert(await page.locator('[data-ignatius="flow-index"]').count() === 0, 'Esc closes the index');

  // ── 3. Hover delay ──────────────────────────────────────────────────────
  await page.goto(`${BASE}#view=flow&dfd=alpha`);
  await waitForFlow();
  assert(await transitionCount() > 0, 'a small diagram keeps its fade transitions');
  const node = page.locator('[data-token^="proc:"]').first();
  const box = await node.boundingBox();
  assert(box !== null, 'a process node is on screen');
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    await page.waitForTimeout(HOVER_INTENT_MS / 3);
    assert(await dimmedCount() === 0, `nothing fades before the pointer rests ${HOVER_INTENT_MS} ms`);
    await page.waitForTimeout(HOVER_INTENT_MS);
    assert(await dimmedCount() > 0, 'the hover focus applies once the pointer rests');
    await page.mouse.move(2, 450);
    await page.waitForTimeout(HOVER_INTENT_MS / 3);
    assert(await dimmedCount() > 0, 'leaving keeps the focus until the pointer rests elsewhere');
    await page.waitForTimeout(HOVER_INTENT_MS);
    assert(await dimmedCount() === 0, 'resting on empty space clears the focus');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    await page.waitForTimeout(HOVER_INTENT_MS + 100);
    assert(await dimmedCount() > 0, 'the focus is back before the dialog check');
    await page.locator('[data-ignatius="flow-chip"]').first().click();
    await page.waitForSelector('.modal', { timeout: 5000 });
    assert(await dimmedCount() === 0, 'opening an edge contract dialog clears the hover at once');
    await page.locator('.modal-close').first().click();
  }

  // ── 4. Animation cutoff ─────────────────────────────────────────────────
  await page.goto(`${BASE}#view=flow&dfd=wide`);
  await waitForFlow();
  assert(await transitionCount() === 0, `a diagram over the element limit renders without fade transitions`);
  await page.goto(`${BASE}#view=dict`);
  await page.waitForSelector('[data-ignatius="dict-view"]', { timeout: 20_000 });
  assert(await page.locator('[data-ignatius="dict-view"]').getAttribute('data-motion') === 'off', 'a dictionary over the element limit turns motion off');
} finally {
  await page.close();
  await browser.close();
  handle.stop();
  rmSync(FIXTURE, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\ntest-large-model-nav: all assertions passed.');
process.exit(0);
