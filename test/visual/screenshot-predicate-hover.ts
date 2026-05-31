/**
 * Visual verification: bidirectional predicate hover swap.
 *
 * Captures two screenshots for orchestrator review and asserts the data-level
 * swap deterministically (exits non-zero if the swap does not happen):
 *   - tmp/predicate-before.png — default: edge labels show the forward (parent->child) predicate
 *   - tmp/predicate-after.png  — hovering a child entity flips its incident
 *                                child-end edges to the reverse (child->parent) predicate
 *
 * Drives hover by emitting Cytoscape's 'mouseover' on the target node via the
 * window.__IGNATIUS_CY__ debug seam, then reads edge `edgeLabel` data before /
 * after / restored. NOT run by `bun run test` (visual/ is manual review).
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models', 'key-inherited');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const PORT = 3293;

// Minimal structural shape of the Cytoscape edges we read inside page.evaluate.
// The project's `cytoscape` namespace types are unresolved, so we annotate the
// few members we touch locally rather than pull in `any`.
interface CyEdge {
  id(): string;
  data(key: string): unknown;
  target(): { id(): string };
}

const handle = serveCommand(MODELS, { port: PORT });
await Bun.sleep(400);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let ok = true;
const note = (m: string) => console.log(m);
const fail = (m: string) => { console.error('FAIL:', m); ok = false; };

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
  await page.waitForTimeout(2500);

  // Pick a target child node: the child end of a real predicate edge whose
  // fwd and rev differ, and focus the viewport on it + its neighbours.
  const target = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    if (!cy) return null;
    const edge = cy.edges().filter((e: CyEdge) =>
      e.data('predicateRev') !== undefined &&
      e.data('predicateRev') !== e.data('predicateFwd'))[0];
    if (!edge || edge.length === 0) return null;
    const childNode = edge.target(); // Cytoscape target = child (model source)
    const id = childNode.id();
    cy.fit(childNode.closedNeighborhood(), 70);
    const before = childNode.connectedEdges().map((e: CyEdge) => ({
      id: e.id(),
      isChildEnd: e.target().id() === id,
      label: e.data('edgeLabel'),
      fwd: e.data('predicateFwd'),
      rev: e.data('predicateRev'),
    }));
    return { id, before };
  });

  if (!target) { fail('Cytoscape instance or a fwd!=rev edge not found'); process.exit(1); }
  note(`Target child node: ${target.id}`);

  await page.waitForTimeout(500);
  await page.screenshot({ path: join(TMP, 'predicate-before.png') });
  note('Saved tmp/predicate-before.png (forward labels)');

  // Hover: emit mouseover on the node — fires the delegated cy.on handler.
  const after = await page.evaluate((id: string) => {
    const cy = window.__IGNATIUS_CY__!;
    const node = cy.$id(id);
    node.emit('mouseover');
    return node.connectedEdges().map((e: CyEdge) => ({ id: e.id(), label: e.data('edgeLabel') }));
  }, target.id);

  await page.waitForTimeout(500);
  await page.screenshot({ path: join(TMP, 'predicate-after.png') });
  note('Saved tmp/predicate-after.png (reverse labels on child-end edges)');

  const restored = await page.evaluate((id: string) => {
    const cy = window.__IGNATIUS_CY__!;
    const node = cy.$id(id);
    node.emit('mouseout');
    return node.connectedEdges().map((e: CyEdge) => ({ id: e.id(), label: e.data('edgeLabel') }));
  }, target.id);

  // Assertions ---------------------------------------------------------------
  const afterById = new Map(after.map(e => [e.id, e.label]));
  const restoredById = new Map(restored.map(e => [e.id, e.label]));

  const childEdges = target.before.filter(e => e.isChildEnd && e.rev !== e.fwd);
  if (childEdges.length === 0) fail('target node has no child-end edge with fwd!=rev');

  let swaps = 0;
  for (const e of target.before) {
    // Cluster/joiner edges carry no real predicate (fwd undefined); the handler
    // leaves them untouched — skip them in the assertion.
    if (e.fwd === undefined) continue;
    const af = afterById.get(e.id);
    const rs = restoredById.get(e.id);
    const hasArrow = (s: unknown) => typeof s === 'string' && (s.includes('→') || s.includes('←'));
    const containsVerb = (s: unknown, verb: string) => typeof s === 'string' && s.includes(verb);
    if (e.isChildEnd && e.rev !== e.fwd) {
      // default must show fwd verb + arrow; hover must show rev verb + arrow
      if (!containsVerb(e.label, e.fwd) || !hasArrow(e.label)) fail(`edge ${e.id} default "${e.label}" missing fwd "${e.fwd}" or arrow`);
      if (!containsVerb(af, e.rev) || !hasArrow(af)) fail(`edge ${e.id} hover "${af}" missing rev "${e.rev}" or arrow`);
      else { note(`  swap OK: "${e.label}" -> "${af}" (edge ${e.id})`); swaps++; }
    } else {
      // parent-end edges keep fwd on hover
      if (af !== e.label) fail(`parent-end edge ${e.id} changed on hover: "${e.label}" -> "${af}"`);
    }
    if (!containsVerb(rs, e.fwd) || !hasArrow(rs)) fail(`edge ${e.id} did not restore to fwd "${e.fwd}" (got "${rs}") on mouseout`);
  }

  if (swaps === 0) fail('no fwd->rev swap observed');
  else note(`${swaps} child-end edge label(s) swapped on hover and restored on mouseout`);

} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  handle.stop();
}

if (!ok) { console.error('\nVisual hover verification FAILED.'); process.exit(1); }
console.log('\nVisual hover verification passed.');
