/**
 * test-spotlight-inherited.ts — unit tests for buildInheritedConnections
 * (key-inheritance-lineage, corrected).
 *
 * CI assertion script (PASS/FAIL/exit-1 style).
 *
 * ── The contract (corrected) ────────────────────────────────────────────────
 *
 * Lineage follows ONLY KEY-INHERITANCE edges — an edge whose child-side FK
 * columns (the keys of `edge.on`) are ALL contained in the child's primary key
 * (FK ⊆ child PK, a SUBSET test). The lineage of an entity is the transitive
 * connected component over key edges in BOTH directions. Inherited connections =
 * the lineage members, minus the entity itself, minus its direct real-edge
 * neighbours (those render solid). A SECONDARY (non-key) FK is NEVER followed.
 *
 * These tests pin:
 *   T1  key FK target is in lineage; secondary FK target is NOT (the core fix).
 *   T2  identifying 1:many (FK ⊂ PK, proper subset) IS a key edge.
 *   T3  transitivity across a multi-hop key chain.
 *   T4  connected component — two entities sharing a key root reach each other.
 *   T5  direct real-edge neighbours are excluded from the dotted lineage set.
 *   T6  singleton lineage / no key edge / unknown id → [].
 *   T7  bundling + sort: one entry per otherId, ascending; never self.
 *   T8  a no-op / old-behavior impl (per-member secondary-FK expansion) must fail.
 *   T9  real model: SSN reaches the party-keyed family, excludes Product etc.
 */

import { buildModelIndex } from '../../src/model/model-index';
import {
  buildInheritedConnections,
  INHERITED_IDENTITY,
  type InheritedConnection,
} from '../../src/app/logic/spotlight-inherited';
import { parseModels } from '../../src/model/parse';
import type { Model, ModelNode, ModelEdge, ColumnDef, Predicate, SubtypeCluster } from '../../src/model/parse';
import { defaultTheme } from '../../src/theme/theme-defaults';
import type { Branding } from '../../src/theme/branding-defaults';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const col: ColumnDef = { type: 'uuid' };
const pred: Predicate = { fwd: 'relates to', rev: 'related from' };

/** A node with an explicit composite/single PK. */
function node(id: string, pk: string[]): ModelNode {
  const columns: Record<string, ColumnDef> = {};
  for (const c of pk) columns[c] = col;
  return { id, classification: 'Independent', pk, columns, alternateKeys: [], bodyHtml: '' };
}

/**
 * An edge from `source` (child) to `target` (parent) with explicit FK columns
 * (`on` keys). The KEY-vs-secondary nature is decided purely by whether those
 * FK columns are ⊆ the child's PK — NOT by the `identifying` flag, which we set
 * here only for realism. cardinality is supplied so 1:many / 1:1 cases differ.
 */
function edge(
  source: string,
  target: string,
  fkCols: string[],
  opts: { identifying?: boolean; child?: 'one' | 'many' } = {},
): ModelEdge {
  const on: Record<string, string> = {};
  for (const c of fkCols) on[c] = c;
  return {
    source,
    target,
    identifying: opts.identifying ?? false,
    on,
    predicate: pred,
    cardinality: { parent: '1', child: opts.child === 'one' ? '1' : 'many' },
  };
}

const brandingStub: Branding = {
  logo: { dark: '', light: '' },
  title: '',
  subtitle: '',
  copyright: { holder: '', year: 2024 },
  poweredBy: false,
};

function model(nodes: ModelNode[], edges: ModelEdge[], clusters: SubtypeCluster[] = []): Model {
  return {
    groups: {},
    nodes,
    edges,
    subtypeClusters: clusters,
    theme: defaultTheme,
    branding: brandingStub,
  };
}

// ---------------------------------------------------------------------------
// T1 — key FK is followed, secondary FK is NOT (the core correctness fix).
// ---------------------------------------------------------------------------
//
// Line: pk = (party_id, line_seq). It has:
//   - a KEY FK to Order on (party_id)        — party_id ⊂ Line.pk → key edge ✓
//   - a SECONDARY FK to Product on (prod_id) — prod_id ∉ Line.pk  → secondary ✗
// Order: pk = (party_id). Order has a KEY FK to Party on (party_id) → key edge.
//
// Spotlighting Line:
//   - lineage = {Line, Order, Party} (key edges only)
//   - Product is reachable ONLY via the secondary FK → must NOT be in lineage
//   - direct neighbours of Line: Order (key FK, solid), Product (secondary FK, solid)
//   - inherited = lineage − self − direct = {Party}
{
  const m = model(
    [
      node('Line', ['party_id', 'line_seq']),
      node('Order', ['party_id']),
      node('Party', ['party_id']),
      node('Product', ['product_id']),
    ],
    [
      edge('Line', 'Order', ['party_id'], { identifying: true, child: 'many' }), // KEY (⊂)
      edge('Line', 'Product', ['product_id'], { identifying: false, child: 'many' }), // SECONDARY
      edge('Order', 'Party', ['party_id'], { identifying: true, child: 'many' }), // KEY (==)
    ],
  );
  const index = buildModelIndex(m);
  const result = buildInheritedConnections(index, 'Line');
  const ids = result.map(c => c.otherId);

  // Product is reachable ONLY through a secondary FK → never in lineage.
  assert(!ids.includes('Product'), 'T1: Product NOT in lineage (reached only via a secondary FK)');
  // Party is reached transitively via key edges Line→Order→Party.
  assert(ids.includes('Party'), 'T1: Party IS in lineage (transitive over key edges)');
  // Order is a direct real-edge neighbour of Line → solid line → excluded.
  assert(!ids.includes('Order'), 'T1: Order excluded (direct real-edge neighbour, renders solid)');
  assert(!ids.includes('Line'), 'T1: never the active entity itself');

  console.log('PASS T1: key FK followed, secondary FK ignored (over-connection fix)');
}

// ---------------------------------------------------------------------------
// T2 — identifying 1:many: FK is a PROPER SUBSET of the child PK (not ==).
// ---------------------------------------------------------------------------
//
// This is the case the OLD code missed (it required FK == full PK + 1:1).
// Invoice: pk = (party_id, invoice_no). KEY FK to Party on (party_id) — a
// proper subset, cardinality 1:many. Party also keys Order the same way.
// Spotlighting Invoice → lineage {Invoice, Party, Order}; Party is a direct
// neighbour (solid), so inherited = {Order} (reached via Party, FK ⊂ PK chain).
{
  const m = model(
    [
      node('Invoice', ['party_id', 'invoice_no']),
      node('Party', ['party_id']),
      node('Order', ['party_id', 'order_no']),
    ],
    [
      edge('Invoice', 'Party', ['party_id'], { identifying: true, child: 'many' }), // FK ⊂ PK, 1:many
      edge('Order', 'Party', ['party_id'], { identifying: true, child: 'many' }), // FK ⊂ PK, 1:many
    ],
  );
  const index = buildModelIndex(m);
  const result = buildInheritedConnections(index, 'Invoice');
  const ids = result.map(c => c.otherId);

  assert(!ids.includes('Party'), 'T2: Party excluded (direct neighbour, solid)');
  // Order shares party_id in its PK via Party → in lineage, not a direct neighbour.
  assert(ids.includes('Order'), 'T2: Order reached via identifying-1:many key chain (FK ⊂ PK)');
  console.log('PASS T2: identifying 1:many (FK proper subset of PK) is a key edge');
}

// ---------------------------------------------------------------------------
// T3 — transitivity across a multi-hop key chain (A→B→C→D, all key edges).
// ---------------------------------------------------------------------------
//
// D→C→B→A, each FK == child's full PK (single col 'k'). Spotlighting D:
//   lineage = {A, B, C, D}; direct neighbour of D = C; inherited = {A, B}.
//   via labels: C is direct (excluded); B reached via C; A reached via B.
{
  const m = model(
    [node('A', ['k']), node('B', ['k']), node('C', ['k']), node('D', ['k'])],
    [
      edge('B', 'A', ['k'], { identifying: true, child: 'many' }),
      edge('C', 'B', ['k'], { identifying: true, child: 'many' }),
      edge('D', 'C', ['k'], { identifying: true, child: 'many' }),
    ],
  );
  const index = buildModelIndex(m);
  const result = buildInheritedConnections(index, 'D');
  const ids = result.map(c => c.otherId).sort();

  assert(!ids.includes('C'), 'T3: C excluded (direct neighbour of D)');
  assert(ids.includes('B'), 'T3: B reached transitively (2 hops)');
  assert(ids.includes('A'), 'T3: A reached transitively (3 hops)');

  // via: B reached through C (nearest key-edge predecessor); A through B.
  const bVia = result.find(c => c.otherId === 'B')?.via;
  const aVia = result.find(c => c.otherId === 'A')?.via;
  assert(bVia === 'C', `T3: B carries via=C (nearest key-edge kin), got ${bVia}`);
  assert(aVia === 'B', `T3: A carries via=B, got ${aVia}`);
  console.log('PASS T3: transitivity across a multi-hop key chain');
}

// ---------------------------------------------------------------------------
// T4 — connected component: two entities sharing a key root reach each other.
// ---------------------------------------------------------------------------
//
// Root R keyed by 'k'. Child1→R and Child2→R both key edges. Child1 and Child2
// have NO direct edge between them, yet share the same lineage component.
// Spotlighting Child1 → lineage {Child1, R, Child2}; R is direct (excluded);
// inherited = {Child2}. Symmetric for Child2.
{
  const m = model(
    [node('R', ['k']), node('Child1', ['k', 'a']), node('Child2', ['k', 'b'])],
    [
      edge('Child1', 'R', ['k'], { identifying: true, child: 'many' }),
      edge('Child2', 'R', ['k'], { identifying: true, child: 'many' }),
    ],
  );
  const index = buildModelIndex(m);

  const r1 = buildInheritedConnections(index, 'Child1').map(c => c.otherId);
  const r2 = buildInheritedConnections(index, 'Child2').map(c => c.otherId);

  assert(r1.includes('Child2'), 'T4: Child1 reaches Child2 (shared key root, no direct edge)');
  assert(r2.includes('Child1'), 'T4: Child2 reaches Child1 (component is symmetric)');
  assert(!r1.includes('R'), 'T4: R excluded from Child1 (direct neighbour)');
  console.log('PASS T4: connected component — siblings via a shared key root reach each other');
}

// ---------------------------------------------------------------------------
// T5 — direct real-edge neighbours (even key ones) are excluded from inherited.
// ---------------------------------------------------------------------------
//
// Sub→Base is a key edge AND a direct edge → Base renders solid, not dotted.
{
  const m = model(
    [node('Base', ['k']), node('Sub', ['k']), node('Cousin', ['k'])],
    [
      edge('Sub', 'Base', ['k'], { identifying: true, child: 'many' }),
      edge('Cousin', 'Base', ['k'], { identifying: true, child: 'many' }),
    ],
  );
  const index = buildModelIndex(m);
  const result = buildInheritedConnections(index, 'Sub');
  const ids = result.map(c => c.otherId);

  assert(!ids.includes('Base'), 'T5: Base excluded (direct key-edge neighbour → solid)');
  assert(ids.includes('Cousin'), 'T5: Cousin in lineage (sibling via Base, not direct)');
  console.log('PASS T5: direct real-edge neighbours excluded from the dotted set');
}

// ---------------------------------------------------------------------------
// T6 — empties: singleton lineage, secondary-FK-only, unknown id → [].
// ---------------------------------------------------------------------------
{
  // (a) Two nodes joined ONLY by a secondary FK (surrogate PKs) → no lineage.
  const orm = model(
    [node('Aorm', ['id']), node('Borm', ['id'])],
    [edge('Aorm', 'Borm', ['b_id'], { identifying: false, child: 'many' })], // b_id ∉ Aorm.pk
  );
  const ormIndex = buildModelIndex(orm);
  assert(buildInheritedConnections(ormIndex, 'Aorm').length === 0, 'T6a: secondary-FK-only join → []');

  // (b) An isolated node → [].
  const solo = model([node('Solo', ['id'])], []);
  assert(buildInheritedConnections(buildModelIndex(solo), 'Solo').length === 0, 'T6b: isolated node → []');

  // (c) Unknown id → [] without throwing.
  const unknown = buildInheritedConnections(ormIndex, 'Ghost');
  assert(Array.isArray(unknown) && unknown.length === 0, 'T6c: unknown id → []');
  console.log('PASS T6: singleton / secondary-only / unknown → []');
}

// ---------------------------------------------------------------------------
// T7 — bundling, sort, shape, never-self.
// ---------------------------------------------------------------------------
{
  const m = model(
    [node('Root', ['k']), node('M1', ['k', 'a']), node('M2', ['k', 'b']), node('M3', ['k', 'c'])],
    [
      edge('M1', 'Root', ['k'], { identifying: true, child: 'many' }),
      edge('M2', 'Root', ['k'], { identifying: true, child: 'many' }),
      edge('M3', 'Root', ['k'], { identifying: true, child: 'many' }),
    ],
  );
  const index = buildModelIndex(m);
  const result: InheritedConnection[] = buildInheritedConnections(index, 'M1');
  const ids = result.map(c => c.otherId);

  // One entry per otherId.
  assert(ids.length === new Set(ids).size, 'T7: one bundle per otherId');
  // Ascending sort.
  const sorted = [...ids].sort();
  assert(ids.every((v, i) => v === sorted[i]), 'T7: result sorted ascending by otherId');
  // Never self.
  assert(!ids.includes('M1'), 'T7: excludes the active entity');
  // Root is direct → excluded; M2/M3 are siblings → present.
  assert(!ids.includes('Root'), 'T7: Root excluded (direct)');
  assert(ids.includes('M2') && ids.includes('M3'), 'T7: siblings present');
  // Shape: every connection carries otherId, direction, via.
  for (const c of result) {
    assert(typeof c.otherId === 'string' && c.otherId.length > 0, 'T7: otherId present');
    assert(c.direction === 'out', 'T7: direction is out (single source-out arrow to the lineage member)');
    assert(typeof c.via === 'string' && c.via.length > 0, 'T7: via present');
  }
  // Siblings reached through the shared Root → via=Root (nearest kin).
  assert(result.find(c => c.otherId === 'M2')?.via === 'Root', 'T7: M2 via=Root');
  console.log('PASS T7: bundling, ascending sort, shape, never-self');
}

// ---------------------------------------------------------------------------
// T8 — a no-op / OLD-behavior impl must fail this suite.
// ---------------------------------------------------------------------------
//
// The OLD code surfaced a group member's SECONDARY direct FK connections. Build
// a model that distinguishes the two behaviours: Sub is a subtype of Base; Base
// has a SECONDARY FK to Lookup (lookup_id ∉ Base.pk). Under the OLD rule,
// spotlighting Sub would surface Lookup (Base's external direct FK). Under the
// CORRECT rule, Lookup is reached only via a secondary FK → NOT in lineage.
//
// This test FAILS for the old per-member-secondary-FK expansion and PASSES for
// the key-edge-component rewrite.
{
  const m = model(
    [node('Base', ['k']), node('Sub', ['k']), node('Lookup', ['lookup_id']), node('Sibling', ['k'])],
    [
      edge('Sub', 'Base', ['k'], { identifying: true, child: 'many' }), // key
      edge('Sibling', 'Base', ['k'], { identifying: true, child: 'many' }), // key
      edge('Base', 'Lookup', ['lookup_id'], { identifying: false, child: 'many' }), // SECONDARY (Base's external FK)
    ],
    [{ basetype: 'Base', exclusive: true, members: ['Sub', 'Sibling'], hasDiscriminator: true }],
  );
  const index = buildModelIndex(m);
  const ids = buildInheritedConnections(index, 'Sub').map(c => c.otherId);

  // The old behavior would include Lookup (Base's secondary external FK). The
  // correct behavior must NOT — Lookup is a classifier reached via secondary FK.
  assert(!ids.includes('Lookup'), 'T8: Lookup NOT inherited (old per-member secondary-FK expansion is wrong)');
  // Sibling IS in lineage (sibling subtype via the shared key root Base).
  assert(ids.includes('Sibling'), 'T8: Sibling in lineage (key-edge sibling)');
  console.log('PASS T8: old secondary-FK-expansion behavior would fail; key-edge rule passes');
}

// ---------------------------------------------------------------------------
// T9 — real model end-to-end: models/key-inherited owner cases.
// ---------------------------------------------------------------------------
{
  const { model: real } = await parseModels('models/key-inherited');
  const index = buildModelIndex(real);

  const ssn = new Set(buildInheritedConnections(index, 'SSN').map(c => c.otherId));
  // Must reach the party-keyed family (Identity is SSN's direct neighbour → excluded).
  for (const m of ['Party', 'Passport', 'ITIN', 'License', 'SalesInvoice', 'SI_Line', 'SalesOrder', 'SO_Line', 'PaymentAllocation', 'PaymentMethod']) {
    assert(ssn.has(m), `T9: SSN lineage includes ${m}`);
  }
  // Must EXCLUDE the secondary-FK targets.
  for (const m of ['Product', 'Subscription', 'LineItemType', 'PartyType']) {
    assert(!ssn.has(m), `T9: SSN lineage EXCLUDES ${m} (secondary FK)`);
  }

  // SI_Line no longer over-connects to Product / Subscription / LineItemType.
  const siLine = new Set(buildInheritedConnections(index, 'SI_Line').map(c => c.otherId));
  for (const m of ['Product', 'Subscription', 'LineItemType']) {
    assert(!siLine.has(m), `T9: SI_Line EXCLUDES ${m} (was the over-connection bug)`);
  }

  // SIL_Subscription excludes LineItemType.
  const silSub = new Set(buildInheritedConnections(index, 'SIL_Subscription').map(c => c.otherId));
  assert(!silSub.has('LineItemType'), 'T9: SIL_Subscription EXCLUDES LineItemType');

  // Party and SSN are the SAME lineage component.
  const partyInh = new Set(buildInheritedConnections(index, 'Party').map(c => c.otherId));
  assert(partyInh.has('SSN'), 'T9: Party lineage reaches SSN');
  assert(ssn.has('Party'), 'T9: SSN lineage reaches Party (same component)');

  console.log('PASS T9: real model — over-connection gone, identifying-1:many lineage restored');
}

// INHERITED_IDENTITY export sanity (used by SpotlightOverlay for the "shared key" pill).
assert(INHERITED_IDENTITY === 'identity', 'INHERITED_IDENTITY exported as the expected literal');

console.log('\nAll tests passed.');
