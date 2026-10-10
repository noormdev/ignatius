// docs/spec/model-change-review.md SC8 and SC9 on a temp copy of models/key-inherited: Person gains a noted column and loses
// and retypes unnoted ones; PaymentAllocation is deleted; Issue Invoice is relabelled (unnoted) and writes a new, noted store.

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { serveCommand } from '../../src/server/server';
import type { ChangeReview } from '../../src/model/change-review';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const PORT = 3332;

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const WATCHDOG_MS = 150_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-change-review-dict-flow.ts exceeded its ${WATCHDOG_MS}ms watchdog — a wait blocked indefinitely`);
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

const root = mkdtempSync(join(tmpdir(), 'ignatius-change-dict-flow-'));
const dir = join(root, 'model');
// Other checks serve models/key-inherited in place and leave .ignatius/ behind.
const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });

const handle = serveCommand(dir, { port: PORT });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30_000);
page.setDefaultNavigationTimeout(30_000);
// fs.watch reports file events here late and unprompted; each report refetches and rebuilds the views mid-step.
await page.route('**/events', route => route.abort());

type RowMark = { name: string; classes: string; type: string; decoration: string };

async function personRows(scope: string): Promise<RowMark[]> {
  return page.locator(`${scope} tbody tr`).evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('td code')?.textContent ?? '',
    classes: row.className,
    type: row.querySelectorAll('td')[1]?.textContent ?? '',
    decoration: getComputedStyle(row.querySelector('td') ?? row).textDecorationLine,
  })));
}

// A dfd= in the hash only selects a diagram once the Flows view is showing.
async function showDiagram(ref: string): Promise<void> {
  const flowReady = (dfd: string | null) => page.waitForFunction(
    (want) => window.__IGNATIUS_FLOW_READY__ === true && (want === null || window.__IGNATIUS_ACTIVE_FLOW_DFD__ === want),
    dfd,
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    if (new URLSearchParams(location.hash.slice(1)).get('view') === 'flow') return;
    window.__IGNATIUS_FLOW_READY__ = false;
    location.hash = '#view=flow';
  });
  await flowReady(null);
  if (await page.evaluate(() => window.__IGNATIUS_ACTIVE_FLOW_DFD__) === ref) return;
  await page.evaluate((dfd) => {
    window.__IGNATIUS_FLOW_READY__ = false;
    location.hash = `#view=flow&dfd=${dfd}`;
  }, ref);
  await flowReady(ref);
}

async function flowMarks(): Promise<Record<string, { change: string | null; unexplained: string | null }>> {
  return page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('[data-ignatius="flow-svg"] g[data-token][data-change]')].map(g => [
      g.getAttribute('data-token') ?? '',
      { change: g.getAttribute('data-change'), unexplained: g.getAttribute('data-unexplained') },
    ]),
  ));
}

async function glowSamples(target: Page, token: string, count: number): Promise<number[][]> {
  const frames: number[][] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) await target.waitForTimeout(600);
    frames.push(await target.locator(`g[data-token="${token}"] .flow-glow rect`).evaluateAll(rects => rects.map(r => Number(getComputedStyle(r).opacity))));
  }
  return frames;
}

async function showDict(): Promise<void> {
  await page.evaluate(() => { location.hash = '#view=dict'; });
  await page.waitForSelector('#entity-Person', { state: 'visible', timeout: 10_000 });
}

try {
  const baselinePath = join(dir, '.ignatius/baseline.json');
  const deadline = Date.now() + 10_000;
  while (!existsSync(baselinePath) && Date.now() < deadline) await sleep(50);
  assert(existsSync(baselinePath), 'serve wrote the baseline before the edits');

  const personFile = join(dir, 'data/identity/Person.md');
  writeFileSync(personFile, readFileSync(personFile, 'utf8')
    .replace('  last_name:\n    type: text\n    desc: "Person\'s family name."\n', '')
    .replaceAll(/    last_name: \w+\n/g, '')
    .replace('  birthdate:\n    type: date\n', '  nickname:\n    type: text\n    desc: "Added."\n  birthdate:\n    type: timestamp\n'));
  unlinkSync(join(dir, 'data/transactional/PaymentAllocation.md'));
  const issueInvoiceFile = join(dir, 'flows/order-to-cash/Issue-Invoice.md');
  writeFileSync(issueInvoiceFile, readFileSync(issueInvoiceFile, 'utf8')
    .replace('process: Issue Invoice', 'process: Issue Customer Invoice')
    .replace('  - to: ext:Customer\n', '  - to: queue:invoice-events\n    data: [sales_invoice_id]\n  - to: ext:Customer\n'));
  mkdirSync(join(dir, '.ignatius/changes'), { recursive: true });
  writeFileSync(join(dir, '.ignatius/changes/nickname-and-events.md'), [
    '---',
    'title: Nicknames and invoice events',
    'entities:',
    '  Person: [nickname]',
    'flows:',
    '  order-to-cash: [invoice-events]',
    '---',
    '',
    'Support greets by nickname; billing publishes invoice events.',
    '',
  ].join('\n'));

  const res = await fetch(`http://localhost:${PORT}/api/model`, { signal: AbortSignal.timeout(10_000) });
  const { diff } = await res.json() as { diff: ChangeReview | null };
  const flowItems = (diff?.items ?? []).flatMap(item => (item.scope === 'flow' ? [item] : []));
  const processItem = flowItems.find(item => item.kind === 'changed' && item.nodeKind === 'process' && item.diagram === 'order-to-cash');
  const storeItem = flowItems.find(item => item.kind === 'added' && item.storeKind === 'queue' && item.diagram === 'order-to-cash');
  assert(processItem !== undefined && storeItem !== undefined, 'fixture: diff lists the process change and the added store', JSON.stringify(flowItems));
  const procToken = `proc:${processItem?.node}`;
  const storeToken = 'queue:invoice-events';

  await page.goto(`http://localhost:${PORT}/#view=dict`, { waitUntil: 'load' });
  await page.waitForSelector('.changes-panel', { timeout: 10_000 });
  await page.waitForSelector('#entity-Person .change-badge', { timeout: 10_000 });

  const badge = page.locator('#entity-Person .change-badge');
  const badgeText = await badge.textContent() ?? '';
  assert(badgeText.startsWith('changed'), 'SC8: a changed entity card shows a "changed" badge', badgeText);
  assert((await badge.getAttribute('class'))?.includes('change-badge--unexplained') === true, 'SC8: unnoted column edits mark the badge unexplained');
  assert(await page.locator('#entity-Party .change-badge').count() === 0, 'SC8: an untouched entity card has no badge');

  const rows = await personRows('#entity-Person .dict-attr-table');
  const row = (name: string) => rows.find(r => r.name === name);
  assert(row('nickname')?.classes.includes('change-row--added') === true && !row('nickname')?.classes.includes('unexplained'),
    'SC8: the noted added column is marked added and explained', JSON.stringify(row('nickname')));
  assert(row('birthdate')?.classes.includes('change-row--changed') === true && row('birthdate')?.classes.includes('change-row--unexplained') === true,
    'SC8: the retyped column is marked changed and unexplained', JSON.stringify(row('birthdate')));
  assert(row('last_name')?.classes.includes('change-row--removed') === true && row('last_name')?.decoration === 'line-through' && row('last_name')?.type === 'text',
    'SC8: the removed column renders struck through with its baseline type', JSON.stringify(row('last_name')));
  assert(row('first_name')?.classes === '', 'SC8: an untouched column has no marker', JSON.stringify(row('first_name')));

  const removed = page.locator('.dict-removed-section #entity-PaymentAllocation');
  assert(await removed.count() === 1, 'SC8: the removed entity appears in the Removed section');
  assert((await removed.locator('.change-badge').textContent() ?? '').startsWith('removed'), 'SC8: the removed entity carries a "removed" badge');
  const removedBadge = await removed.locator('.change-badge').evaluate(el => ({
    color: getComputedStyle(el).color,
    light: document.documentElement.classList.contains('theme-light'),
  }));
  const warningText = removedBadge.light ? 'rgb(220, 38, 38)' : 'rgb(248, 113, 113)';
  assert(removedBadge.color === warningText, 'SC8: the removed badge text is the warning red readable on the theme', JSON.stringify(removedBadge));
  const effectiveOpacity = (el: Element) => {
    let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  };
  const badgeOpacity = await removed.locator('.change-badge').evaluate(effectiveOpacity);
  assert(badgeOpacity === 1, 'SC8: the removed badge renders at full opacity inside its dimmed card', String(badgeOpacity));
  const cardBodyOpacity = await removed.locator('.dict-entity-header h2').evaluate(effectiveOpacity);
  assert(cardBodyOpacity < 1, 'SC8: the rest of the removed card stays dimmed', String(cardBodyOpacity));
  const frame = await removed.evaluate(el => {
    const alpha = (color: string) => Number(color.match(/(?:\/\s*|rgba\((?:[^,]+,){3}\s*)([\d.]+)\)$/)?.[1] ?? 1);
    const style = getComputedStyle(el);
    return { border: style.borderTopColor, background: style.backgroundColor, borderAlpha: alpha(style.borderTopColor), backgroundAlpha: alpha(style.backgroundColor) };
  });
  assert(frame.borderAlpha < 1 && frame.backgroundAlpha < 1, 'SC8: the removed card\'s border and background are dimmed too', JSON.stringify(frame));
  const removedTitle = await removed.locator('.dict-entity-header h2').evaluate(h => getComputedStyle(h).textDecorationLine);
  assert(removedTitle === 'line-through', 'SC8: the removed entity title is struck through', removedTitle);

  const search = page.getByRole('searchbox', { name: 'Search dictionary' });
  await search.fill('nickname');
  await page.waitForSelector('#entity-Party', { state: 'detached', timeout: 5_000 });
  assert(await removed.count() === 0, 'the Removed section honours the Dictionary search: a non-matching removed entity is hidden');
  await search.fill('PaymentAllocation');
  await page.waitForSelector('#entity-Person', { state: 'detached', timeout: 5_000 });
  assert(await removed.count() === 1, 'the Removed section honours the Dictionary search: a matching removed entity stays');
  await search.fill('');
  await page.waitForSelector('#entity-Person', { state: 'visible', timeout: 5_000 });

  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  const removedLink = page.locator('.dict-removed-link');
  assert((await removedLink.textContent()) === '1 removed since approval', 'the browse lens counts the removed entities', await removedLink.textContent() ?? '');
  await removedLink.click();
  await page.waitForSelector('.dict-removed-section', { state: 'visible', timeout: 5_000 });
  await page.waitForFunction(() => {
    const top = document.querySelector('.dict-removed-section')?.getBoundingClientRect().top ?? -1;
    return top >= 0 && top < window.innerHeight;
  }, null, { timeout: 5_000 }).catch(() => {});
  const removedPos = await page.locator('.dict-removed-section').evaluate(el => ({ top: el.getBoundingClientRect().top, height: window.innerHeight }));
  assert(removedPos.top >= 0 && removedPos.top < removedPos.height, 'the browse-lens removed link opens the read lens at the Removed section', JSON.stringify(removedPos));

  const panelLabels = await page.locator('.changes-panel-item').allInnerTexts();
  assert(panelLabels.some(label => label.startsWith('Order To Cash / Issue Customer Invoice — process changed')),
    'the Changes panel names a flow node by diagram title and node label', JSON.stringify(panelLabels));
  assert(panelLabels.some(label => label.startsWith('Order To Cash / Invoice Events — store added')),
    'the Changes panel names a store by its display name', JSON.stringify(panelLabels));
  assert(panelLabels.every(label => !label.includes('__')), 'the Changes panel hides synthetic diagram ids', JSON.stringify(panelLabels));

  await page.evaluate(() => { location.hash = '#view=graph&entity=Person'; });
  await page.waitForSelector('.modal-backdrop', { timeout: 20_000 });
  const modalRows = await personRows('.modal-backdrop .doc-section');
  const modalRow = (name: string) => modalRows.find(r => r.name === name);
  assert(modalRow('nickname')?.classes.includes('change-row--added') === true
    && modalRow('birthdate')?.classes.includes('change-row--changed') === true
    && modalRow('last_name')?.decoration === 'line-through',
  'SC8: the entity modal shows the same column markers', JSON.stringify(modalRows));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 5_000 });

  await showDiagram('order-to-cash');
  const marks = await flowMarks();
  assert(marks[procToken]?.change === 'changed' && marks[procToken]?.unexplained === 'true',
    'SC9: the relabelled process is highlighted changed and unexplained', JSON.stringify(marks));
  // The default collapse level draws the new store inside the process's write stack.
  const stackToken = Object.keys(marks).find(token => token.startsWith('stack:') && token.includes(storeToken)) ?? '';
  assert(marks[stackToken]?.change === 'added' && marks[stackToken]?.unexplained === null,
    'SC9: a stack whose only marked member is the noted new store reads added and explained', JSON.stringify(marks));
  assert(Object.keys(marks).length === 2, 'SC9: only the changed nodes are highlighted', JSON.stringify(marks));
  const glow = await page.locator(`g[data-token="${stackToken}"] .flow-glow`).evaluate(el => ({
    layers: el.querySelectorAll('rect').length,
    strokes: [...el.querySelectorAll('rect')].map(r => getComputedStyle(r).stroke).filter(stroke => stroke !== 'none'),
    pointerEvents: getComputedStyle(el).pointerEvents,
  }));
  assert(glow.layers === 1 && glow.strokes.length === 0, 'SC9: an explained mark is one glow layer with no outline', JSON.stringify(glow));
  assert(glow.pointerEvents === 'none', 'the glow lets clicks through to the node', glow.pointerEvents);
  const unexplainedLayers = await page.locator(`g[data-token="${procToken}"] .flow-glow rect`).count();
  assert(unexplainedLayers === 2, 'SC9: an unexplained mark stacks a red glow layer with its kind color', String(unexplainedLayers));
  const pulsing = await glowSamples(page, procToken, 3);
  assert(new Set(pulsing.map(f => f.join())).size > 1, 'SC9: the glow pulses', JSON.stringify(pulsing));
  assert(pulsing.every(f => Math.max(...f) >= 0.2), 'SC9: the pulse never fades the glow out', JSON.stringify(pulsing));
  const explainedPulse = await glowSamples(page, stackToken, 3);
  assert(new Set(explainedPulse.map(f => f.join())).size > 1, 'SC9: an explained glow pulses', JSON.stringify(explainedPulse));
  const cycle = await page.locator(`g[data-token="${procToken}"] .flow-glow`).evaluate(el => {
    const kind = el.querySelector('.flow-glow-kind');
    const red = el.querySelector('.flow-glow-unexplained');
    if (!kind || !red) return [];
    const animations = [...kind.getAnimations(), ...red.getAnimations()];
    animations.forEach(a => a.pause());
    const steps: { kind: number; red: number }[] = [];
    for (let ms = 0; ms < 7200; ms += 100) {
      animations.forEach(a => { a.currentTime = ms; });
      steps.push({ kind: Number(getComputedStyle(kind).opacity), red: Number(getComputedStyle(red).opacity) });
    }
    animations.forEach(a => a.play());
    return steps;
  });
  assert(cycle.some(s => s.kind >= 0.8 && s.red <= 0.2) && cycle.some(s => s.red >= 0.8 && s.kind <= 0.2),
    'SC9: an unexplained glow swaps between its kind color and red', JSON.stringify(cycle));
  const brightest = cycle.map(s => Math.max(s.kind, s.red));
  assert(Math.max(...brightest) >= 0.8 && Math.min(...brightest) <= 0.4, 'SC9: an unexplained glow dips between its colour swaps, matching the graph', JSON.stringify(brightest));

  const calm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await calm.route('**/events', route => route.abort());
  await calm.goto(`http://localhost:${PORT}/#view=flow&dfd=order-to-cash`, { waitUntil: 'load' });
  await calm.waitForSelector(`g[data-token="${procToken}"] .flow-glow`, { timeout: 20_000 });
  const steady = await glowSamples(calm, procToken, 2);
  assert(steady.length === 2 && steady.every(f => f.length === 2 && f.every(o => o > 0) && f.join() === steady[0]?.join()),
    'SC9: reduced motion holds both glow layers steady', JSON.stringify(steady));
  await calm.close();

  await page.evaluate(() => {
    window.__IGNATIUS_FLOW_READY__ = false;
    location.hash = '#view=flow&dfd=order-to-cash&flowview=connected&collapse=stores';
  });
  await page.waitForFunction((token) => window.__IGNATIUS_FLOW_READY__ === true && document.querySelector(`g[data-token="${token}"]`) !== null,
    storeToken, { timeout: 20_000 });
  const storeMarks = await flowMarks();
  assert(storeMarks[storeToken]?.change === 'added' && storeMarks[storeToken]?.unexplained === null,
    'SC9: drawn on its own, the noted new store is highlighted added and explained', JSON.stringify(storeMarks));

  await showDiagram('refund');
  const refundMarks = await flowMarks();
  assert(Object.keys(refundMarks).length === 0, 'SC9: another diagram carries no highlight', JSON.stringify(refundMarks));

  await showDiagram('order-to-cash');
  const overlay = page.getByRole('checkbox', { name: 'Highlight changes' });
  await overlay.uncheck();
  await page.waitForFunction(() => document.querySelector('[data-ignatius="flow-svg"] g[data-change]') === null, null, { timeout: 5_000 })
    .catch(() => {});
  const flowHidden = await flowMarks();
  assert(Object.keys(flowHidden).length === 0, 'overlay off removes Flow highlights in place', JSON.stringify(flowHidden));
  await showDict();
  const dictHidden = await page.evaluate(() => document.querySelectorAll('.change-badge, .change-row, .dict-removed-section').length);
  assert(dictHidden === 0, 'overlay off removes Dictionary markers and the Removed section', String(dictHidden));
  await overlay.check();
  await showDiagram('order-to-cash');
  const flowRestored = await flowMarks();
  assert(flowRestored[procToken]?.change === 'changed', 'overlay on restores Flow highlights', JSON.stringify(flowRestored));

  const flowDown = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await flowDown.route('**/events', route => route.abort());
  await flowDown.route('**/api/flow', route => route.fulfill({ status: 500, body: 'flow broke' }));
  await flowDown.goto(`http://localhost:${PORT}/#view=dict`, { waitUntil: 'load' });
  const survived = await flowDown.waitForSelector('#entity-Person .change-badge', { timeout: 10_000 }).then(() => true, () => false);
  assert(survived, 'a failing /api/flow still boots the model and its change review');
  await flowDown.close();
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
console.log('\nAll change-review dict and flow checks passed.');
process.exit(0);
