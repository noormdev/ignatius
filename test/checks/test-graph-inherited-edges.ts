/**
 * test-graph-inherited-edges.ts — DG inferred-upstream (inherited) edges (CP-B).
 *
 * Serves models/key-inherited and drives the real cytoscape graph in a browser:
 *
 *   1. Select Identity (shares party_id key-lineage with Party) → dotted
 *      `edge.inherited` edges appear, connecting Identity to Party's party-keyed
 *      relationships (PaymentMethod / SalesInvoice / SalesOrder) and key-lineage
 *      kin, and those target nodes are NOT faded. (PartyType is a secondary
 *      classifier FK, not a key edge → never drawn.)
 *   2. Select ITIN (also party_id key-lineage) → the TRANSITIVE set appears: more
 *      inherited edges than Identity alone, reaching the whole party-keyed family
 *      via the ITIN → Identity → Party key chain.
 *   3. Background-tap deselect → every `edge.inherited` is removed (count 0).
 *
 * Drives selection by emitting the cytoscape 'tap' event on the node — the same
 * event GraphView's `cy.on('tap','node',...)` handler binds to. Reads element
 * state straight off `window.__IGNATIUS_CY__`.
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

// Emit a cy 'tap' on a node id and return the resulting inherited-edge state.
async function selectAndReport(id: string) {
  return await page.evaluate((nodeId: string) => {
    const cy = window.__IGNATIUS_CY__;
    if (!cy) return { ok: false, edges: [] as Array<{ source: string; target: string; faded: boolean }> };
    const node = cy.$(`#${nodeId}`);
    if (node.empty()) return { ok: false, edges: [] as Array<{ source: string; target: string; faded: boolean }> };
    node.emit('tap');
    const edges = cy.edges('.inherited').map((e: { source(): { id(): string }; target(): { id(): string } }) => ({
      source: e.source().id(),
      target: e.target().id(),
      // A target node is "lit" when it does NOT carry the .faded class.
      faded: cy.$(`#${e.target().id()}`).hasClass('faded'),
    }));
    return { ok: true, edges };
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

  // Pre-condition: no inherited edges before any selection.
  assert((await inheritedCount()) === 0, 'no inherited edges before any selection');

  // ── 1. Select Identity ──────────────────────────────────────────────────
  const identity = await selectAndReport('Identity');
  assert(identity.ok, 'Identity node exists in the graph');

  const identityTargets = identity.edges.map(e => e.target);
  console.log(`        Identity inherited edges (${identity.edges.length}): ${identityTargets.join(', ')}`);
  assert(identity.edges.length >= 1, `Identity draws ≥1 inherited edge (got ${identity.edges.length})`);

  // Every inherited edge must originate from Identity (selected node).
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

  // The inherited target nodes are kept lit (no .faded after a fresh select — fade
  // only applies on hover; at rest none are faded).
  assert(
    identity.edges.every(e => !e.faded),
    'Identity inherited target nodes are lit (not faded)',
  );

  const identityEdgeCount = identity.edges.length;

  // ── 2. Select ITIN (transitive via ITIN → Identity → Party) ───────────────
  const itin = await selectAndReport('ITIN');
  assert(itin.ok, 'ITIN node exists in the graph');

  const itinTargets = itin.edges.map(e => e.target);
  console.log(`        ITIN inherited edges (${itin.edges.length}): ${itinTargets.join(', ')}`);

  // Reselect must replace, not accumulate: every edge now originates from ITIN.
  assert(
    itin.edges.every(e => e.source === 'ITIN'),
    'after reselect, every inherited edge originates from ITIN (prior Identity set was cleared)',
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

  // ── 3. Background-tap deselect → all inherited edges removed ───────────────
  // Emitting 'tap' on the cy core fires the background-tap handler with
  // evt.target === cy (the deselect branch).
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
