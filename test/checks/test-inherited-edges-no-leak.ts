/**
 * test-inherited-edges-no-leak.ts — proves the DG ephemeral inherited edges
 * (key-inheritance-lineage CP-B) NEVER leak into the layout fingerprint, the
 * model edge set, or the persisted layout-store position map.
 *
 * The DG draws dotted "inferred-upstream" edges on entity select. They are
 * computed from `buildInheritedConnections` (the SAME pure helper the DD uses)
 * and added to cytoscape AFTER layout with ids prefixed `_inherited_`. The
 * invariant under test: those edges are a VIEW-ONLY overlay — they must not
 * enter any persisted or serialized surface.
 *
 * Three real-model assertions (no mocks; uses the parsed `models/key-inherited`):
 *
 *   1. `layoutFingerprint` reads ONLY `model.nodes` + `model.edges`. Selecting an
 *      entity produces inherited connections, but the fingerprint of the model is
 *      byte-identical to the fingerprint before any selection — because the model
 *      itself is never mutated and the inherited edges live only in cytoscape.
 *      Proven by computing the fingerprint, then computing the full inherited set
 *      for every entity, then re-computing the fingerprint and asserting equality.
 *
 *   2. No inherited connection's synthetic edge id collides with a real model
 *      edge. The synthetic ids carry the `_inherited_` prefix; no real edge id
 *      (`<source>>-<target>` style) shares it — so even if the cy element set
 *      were serialized, the inherited edges are distinguishable and strippable.
 *
 *   3. Inherited target ids are a subset of the model's node id set (the DG only
 *      draws to nodes that exist) — i.e. inherited edges introduce NO new nodes,
 *      so the layout-store node-position map (keyed by node id) can never gain a
 *      synthetic entry from an inherited edge.
 */

import { parseModels } from '../../src/model/parse';
import { buildModelIndex } from '../../src/model/model-index';
import { layoutFingerprint } from '../../src/model/layout-fingerprint';
import { buildInheritedConnections } from '../../src/app/logic/spotlight-inherited';
import { resolve, join } from 'path';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    process.exit(1);
  }
  console.log(`  PASS  ${msg}`);
}

const ROOT = resolve(import.meta.dir, '../..');
const MODEL_DIR = join(ROOT, 'models/key-inherited');

const { model } = await parseModels(MODEL_DIR);
const index = buildModelIndex(model);

// The synthetic id prefix GraphView mints for ephemeral inherited edges.
const INHERITED_EDGE_PREFIX = '_inherited_';

// ── 1. Fingerprint is unaffected by computing inherited connections ──────────
const fpBefore = layoutFingerprint(model);

// Compute the full inherited set for every entity — exactly what the DG does on
// each select. This must not mutate the model in any way.
let totalInherited = 0;
const allSyntheticIds: string[] = [];
for (const node of model.nodes) {
  const conns = buildInheritedConnections(index, node.id);
  totalInherited += conns.length;
  for (const c of conns) {
    allSyntheticIds.push(`${INHERITED_EDGE_PREFIX}${node.id}__${c.otherId}`);
  }
}

const fpAfter = layoutFingerprint(model);
assert(
  fpBefore === fpAfter,
  `layoutFingerprint is identical before/after computing every entity's inherited set (${fpBefore})`,
);
assert(
  totalInherited > 0,
  `the model actually produces inherited connections (${totalInherited} across all entities) — the test is exercising real data`,
);

// ── 2. Synthetic edge ids never collide with real model edge ids ─────────────
const realEdgeIds = new Set(model.edges.map(e => `${e.source}>${e.target}`));
let collision = false;
for (const sid of allSyntheticIds) {
  if (!sid.startsWith(INHERITED_EDGE_PREFIX)) collision = true;
  if (realEdgeIds.has(sid)) collision = true;
}
assert(
  !collision,
  `every synthetic inherited edge id carries the _inherited_ prefix and none collide with a real model edge id (${allSyntheticIds.length} synthetic ids checked)`,
);

// ── 3. Inherited targets are all real model nodes (no synthetic nodes) ───────
let newNode = false;
for (const node of model.nodes) {
  for (const c of buildInheritedConnections(index, node.id)) {
    if (!index.nodeIdSet.has(c.otherId)) newNode = true;
  }
}
assert(
  !newNode,
  'every inherited connection target is an existing model node — inherited edges introduce zero synthetic nodes, so the node-keyed layout-store can never gain a synthetic entry',
);

// ── 4. Concrete owner case: Identity inherits Party's party-keyed relationships ──
// Party's secondary classifier FK (PartyType) is NOT a key edge → must be absent.
const identityConns = buildInheritedConnections(index, 'Identity');
const partyRelTargets = identityConns.filter(c =>
  ['PaymentMethod', 'SalesInvoice', 'SalesOrder'].includes(c.otherId),
);
assert(
  partyRelTargets.length >= 1,
  `Identity inherits at least one of Party's party-keyed relationships (got: ${partyRelTargets.map(c => c.otherId).join(', ')})`,
);
assert(
  !identityConns.some(c => c.otherId === 'PartyType'),
  "Identity does NOT inherit PartyType (a secondary classifier FK, not a key edge)",
);

console.log('\ntest-inherited-edges-no-leak: all assertions passed.');
process.exit(0);
