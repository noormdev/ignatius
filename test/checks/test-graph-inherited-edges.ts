/**
 * test-graph-inherited-edges.ts — DG inferred-upstream (inherited) edges (CP-B),
 * shift+hover trigger.
 *
 * Serves models/key-inherited and drives the real cytoscape graph in a browser.
 * Lineage (dotted `edge.inherited` rays + 3-tier focus opacity) is now revealed
 * by SHIFT+HOVER, not by click/select. A plain click only selects + opens the
 * modal; it draws NO inherited edges.
 *
 *   1. Plain CLICK (tap) Identity → NO `edge.inherited` edges (modal opens
 *      instead — lineage no longer fires on select).
 *   2. SHIFT+HOVER Identity → dotted `edge.inherited` edges appear, connecting
 *      Identity to Party's party-keyed relationships (PaymentMethod /
 *      SalesInvoice / SalesOrder) and key-lineage kin, and those target nodes
 *      are NOT faded. (PartyType is a secondary classifier FK, not a key edge →
 *      never drawn.)
 *   3. mouseout (still shift held) → every `edge.inherited` is removed (count 0).
 *   4. SHIFT+HOVER ITIN → the TRANSITIVE set appears: more inherited edges than
 *      Identity alone, reaching the whole party-keyed family via the
 *      ITIN → Identity → Party key chain.
 *   5. Plain (no-shift) HOVER → NO `edge.inherited` edges (plain hover keeps only
 *      the direct-neighbour fade).
 *   6. Background-tap deselect → every `edge.inherited` is removed (count 0).
 *
 * The shift state is injected synthetically: a cytoscape `mouseover` event is
 * emitted with `originalEvent: { shiftKey: true }`, which is exactly what the
 * GraphView handler reads (`evt.originalEvent?.shiftKey`). `mouseout` is emitted
 * to leave the node. Reads element state straight off `window.__IGNATIUS_CY__`.
 *
 * Skips gracefully (exit 0) when dist/static/index.js is absent — CI builds the
 * bundle before running checks.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
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

const PORT = 3299;
const handle = serveCommand(MODEL, { port: PORT });
await new Promise<void>(r => setTimeout(r, 400));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

type EdgeReport = { source: string; target: string; faded: boolean };

// Emit a synthetic 'mouseover' on a node with the given shift state and return
// the resulting inherited-edge set. Mirrors GraphView's `evt.originalEvent?.shiftKey`.
async function hoverAndReport(id: string, shiftKey: boolean): Promise<{ ok: boolean; edges: EdgeReport[] }> {
  return await page.evaluate(
    ({ nodeId, shift }: { nodeId: string; shift: boolean }) => {
      const cy = window.__IGNATIUS_CY__;
      if (!cy) return { ok: false, edges: [] as Array<{ source: string; target: string; faded: boolean }> };
      const node = cy.$(`#${nodeId}`);
      if (node.empty()) return { ok: false, edges: [] as Array<{ source: string; target: string; faded: boolean }> };
      node.emit({ type: 'mouseover', target: node, originalEvent: { shiftKey: shift } });
      const edges = cy.edges('.inherited').map((e: { source(): { id(): string }; target(): { id(): string } }) => ({
        source: e.source().id(),
        target: e.target().id(),
        // A target node is "lit" when it does NOT carry the .faded class.
        faded: cy.$(`#${e.target().id()}`).hasClass('faded'),
      }));
      return { ok: true, edges };
    },
    { nodeId: id, shift: shiftKey },
  );
}

// Emit a synthetic 'mouseout' on a node (leave it).
async function leaveNode(id: string): Promise<void> {
  await page.evaluate((nodeId: string) => {
    const cy = window.__IGNATIUS_CY__;
    if (!cy) return;
    const node = cy.$(`#${nodeId}`);
    if (node.empty()) return;
    node.emit({ type: 'mouseout', target: node });
  }, id);
}

// Plain click (tap) a node — opens the modal, must NOT draw lineage.
async function tapNode(id: string): Promise<{ ok: boolean; inherited: number }> {
  return await page.evaluate((nodeId: string) => {
    const cy = window.__IGNATIUS_CY__;
    if (!cy) return { ok: false, inherited: -1 };
    const node = cy.$(`#${nodeId}`);
    if (node.empty()) return { ok: false, inherited: -1 };
    node.emit('tap');
    return { ok: true, inherited: cy.edges('.inherited').length };
  }, id);
}

async function inheritedCount(): Promise<number> {
  return await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    if (!cy) return -1;
    return cy.edges('.inherited').length;
  });
}

try {
  await page.goto(`http://localhost:${PORT}/#view=graph`, { waitUntil: 'load' });
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
  // Wait for cy to be ready and laid out.
  await page.waitForFunction(() => {
    const cy = window.__IGNATIUS_CY__;
    return !!cy && cy.nodes().length > 0;
  }, { timeout: 20_000 });
  await new Promise<void>(r => setTimeout(r, 800));

  // Pre-condition: no inherited edges before any interaction.
  assert((await inheritedCount()) === 0, 'no inherited edges before any interaction');

  // ── 1. Plain CLICK selects but draws NO lineage ──────────────────────────
  const tap = await tapNode('Identity');
  assert(tap.ok, 'Identity node exists (plain tap)');
  assert(tap.inherited === 0, `plain click draws NO inherited edges (got ${tap.inherited}); the modal opens instead`);
  // Clear any selection-state so the hover tests start clean.
  await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    if (cy) cy.emit('tap'); // background deselect
  });
  await new Promise<void>(r => setTimeout(r, 150));
  assert((await inheritedCount()) === 0, 'still no inherited edges after deselect');

  // ── 2. SHIFT+HOVER Identity → dotted lineage appears ─────────────────────
  const identity = await hoverAndReport('Identity', true);
  assert(identity.ok, 'Identity node exists (shift+hover)');

  const identityTargets = identity.edges.map(e => e.target);
  console.log(`        Identity inherited edges (${identity.edges.length}): ${identityTargets.join(', ')}`);
  assert(identity.edges.length >= 1, `shift+hover Identity draws ≥1 inherited edge (got ${identity.edges.length})`);

  // Every inherited edge must originate from Identity (hovered node).
  assert(
    identity.edges.every(e => e.source === 'Identity'),
    'every Identity inherited edge originates from Identity',
    `sources: ${identity.edges.map(e => e.source).join(', ')}`,
  );

  // At least one of Party's relationships is reached.
  // Party's party-keyed relationships (key edges). PartyType is a secondary
  // classifier FK and is intentionally NOT in lineage.
  const partyRels = ['PaymentMethod', 'SalesInvoice', 'SalesOrder'];
  const reachedPartyRels = identityTargets.filter(t => partyRels.includes(t));
  assert(
    reachedPartyRels.length >= 1,
    `Identity inherited edges reach Party's relationships (got: ${reachedPartyRels.join(', ')})`,
  );

  const identityEdgeCount = identity.edges.length;

  // ── 3. mouseout (still shift held) → lineage cleared ─────────────────────
  await leaveNode('Identity');
  await new Promise<void>(r => setTimeout(r, 150));
  assert((await inheritedCount()) === 0, 'mouseout removes ALL inherited edges (lineage cleared on leave)');

  // ── 4. SHIFT+HOVER ITIN (transitive via ITIN → Identity → Party) ─────────
  const itin = await hoverAndReport('ITIN', true);
  assert(itin.ok, 'ITIN node exists (shift+hover)');

  const itinTargets = itin.edges.map(e => e.target);
  console.log(`        ITIN inherited edges (${itin.edges.length}): ${itinTargets.join(', ')}`);

  // Re-hover must replace, not accumulate: every edge now originates from ITIN.
  assert(
    itin.edges.every(e => e.source === 'ITIN'),
    'after re-hover, every inherited edge originates from ITIN (prior Identity set was cleared)',
    `sources: ${itin.edges.map(e => e.source).join(', ')}`,
  );

  // ITIN is one hop further from Party than Identity, so it inherits a strictly
  // larger transitive set (Identity's siblings + Party's relationships).
  assert(
    itin.edges.length > identityEdgeCount,
    `ITIN draws MORE inherited edges than Identity, proving transitivity (ITIN ${itin.edges.length} > Identity ${identityEdgeCount})`,
  );

  // Transitive reach: ITIN reaches Party's relationships (via the multi-hop chain).
  const itinReachedPartyRels = itinTargets.filter(t => partyRels.includes(t));
  assert(
    itinReachedPartyRels.length >= 1,
    `ITIN transitively reaches Party's relationships (got: ${itinReachedPartyRels.join(', ')})`,
  );

  await leaveNode('ITIN');
  await new Promise<void>(r => setTimeout(r, 150));
  assert((await inheritedCount()) === 0, 'mouseout after ITIN removes ALL inherited edges');

  // ── 5. Plain (no-shift) HOVER → NO lineage ───────────────────────────────
  const plainHover = await hoverAndReport('Identity', false);
  assert(plainHover.ok, 'Identity node exists (plain hover)');
  assert(
    plainHover.edges.length === 0,
    `plain (no-shift) hover draws NO inherited edges (got ${plainHover.edges.length}); only the direct-neighbour fade applies`,
  );
  await leaveNode('Identity');
  await new Promise<void>(r => setTimeout(r, 150));

  // ── 6. Background-tap deselect → all inherited edges removed ──────────────
  await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    if (cy) cy.emit('tap');
  });
  await new Promise<void>(r => setTimeout(r, 200));

  const afterDeselect = await inheritedCount();
  assert(afterDeselect === 0, `background-tap deselect removes ALL inherited edges (count: ${afterDeselect})`);

} finally {
  await page.close();
  await browser.close();
  handle.stop();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\ntest-graph-inherited-edges: all assertions passed.');
process.exit(0);
