// docs/spec/model-change-review.md SC7 and SC10 on a temp copy of models/key-inherited: Person gains a
// noted column; PaymentAllocation is deleted and a sub-DFD process body edited, both unexplained.

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { serveCommand } from '../../src/server/server';
import type { ChangeReview } from '../../src/model/change-review';
import { CHANGE_COLORS } from '../../src/app/dom/theme-css-vars';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const PORT = 3331;

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const WATCHDOG_MS = 150_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-change-review-graph.ts exceeded its ${WATCHDOG_MS}ms watchdog — a wait blocked indefinitely`);
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

type Box = { x: number; y: number; width: number; height: number };

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

const root = mkdtempSync(join(tmpdir(), 'ignatius-change-graph-'));
const dir = join(root, 'model');
// Other checks serve models/key-inherited in place and leave .ignatius/ behind.
const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });

async function fetchModel(): Promise<{ diff: ChangeReview | null; layoutKey: string }> {
  const res = await fetch(`http://localhost:${PORT}/api/model`, { signal: AbortSignal.timeout(10_000) });
  return res.json();
}

const handle = serveCommand(dir, { port: PORT });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30_000);
page.setDefaultNavigationTimeout(30_000);
// fs.watch reports file events here late and unprompted; each report refetches the model and
// rebuilds the graph mid-step, so SSE stays off until the Approve step.
let sseBlocked = true;
await page.route('**/events', route => (sseBlocked ? route.abort() : route.continue()));

async function selectedIs(id: string): Promise<void> {
  await page.waitForFunction((target) => {
    const picked = window.__IGNATIUS_CY__!.nodes(':selected');
    return picked.length === 1 && picked[0].id() === target;
  }, id, { timeout: 5_000 }).catch(() => undefined);
}

async function overlayApplied(on: boolean): Promise<void> {
  await page.waitForFunction((want) => {
    const cy = window.__IGNATIUS_CY__!;
    return (cy.$id('PaymentAllocation').nonempty() && cy.$id('Person').data('change') === 'changed') === want;
  }, on, { timeout: 5_000 }).catch(() => undefined);
}

async function ghostPlacement(): Promise<{ x: number; y: number; overlaps: string[] }> {
  return page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    const ghost = cy.$id('PaymentAllocation');
    const a = ghost.boundingBox();
    const overlaps = cy.nodes('[classification]').not(ghost).filter((n) => {
      const b = n.boundingBox();
      return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
    }).map(n => n.id());
    return { ...ghost.position(), overlaps };
  });
}

type GlowFrame = {
  person: { alpha: number; color: string } | null;
  ghost: { alpha: number; color: string } | null;
  personOutline: number;
  personUnderlay: number;
  personHalo: number;
  paymentHalo: number;
  cores: number[];
  light: boolean;
  removedEdgeOpacity: number;
};

async function glowSample(target: Page): Promise<GlowFrame> {
  return target.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-ignatius="change-glow"]');
    // Glow-canvas alpha at `dx` from the node's centre.
    const alphaAt = (id: string, dx: number): number => {
      const node = cy.$id(id);
      if (!canvas || node.empty()) return 0;
      const scale = canvas.width / canvas.clientWidth;
      const x = node.renderedPosition('x') + dx;
      const y = node.renderedPosition('y');
      return canvas.getContext('2d')!.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data[3]!;
    };
    // A few pixels left of the node's edge, where only the blur reaches.
    const halo = (id: string): number => alphaAt(id, -cy.$id(id).renderedOuterWidth() / 2 - 3);
    const drawn = window.__IGNATIUS_GLOW__ ?? {};
    const person = cy.$id('Person');
    const ghost = cy.$id('PaymentAllocation');
    return {
      person: drawn['Person'] ?? null,
      ghost: drawn['PaymentAllocation'] ?? null,
      personOutline: parseFloat(person.style('outline-width')),
      personUnderlay: Number(person.style('underlay-opacity')),
      personHalo: halo('Person'),
      paymentHalo: halo('Payment'),
      cores: [alphaAt('Person', 0), alphaAt('PaymentAllocation', 0)],
      light: document.documentElement.classList.contains('theme-light'),
      removedEdgeOpacity: Number(ghost.connectedEdges('[change = "removed"]').first().style('underlay-opacity')),
    };
  });
}

type BadgeSample = {
  badged: string[];
  ghostBadge: number;
  corner: { x: number; y: number };
  pixel: number[];
  above: boolean;
  pointerEvents: string;
};

// Reads the badge canvas at `corner`, or just below the ✕ crossing at the ghost's top-right corner when it is omitted.
async function badgeSample(target: Page, corner?: { x: number; y: number }): Promise<BadgeSample> {
  return target.evaluate((at) => {
    const cy = window.__IGNATIUS_CY__!;
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-ignatius="change-badge"]');
    const cyCanvas = document.querySelector('.graph-panel canvas[data-id]');
    const ghost = cy.$id('PaymentAllocation');
    const point = at ?? {
      x: ghost.renderedPosition('x') + ghost.renderedOuterWidth() / 2,
      y: ghost.renderedPosition('y') - ghost.renderedOuterHeight() / 2 + 4,
    };
    const scale = canvas ? canvas.width / canvas.clientWidth : 1;
    const pixel = canvas ? [...canvas.getContext('2d')!.getImageData(Math.round(point.x * scale), Math.round(point.y * scale), 1, 1).data] : [];
    const drawn = window.__IGNATIUS_GLOW__ ?? {};
    return {
      badged: Object.keys(drawn).filter(id => (drawn[id]?.badge ?? 0) > 0),
      ghostBadge: drawn['PaymentAllocation']?.badge ?? 0,
      corner: point,
      pixel,
      above: canvas !== null && cyCanvas !== null && (canvas.compareDocumentPosition(cyCanvas) & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
      pointerEvents: canvas ? getComputedStyle(canvas).pointerEvents : '',
    };
  }, corner);
}

async function glowSamples(target: Page, count: number): Promise<[GlowFrame, ...GlowFrame[]]> {
  const first = await glowSample(target);
  const rest: GlowFrame[] = [];
  for (let i = 1; i < count; i++) {
    await target.waitForTimeout(600);
    rest.push(await glowSample(target));
  }
  return [first, ...rest];
}

// Waits out the view switch and the layout, then checks the result held: nothing re-fit or deselected afterwards.
async function ghostSelectedAndCentered(): Promise<{ selected: boolean; centered: boolean; offset?: { dx: number; dy: number } }> {
  await page.waitForFunction(() => {
    const cy = window.__IGNATIUS_CY__;
    return cy !== undefined && !cy.destroyed() && cy.$id('PaymentAllocation').selected();
  }, null, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    const ghost = cy.$id('PaymentAllocation');
    if (ghost.empty()) return { selected: false, centered: false };
    const p = ghost.renderedPosition();
    const offset = { dx: p.x - cy.width() / 2, dy: p.y - cy.height() / 2 };
    return { selected: ghost.selected(), centered: Math.abs(offset.dx) < 2 && Math.abs(offset.dy) < 2, offset };
  });
}

try {
  const baselinePath = join(dir, '.ignatius/baseline.json');
  const deadline = Date.now() + 10_000;
  while (!existsSync(baselinePath) && Date.now() < deadline) await sleep(50);
  assert(existsSync(baselinePath), 'serve wrote the baseline before the edits');

  // Lay the baseline out first so PaymentAllocation has a saved position for its ghost to return to.
  await page.goto(`http://localhost:${PORT}/#view=graph`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('ignatius-layout-positions');
    const store: Record<string, { positions: Record<string, unknown> }> = raw ? JSON.parse(raw) : {};
    return Object.values(store).some(entry => 'PaymentAllocation' in entry.positions);
  }, null, { timeout: 30_000 });
  const lastSeen = await page.evaluate(() => window.__IGNATIUS_CY__!.$id('PaymentAllocation').position());

  const personFile = join(dir, 'data/identity/Person.md');
  writeFileSync(personFile, readFileSync(personFile, 'utf8').replace('  birthdate:\n', '  nickname:\n    type: text\n    desc: "Added."\n  birthdate:\n'));
  // The dangling link raises a finding, so the Findings panel renders beside the Changes panel.
  const businessFile = join(dir, 'data/identity/Business.md');
  writeFileSync(businessFile, `${readFileSync(businessFile, 'utf8')}\nSee [[Nobody]].\n`);
  unlinkSync(join(dir, 'data/transactional/PaymentAllocation.md'));
  const recordOrderFile = join(dir, 'flows/order-to-cash/Create-Sales-Order/Record-Order.md');
  writeFileSync(recordOrderFile, readFileSync(recordOrderFile, 'utf8').replace('Second step inside', 'The second step inside'));
  mkdirSync(join(dir, '.ignatius/changes'), { recursive: true });
  writeFileSync(join(dir, '.ignatius/changes/person-nickname.md'), [
    '---',
    'title: Give people a nickname',
    'entities:',
    // birthdate is unchanged, so the review carries a claim the item count leaves out.
    '  Person: [nickname, birthdate]',
    '---',
    '',
    'Support staff greet customers by nickname.',
    '',
  ].join('\n'));

  const { diff } = await fetchModel();
  assert(diff !== null && diff.removedNodes.some(n => n.id === 'PaymentAllocation'), 'fixture: diff lists PaymentAllocation as removed');
  const flowItem = diff?.items.find(item => item.scope === 'flow' && item.node !== undefined);
  const flowPath = flowItem?.scope === 'flow' ? flowItem.diagramPath : '';
  assert(flowPath.includes('/'), 'fixture: diff lists the sub-DFD process change', JSON.stringify(flowItem));

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
  await page.waitForSelector('.changes-panel', { timeout: 10_000 });
  await page.waitForFunction(() => window.__IGNATIUS_CY__?.$id('PaymentAllocation').nonempty() === true, null, { timeout: 30_000 });

  const marks = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    const ghost = cy.$id('PaymentAllocation');
    const ghostEdges = ghost.connectedEdges();
    return {
      person: cy.$id('Person').data('change'),
      personUnexplained: cy.$id('Person').data('unexplained'),
      ghost: ghost.data('change'),
      ghostUnexplained: ghost.data('unexplained'),
      ghostGroup: ghost.data('group'),
      ghostBorder: ghost.style('border-style'),
      removedEdgeTo: ghostEdges.filter(e => e.data('change') === 'removed').map(e => (e.source().id() === 'PaymentAllocation' ? e.target().id() : e.source().id())).sort(),
      payment: cy.$id('Payment').data('change'),
    };
  });
  assert(marks.person === 'changed', 'SC7: a column-only change marks Person changed', JSON.stringify(marks));
  assert(marks.personUnexplained === undefined, 'SC7: Person, covered by the note, is not flagged unexplained', JSON.stringify(marks));
  assert(marks.ghost === 'removed', 'SC7: PaymentAllocation renders as a ghost node with change=removed', JSON.stringify(marks));
  assert(marks.ghostUnexplained === 'true', 'SC7: the uncovered removal is flagged unexplained', JSON.stringify(marks));
  assert(marks.ghostGroup === 'transactional', 'SC7: the ghost keeps its group', JSON.stringify(marks));
  assert(marks.ghostBorder === 'dashed', 'SC7: the ghost has a dashed border', JSON.stringify(marks));
  assert(marks.removedEdgeTo.includes('Payment') && marks.removedEdgeTo.includes('SI_Line'), 'SC7: removed relationships render as dashed edges to Payment and SI_Line', JSON.stringify(marks));
  assert(marks.payment === undefined, 'SC7: an untouched entity carries no change data', JSON.stringify(marks));

  const glowLayer = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-ignatius="change-glow"]');
    const cyCanvas = document.querySelector('.graph-panel canvas[data-id]');
    return {
      present: canvas !== null,
      behind: canvas !== null && cyCanvas !== null && (canvas.compareDocumentPosition(cyCanvas) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      pointerEvents: canvas ? getComputedStyle(canvas).pointerEvents : '',
    };
  });
  assert(glowLayer.present && glowLayer.behind, 'SC7: node glows draw on a canvas behind cytoscape', JSON.stringify(glowLayer));
  assert(glowLayer.pointerEvents === 'none', 'SC7: the glow canvas takes no pointer events', JSON.stringify(glowLayer));

  const glowFrames = await glowSamples(page, 7);
  const [glow] = glowFrames;
  assert(glow.personOutline === 0 && glow.personUnderlay === 0, 'SC7: a changed node draws no outline or underlay frame', JSON.stringify(glow));
  assert(glow.person !== null && glow.person.alpha > 0 && glow.person.color === CHANGE_COLORS[glow.light ? 'light' : 'dark'].changed, 'SC7: the changed node glows amber', JSON.stringify(glow));
  assert(glow.personHalo > 0 && glow.paymentHalo === 0, 'SC7: the blur reaches past a marked node and not past an unmarked one', JSON.stringify(glow));
  assert(glow.cores.every(a => a === 0), 'SC7: no glow tint lands inside a marked node, translucent ghost included', JSON.stringify(glow));
  assert(glow.ghost !== null && glow.ghost.alpha > 0 && glow.removedEdgeOpacity > 0, 'SC7: the ghost node and its removed edges glow', JSON.stringify(glow));
  assert(new Set(glowFrames.map(f => f.person?.alpha)).size > 1, 'SC7: the glow pulses', JSON.stringify(glowFrames));
  assert(new Set(glowFrames.map(f => f.ghost?.color)).size > 1, 'SC7: an unexplained glow alternates its color', JSON.stringify(glowFrames));
  const glowFloor = Math.min(...glowFrames.map(f => f.person?.alpha ?? 0));
  assert(glowFloor >= 0.2, 'SC7: the pulse never fades the glow out', JSON.stringify(glowFrames));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const switchedFrames = await glowSamples(page, 2);
  assert(JSON.stringify(switchedFrames[0]) === JSON.stringify(switchedFrames[1]), 'SC7: turning on reduced motion while the graph is open holds the glow steady', JSON.stringify(switchedFrames));
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const search = page.getByPlaceholder('Search entities…');
  await search.fill('Payment');
  await page.waitForFunction(() => window.__IGNATIUS_CY__!.$id('Person').hasClass('search-dim'), null, { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(100);
  const dimmed = await glowSample(page);
  const dimmedAlpha = dimmed.person?.alpha ?? 0;
  assert(dimmedAlpha > 0 && dimmedAlpha <= glowFloor * 0.5, 'SC7: a search-dimmed node dims its glow with it', JSON.stringify({ dimmed, glowFloor }));
  await search.fill('');
  await page.waitForFunction(() => !window.__IGNATIUS_CY__!.$id('Person').hasClass('search-dim'), null, { timeout: 5_000 }).catch(() => undefined);

  const calm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await calm.route('**/events', route => route.abort());
  await calm.goto(`http://localhost:${PORT}/#view=graph`, { waitUntil: 'load' });
  await calm.waitForFunction(() => window.__IGNATIUS_CY__?.$id('PaymentAllocation').nonempty() === true && window.__IGNATIUS_GLOW__?.['Person'] !== undefined, null, { timeout: 30_000 });
  const calmFrames = await glowSamples(calm, 2);
  const [calmFirst] = calmFrames;
  assert((calmFirst.person?.alpha ?? 0) > 0 && (calmFirst.ghost?.alpha ?? 0) > 0 && calmFirst.personHalo > 0, 'SC7: reduced motion still draws the glow', JSON.stringify(calmFrames));
  assert(calmFrames.every(f => JSON.stringify(f) === JSON.stringify(calmFirst)), 'SC7: reduced motion holds the glow steady', JSON.stringify(calmFrames));
  const calmFaded = await calm.evaluate(async () => {
    window.__IGNATIUS_CY__!.$id('Person').addClass('faded');
    await new Promise(done => setTimeout(done, 100));
    return window.__IGNATIUS_GLOW__?.['Person']?.alpha ?? 0;
  });
  const calmAlpha = calmFirst.person?.alpha ?? 0;
  assert(calmFaded > 0 && calmFaded < calmAlpha * 0.5, 'SC7: a steady glow dims with a faded node', JSON.stringify({ calmFaded, calmAlpha }));
  const ghostBadges = await calm.evaluate(async () => {
    const full = window.__IGNATIUS_GLOW__?.['PaymentAllocation']?.badge ?? 0;
    window.__IGNATIUS_CY__!.$id('PaymentAllocation').addClass('faded');
    await new Promise(done => setTimeout(done, 100));
    return { full, faded: window.__IGNATIUS_GLOW__?.['PaymentAllocation']?.badge ?? 0 };
  });
  assert(ghostBadges.full === 1 && ghostBadges.faded > 0 && ghostBadges.faded < 0.5, 'SC7: the ghost badge is full strength and dims only with a focus tier', JSON.stringify(ghostBadges));
  const culled = await calm.evaluate(async () => {
    const cy = window.__IGNATIUS_CY__!;
    const person = cy.$id('Person').renderedPosition();
    cy.panBy({ x: -person.x - 2 * cy.width(), y: 0 });
    await new Promise(done => setTimeout(done, 100));
    return Object.keys(window.__IGNATIUS_GLOW__ ?? {});
  });
  assert(!culled.includes('Person'), 'SC7: a node panned out of view draws no glow', JSON.stringify(culled));
  await calm.close();

  const pulsing = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  await pulsing.route('**/events', route => route.abort());
  await pulsing.goto(`http://localhost:${PORT}/#view=graph`, { waitUntil: 'load' });
  await pulsing.waitForFunction(() => window.__IGNATIUS_GLOW__?.['Person'] !== undefined, null, { timeout: 30_000 });
  const personAlpha = () => pulsing.evaluate(() => window.__IGNATIUS_GLOW__?.['Person']?.alpha);
  const pulseBefore = await personAlpha();
  await pulsing.waitForTimeout(600);
  const pulseAfter = await personAlpha();
  assert(pulseBefore !== pulseAfter, 'SC7: the graph pulses before it is torn down', JSON.stringify({ pulseBefore, pulseAfter }));
  // A pulse frame left running after teardown either redraws the glow or throws on the destroyed graph.
  const errorsAfterLeaving: string[] = [];
  pulsing.on('pageerror', error => errorsAfterLeaving.push(error.message));
  await pulsing.evaluate(() => { location.hash = '#view=dict'; });
  await pulsing.waitForTimeout(600);
  const teardown = await pulsing.evaluate(() => ({
    canvases: document.querySelectorAll('canvas[data-ignatius^="change-"]').length,
    glow: window.__IGNATIUS_GLOW__,
  }));
  assert(teardown.canvases === 0 && teardown.glow === undefined && errorsAfterLeaving.length === 0,
    'SC7: leaving the graph removes the glow canvases and stops the pulse', JSON.stringify({ ...teardown, errorsAfterLeaving }));
  await pulsing.close();

  const placement = await ghostPlacement();
  assert(Math.hypot(placement.x - lastSeen.x, placement.y - lastSeen.y) <= 300, 'the ghost returns near its last saved position', JSON.stringify({ placement, lastSeen }));
  assert(placement.overlaps.length === 0, 'the ghost does not cover a real node', JSON.stringify(placement.overlaps));

  const panelText = await page.locator('.changes-panel').innerText();
  const notesText = await page.locator('.changes-panel-note').first().innerText();
  const unexplainedText = await page.locator('.changes-panel-section--unexplained').innerText();
  assert(notesText.includes('Give people a nickname') && notesText.includes('greet customers by nickname'), 'SC10: the note shows its title and body', notesText);
  assert(notesText.includes('Person.nickname — column added'), 'SC10: the note lists the item it covers', notesText);
  assert(unexplainedText.includes('PaymentAllocation — entity removed'), 'SC10: the removal is listed under unexplained', unexplainedText);
  assert(panelText.indexOf('Give people a nickname') < panelText.indexOf('PaymentAllocation — entity removed'), 'SC10: notes come before unexplained items');

  const changesBox = await page.locator('.changes-panel').boundingBox();
  const findingsBox = await page.locator('.findings-panel').boundingBox();
  assert(findingsBox !== null, 'fixture: the dangling link shows the Findings panel');
  assert(changesBox !== null && findingsBox !== null && !intersects(changesBox, findingsBox), 'SC10: Changes and Findings panels do not overlap',
    JSON.stringify({ changesBox, findingsBox }));

  const ghostItem = page.locator('.changes-panel-item', { hasText: 'PaymentAllocation — entity removed' });
  const removedRow = await ghostItem.evaluate(el => {
    const style = getComputedStyle(el);
    const icon = el.querySelector('.changes-panel-removed-icon');
    return {
      barStyle: style.borderLeftStyle,
      barColor: style.borderLeftColor,
      wordColor: getComputedStyle(el.querySelector('.changes-panel-removed') ?? el).color,
      icon: icon ? getComputedStyle(icon, '::before').content : null,
      iconFill: icon ? getComputedStyle(icon, '::before').backgroundColor : null,
      light: document.documentElement.classList.contains('theme-light'),
    };
  });
  const warningRed = 'rgb(220, 38, 38)';
  const warningText = removedRow.light ? warningRed : 'rgb(248, 113, 113)';
  assert(removedRow.barStyle === 'solid' && removedRow.barColor === warningRed && removedRow.wordColor === warningText,
    'SC10: a removed row has a solid red bar and a red "removed" readable on the theme', JSON.stringify(removedRow));
  assert(removedRow.icon === '"✕"' && removedRow.iconFill === warningRed, 'SC10: a removed row leads with the ghost badge\'s red ✕', JSON.stringify(removedRow));
  await ghostItem.click();
  await selectedIs('PaymentAllocation');
  let selected = await page.evaluate(() => window.__IGNATIUS_CY__!.nodes(':selected').map(n => n.id()));
  assert(selected.length === 1 && selected[0] === 'PaymentAllocation', 'SC10: clicking a removed-entity item selects its ghost', JSON.stringify(selected));

  await page.locator('.changes-panel-note .changes-panel-item', { hasText: 'Person.nickname' }).click();
  await selectedIs('Person');
  selected = await page.evaluate(() => window.__IGNATIUS_CY__!.nodes(':selected').map(n => n.id()));
  assert(selected.length === 1 && selected[0] === 'Person', 'SC10: clicking a column item selects its entity', JSON.stringify(selected));
  assert(await page.locator('.modal-backdrop').isVisible(), 'SC10: like a Findings row, a real entity item opens its modal');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 5_000 });

  await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    cy.$id('Person').emit('free');
    cy.$id('PaymentAllocation').emit('free');
  });
  const { layoutKey } = await fetchModel();
  await page.waitForFunction((key) => {
    const raw = localStorage.getItem('ignatius-layout-positions');
    const store: Record<string, { positions: Record<string, unknown> }> = raw ? JSON.parse(raw) : {};
    return store[key] !== undefined;
  }, layoutKey, { timeout: 5_000 }).catch(() => undefined);
  const savedIds = await page.evaluate((key) => {
    const raw = localStorage.getItem('ignatius-layout-positions');
    const store: Record<string, { positions: Record<string, unknown> }> = raw ? JSON.parse(raw) : {};
    return Object.keys(store[key]?.positions ?? {});
  }, layoutKey);
  assert(savedIds.includes('Person'), 'fixture: a drag release saves positions', JSON.stringify(savedIds.length));
  assert(!savedIds.includes('PaymentAllocation'), 'Risks: no ghost id enters the saved positions');

  const badge = await badgeSample(page);
  assert(badge.above && badge.pointerEvents === 'none', 'SC7: the ghost badge draws on a canvas above cytoscape that takes no pointer events', JSON.stringify(badge));
  assert(badge.badged.length === 1 && badge.badged[0] === 'PaymentAllocation', 'SC7: only the ghost carries a removed badge', JSON.stringify(badge));
  const [red = 0, green = 0, blue = 0, alpha = 0] = badge.pixel;
  assert(alpha === 255 && red > 180 && green < 120 && blue < 120, 'SC7: the ghost badge is opaque red at the top-right corner, unaffected by the ghost opacity', JSON.stringify(badge));

  const overlay = page.getByRole('checkbox', { name: 'Highlight changes' });
  await overlay.uncheck();
  await overlayApplied(false);
  const badgeOff = await badgeSample(page, badge.corner);
  assert(badgeOff.badged.length === 0 && (badgeOff.pixel[3] ?? 0) === 0, 'SC10: overlay off removes the ghost badge', JSON.stringify(badgeOff));
  const hidden = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    return { marked: cy.elements('[change], [unexplained]').length, ghost: cy.$id('PaymentAllocation').length };
  });
  assert(hidden.marked === 0 && hidden.ghost === 0, 'SC10: overlay off removes change data and ghosts', JSON.stringify(hidden));
  const offGlow: { lit: string[]; drawn: string[]; personHalo: number }[] = [];
  for (let i = 0; i < 2; i++) {
    if (i > 0) await page.waitForTimeout(600);
    offGlow.push(await page.evaluate(() => {
      const cy = window.__IGNATIUS_CY__!;
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-ignatius="change-glow"]');
      const person = cy.$id('Person');
      const scale = canvas ? canvas.width / canvas.clientWidth : 1;
      const x = person.renderedPosition('x') - person.renderedOuterWidth() / 2 - 3;
      const y = person.renderedPosition('y');
      return {
        lit: cy.elements().filter(el => Number(el.style('underlay-opacity')) > 0).map(el => el.id()),
        drawn: Object.keys(window.__IGNATIUS_GLOW__ ?? {}),
        personHalo: canvas?.getContext('2d')!.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data[3] ?? 0,
      };
    }));
  }
  assert(offGlow.every(f => f.lit.length === 0 && f.drawn.length === 0 && f.personHalo === 0), 'SC10: overlay off stops the pulse and leaves no glow', JSON.stringify(offGlow));

  await overlay.check();
  await overlayApplied(true);
  const restored = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    return { person: cy.$id('Person').data('change'), ghost: cy.$id('PaymentAllocation').data('change') };
  });
  assert(restored.person === 'changed' && restored.ghost === 'removed', 'SC10: overlay on restores change data and ghosts', JSON.stringify(restored));

  await overlay.uncheck();
  await overlayApplied(false);
  await ghostItem.click();
  await selectedIs('PaymentAllocation');
  selected = await page.evaluate(() => window.__IGNATIUS_CY__!.nodes(':selected').map(n => n.id()));
  assert(await overlay.isChecked() && selected.length === 1 && selected[0] === 'PaymentAllocation',
    'SC10: with the overlay off, a removed-entity item turns it back on and selects the ghost', JSON.stringify(selected));

  const headerCount = (await page.locator('.changes-panel-header h3').innerText()).match(/\d+/)?.[0];
  await page.locator('.changes-panel .side-panel-collapse').click();
  const badgeCount = (await page.locator('.changes-panel-badge').innerText()).match(/\d+/)?.[0];
  assert(headerCount !== undefined && headerCount === badgeCount, 'SC10: the header and the collapsed badge show the same count', JSON.stringify({ headerCount, badgeCount }));
  await page.locator('.changes-panel-badge').click();

  const flowRow = page.locator('.changes-panel-item', { hasText: 'Record Order — process' });
  const flowLabel = await flowRow.innerText();
  assert(flowLabel.startsWith('Order To Cash / Create Sales Order / Record Order — process changed'),
    'SC10: a flow item names its diagram by its title path, so same-id sub-DFDs stay apart', flowLabel);
  await flowRow.click();
  // The hash ref drops the context-diagram ancestors that diagramPath carries.
  const dfd = await page.waitForFunction((path) => {
    const params = new URLSearchParams(location.hash.slice(1));
    const ref = params.get('dfd');
    return params.get('view') === 'flow' && ref !== null && path.endsWith(`/${ref}`) ? ref : null;
  }, flowPath, { timeout: 10_000 }).then(found => found.jsonValue(), () => null);
  assert(dfd !== null && flowPath.endsWith(`/${dfd}`), 'SC10: clicking a flow item opens its diagram in the Flows view', JSON.stringify({ dfd, flowPath }));

  await ghostItem.click();
  let landed = await ghostSelectedAndCentered();
  assert(landed.selected && landed.centered, 'SC10: from the Flows view, a ghost item selects and centers the ghost (saved layout)', JSON.stringify(landed));

  await page.evaluate(() => localStorage.clear());
  await page.goto(`http://localhost:${PORT}/#view=dict`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.changes-panel', { timeout: 10_000 });
  await ghostItem.click();
  landed = await ghostSelectedAndCentered();
  assert(landed.selected && landed.centered, 'SC10: from the Dictionary view, a ghost item selects and centers the ghost (fresh layout)', JSON.stringify(landed));
  const neighbourPlacement = await ghostPlacement();
  assert(neighbourPlacement.overlaps.length === 0, 'a ghost placed by its neighbours does not cover a real node', JSON.stringify(neighbourPlacement.overlaps));

  sseBlocked = false;
  const sseConnected = page.waitForResponse('**/events', { timeout: 10_000 });
  await page.reload({ waitUntil: 'load' });
  await sseConnected;
  await page.waitForFunction(() => window.__IGNATIUS_PERF__ !== undefined, null, { timeout: 30_000 });
  await page.waitForSelector('.changes-panel', { timeout: 10_000 });

  const positionsBefore = await page.evaluate(() => window.__IGNATIUS_CY__!.nodes('[classification]').not('[change = "removed"]').map(n => ({ id: n.id(), ...n.position() })));
  // The click and the read share one task: the SSE refresh can unmount the panel before a later read.
  const pending = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('.changes-panel-approve');
    button?.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    return button ? { disabled: button.disabled, text: button.innerText } : null;
  });
  assert(pending?.disabled === true && pending.text === 'Approving…', 'SC10: Approve shows a pending state', JSON.stringify(pending));
  // Inside the panel's 5s refetch fallback, so only the SSE refresh can clear it in time.
  const sseCleared = await page.waitForSelector('.changes-panel', { state: 'detached', timeout: 4_000 }).then(() => true, () => false);
  assert(sseCleared, 'SC10: the SSE refresh clears the panel after Approve');
  await page.waitForSelector('.changes-panel', { state: 'detached', timeout: 15_000 });
  const afterApprove = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    return { marked: cy.elements('[change], [unexplained]').length, ghost: cy.$id('PaymentAllocation').length };
  });
  assert(afterApprove.marked === 0 && afterApprove.ghost === 0, 'SC10: Approve clears change data and ghosts', JSON.stringify(afterApprove));

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__IGNATIUS_PERF__ !== undefined, null, { timeout: 30_000 });
  const reloaded = await page.evaluate(() => Object.fromEntries(window.__IGNATIUS_CY__!.nodes('[classification]').map(n => [n.id(), n.position()])));
  const moved = positionsBefore.filter(p => {
    const now = reloaded[p.id];
    return !now || Math.abs(now.x - p.x) > 0.5 || Math.abs(now.y - p.y) > 0.5;
  });
  assert(moved.length === 0, 'Risks: the approved model reloads with real nodes where they were', JSON.stringify(moved.map(p => p.id)));

  writeFileSync(businessFile, readFileSync(businessFile, 'utf8').replace('See [[Nobody]].', 'See [[Person]].'));
  sseBlocked = true;
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.changes-panel', { timeout: 10_000 });
  await page.locator('.changes-panel-approve').click();
  const fallbackCleared = await page.waitForSelector('.changes-panel', { state: 'detached', timeout: 15_000 }).then(() => true, () => false);
  assert(fallbackCleared, 'SC10: without SSE, Approve clears the panel through its refetch fallback');
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
console.log('\nAll change-review graph checks passed.');
process.exit(0);
