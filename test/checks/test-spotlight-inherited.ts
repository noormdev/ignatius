/**
 * test-spotlight-inherited.ts — unit tests for buildInheritedConnections (CP7, #9).
 *
 * CI assertion script (PASS/FAIL/exit-1 style).
 * Builds plain Model literals with a subtype cluster, runs them through
 * buildModelIndex, then calls buildInheritedConnections and validates the
 * exported InheritedConnection shape + de-duplication invariants.
 *
 * The contract (CP7, #9): the DD spotlight surfaces connections a subtype
 * member inherits via 1:1 key-inheritance (shared PK). A member surfaces (a) its
 * sibling members + its basetype as inherited identity links, and (b) the
 * basetype's direct FK connections. A basetype surfaces its members + their
 * direct connections. ALL inherited connections — identity links included — are
 * de-duplicated against the active entity's OWN direct connections, never
 * duplicate a direct edge, and never point at the active entity itself. In the
 * key-inherited convention a subtype has a direct identifying FK to its
 * basetype, so the basetype renders ONCE as that solid direct line, NOT also as
 * a dotted inherited identity line; the sibling and the basetype's OTHER
 * relationships (not direct edges of the active) still surface as inherited.
 */

import { buildModelIndex } from '../../src/model/model-index';
import { buildInheritedConnections, type InheritedConnection } from '../../src/app/logic/spotlight-inherited';
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
// Fixtures
// ---------------------------------------------------------------------------

const idCol: ColumnDef = { type: 'uuid' };

function makeNode(id: string): ModelNode {
  return {
    id,
    classification: 'Independent',
    pk: ['id'],
    columns: { id: idCol },
    alternateKeys: [],
    bodyHtml: '',
  };
}

const pred: Predicate = { fwd: 'relates to', rev: 'related from' };

function makeEdge(source: string, target: string): ModelEdge {
  return {
    source,
    target,
    identifying: false,
    on: { [`${source.toLowerCase()}_id`]: 'id' },
    predicate: pred,
    cardinality: { parent: '1', child: 'many' },
  };
}

const defaultBrandingStub: Branding = {
  logo: { dark: '', light: '' },
  title: '',
  subtitle: '',
  copyright: { holder: '', year: 2024 },
  poweredBy: false,
};

function makeModel(nodes: ModelNode[], edges: ModelEdge[], clusters: SubtypeCluster[]): Model {
  return {
    groups: {},
    nodes,
    edges,
    subtypeClusters: clusters,
    theme: defaultTheme,
    branding: defaultBrandingStub,
  };
}

// Owner's example: Party (basetype) with Business + Individual subtypes.
// Business has a direct FK to X. Party has a direct FK to Y (and an incoming from Z).
const partyCluster: SubtypeCluster = {
  basetype: 'Party',
  exclusive: true,
  members: ['Business', 'Individual'],
  hasDiscriminator: true,
};

function ownerModel(): Model {
  return makeModel(
    [
      makeNode('Party'),
      makeNode('Business'),
      makeNode('Individual'),
      makeNode('X'),
      makeNode('Y'),
      makeNode('Z'),
    ],
    [
      // subtype identity edges (members → basetype, shared key)
      makeEdge('Business', 'Party'),
      makeEdge('Individual', 'Party'),
      // Business' own direct FK
      makeEdge('Business', 'X'),
      // Party's direct relationships
      makeEdge('Party', 'Y'), // out
      makeEdge('Z', 'Party'), // in (Z → Party)
    ],
    [partyCluster],
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// T1: subtype member surfaces sibling + basetype's relationships as inherited,
//     but NOT the basetype itself (it's a direct FK edge of the member), and
//     not its own direct edge — all inherited connections de-dup against direct.
{
  const index = buildModelIndex(ownerModel());
  const result = buildInheritedConnections(index, 'Business');
  const ids = result.map(c => c.otherId);

  // Party is a DIRECT FK edge of Business (the subtype identity edge) → it
  // renders once as the solid direct line and must NOT also be an inherited
  // identity line. Identity links de-dup against direct edges just like rels.
  assert(!ids.includes('Party'), 'T1: excludes basetype Party (already a direct edge of Business)');
  // Sibling member is surfaced as an identity link (NOT a direct edge of Business).
  assert(ids.includes('Individual'), 'T1: includes sibling Individual (identity link)');
  // Basetype's direct relationship Y is surfaced (inherited via Party).
  assert(ids.includes('Y'), "T1: includes basetype's relationship Y");
  // Basetype's incoming relationship Z is surfaced.
  assert(ids.includes('Z'), "T1: includes basetype's incoming relationship Z");

  // X is a DIRECT connection of Business → must NOT be inherited (transitive de-dup).
  assert(!ids.includes('X'), 'T1: excludes X (already direct on Business)');
  // Never points at the active entity itself.
  assert(!ids.includes('Business'), 'T1: excludes the active entity itself');

  // The sibling identity link carries via = INHERITED_IDENTITY.
  const siblingConn = result.find(c => c.otherId === 'Individual');
  assert(siblingConn !== undefined && siblingConn.via === 'identity', 'T1: Individual carries via=identity');
  // The inherited basetype relationship carries via = the basetype id.
  const yConn = result.find(c => c.otherId === 'Y');
  assert(yConn !== undefined && yConn.via === 'Party', 'T1: Y carries via=Party (the basetype)');

  // Every connection carries a `via` provenance marker.
  for (const c of result) {
    assert(typeof c.via === 'string' && c.via.length > 0, `T1: connection to ${c.otherId} carries a via marker`);
  }
  console.log('PASS T1: subtype member surfaces inherited sibling + basetype rels, basetype itself de-duped (direct)');
}

// T2: basetype surfaces its members' OTHER connections; the members themselves
//     de-dup because the subtype identity edges (Business→Party, Individual→Party)
//     make them direct in-connections of the basetype.
{
  const index = buildModelIndex(ownerModel());
  const result = buildInheritedConnections(index, 'Party');
  const ids = result.map(c => c.otherId);

  // Business' direct connection X is inherited up to the basetype (X is not a
  // direct edge of Party).
  assert(ids.includes('X'), "T2: includes member Business' relationship X (inherited up)");
  // X carries via = the member id it was inherited through.
  const xConn = result.find(c => c.otherId === 'X');
  assert(xConn !== undefined && xConn.via === 'Business', 'T2: X carries via=Business (the member)');

  // Members are DIRECT in-connections of Party (the subtype identity edges) →
  // they render once as direct lines and must NOT also be inherited identity lines.
  assert(!ids.includes('Business'), 'T2: excludes member Business (already a direct edge of Party)');
  assert(!ids.includes('Individual'), 'T2: excludes member Individual (already a direct edge of Party)');
  // Y and Z are DIRECT connections of Party → must NOT be inherited.
  assert(!ids.includes('Y'), 'T2: excludes Y (direct on Party)');
  assert(!ids.includes('Z'), 'T2: excludes Z (direct on Party)');
  // Never points at the active entity itself.
  assert(!ids.includes('Party'), 'T2: excludes the active entity itself');
  console.log("PASS T2: basetype surfaces members' other connections, members themselves de-duped (direct)");
}

// T3: de-dup — an otherId that is BOTH a direct connection of the active AND a
//     basetype connection appears ONLY as direct (absent from inherited).
{
  // Business has a direct FK to W; Party also has a direct FK to W.
  // Spotlighting Business: W is direct → must be absent from inherited.
  const model = makeModel(
    [makeNode('Party'), makeNode('Business'), makeNode('Individual'), makeNode('W')],
    [
      makeEdge('Business', 'Party'),
      makeEdge('Individual', 'Party'),
      makeEdge('Business', 'W'), // direct on Business
      makeEdge('Party', 'W'), // also on basetype
    ],
    [partyCluster],
  );
  const index = buildModelIndex(model);
  const result = buildInheritedConnections(index, 'Business');
  const ids = result.map(c => c.otherId);
  assert(!ids.includes('W'), 'T3: W absent from inherited (already a direct edge of Business)');
  // W appears only once if at all — bundled per otherId. (It must not appear at all here.)
  const wCount = ids.filter(i => i === 'W').length;
  assert(wCount === 0, 'T3: no duplicate W entries');
  console.log('PASS T3: de-dup — direct connection wins over inherited');
}

// T4: a plain entity in no cluster → inherited is [].
{
  const model = makeModel(
    [makeNode('A'), makeNode('B')],
    [makeEdge('A', 'B')],
    [],
  );
  const index = buildModelIndex(model);
  const result = buildInheritedConnections(index, 'A');
  assert(Array.isArray(result), 'T4: returns an array');
  assert(result.length === 0, 'T4: plain entity (no cluster) → []');
  console.log('PASS T4: plain entity in no cluster → []');
}

// T5: unknown entityId → [] without throw.
{
  const index = buildModelIndex(ownerModel());
  const result = buildInheritedConnections(index, 'Ghost');
  assert(Array.isArray(result) && result.length === 0, 'T5: unknown id → []');
  console.log('PASS T5: unknown entityId → []');
}

// T6: bundling — one inherited connection per otherId (no duplicate ids).
{
  const index = buildModelIndex(ownerModel());
  const result = buildInheritedConnections(index, 'Business');
  const ids = result.map(c => c.otherId);
  const unique = new Set(ids);
  assert(ids.length === unique.size, 'T6: no duplicate otherId entries (bundled)');
  console.log('PASS T6: one inherited connection per otherId');
}

console.log('\nAll tests passed.');
