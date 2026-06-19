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

// ---------------------------------------------------------------------------
// Transitive (dependent identifying-1:1) fixtures
// ---------------------------------------------------------------------------
//
// Topology:
//   Party — basetype, pk=['party_id']
//   Identity — dependent identifying-1:1 of Party, pk=['party_id'],
//              edge: Identity→Party, identifying=true, cardinality={parent:'1',child:'1'},
//              on={party_id:'party_id'} (FK == full PK → qualifies)
//   ITIN — subtype of Identity (subtype cluster: basetype=Identity, members=['ITIN'])
//          pk=['party_id'], edge: ITIN→Identity, identifying=true,
//          cardinality={parent:'1',child:'0..1'} (subtype cardinality — does NOT qualify as dep-1:1)
//   X — external entity with a normal FK to Party: Party→X (out from Party)
//   Y — external entity with a normal FK to Identity: Identity→Y (out from Identity)
//
// Group structure:
//   - Party connects to X (party outgoing)
//   - Identity connects to Y (identity outgoing)
//   - ITIN's only direct FK is to Identity (via subtype)
//
// Expected:
//   buildInheritedConnections(index, 'ITIN'):
//     - Identity is a DIRECT FK target of ITIN → de-duped, NOT present as inherited identity link
//     - Party is transitively reachable (Identity→Party dep-1:1) → present as identity link
//     - X (Party's relationship) → present, via='Party'
//     - Y (Identity's relationship) → present, via='Identity'
//
//   buildInheritedConnections(index, 'Identity'):
//     - Party is a DIRECT FK target of Identity → de-duped
//     - ITIN is a DIRECT in-edge of Identity → de-duped
//     - X (Party's relationship, Party is a direct edge) → present, via='Party'
//     - Y is a DIRECT connection of Identity → de-duped (NOT re-inherited)

const partyNode: ModelNode = {
  id: 'Party',
  classification: 'Independent',
  pk: ['party_id'],
  columns: { party_id: idCol },
  alternateKeys: [],
  bodyHtml: '',
};

const identityNode: ModelNode = {
  id: 'Identity',
  classification: 'Dependent',
  pk: ['party_id'],
  columns: { party_id: idCol },
  alternateKeys: [],
  bodyHtml: '',
};

const itinNode: ModelNode = {
  id: 'ITIN',
  classification: 'Subtype',
  pk: ['party_id'],
  columns: { party_id: idCol },
  alternateKeys: [],
  bodyHtml: '',
};

const xNode = makeNode('X');
const yNode = makeNode('Y');

// Identifying 1:1 edge: Identity→Party where FK == Identity's full PK
const identityToPartyEdge: ModelEdge = {
  source: 'Identity',
  target: 'Party',
  identifying: true,
  on: { party_id: 'party_id' },
  predicate: pred,
  cardinality: { parent: '1', child: '1' },
};

// Subtype edge: ITIN→Identity — identifying true but cardinality.child='0..1' (subtype)
const itinToIdentityEdge: ModelEdge = {
  source: 'ITIN',
  target: 'Identity',
  identifying: true,
  on: { party_id: 'party_id' },
  predicate: pred,
  cardinality: { parent: '1', child: '0..1' },
};

// Party→X: normal outgoing (non-identifying, many cardinality)
const partyToXEdge: ModelEdge = {
  source: 'Party',
  target: 'X',
  identifying: false,
  on: { party_id: 'id' },
  predicate: pred,
  cardinality: { parent: '1', child: 'many' },
};

// Identity→Y: normal outgoing
const identityToYEdge: ModelEdge = {
  source: 'Identity',
  target: 'Y',
  identifying: false,
  on: { party_id: 'id' },
  predicate: pred,
  cardinality: { parent: '1', child: 'many' },
};

// Subtype cluster: Identity is the basetype, ITIN is the member
const identityCluster: SubtypeCluster = {
  basetype: 'Identity',
  exclusive: false,
  members: ['ITIN'],
  hasDiscriminator: false,
};

function transitiveModel(): Model {
  return makeModel(
    [partyNode, identityNode, itinNode, xNode, yNode],
    [identityToPartyEdge, itinToIdentityEdge, partyToXEdge, identityToYEdge],
    [identityCluster],
  );
}

// T7: Transitive — ITIN perspective.
// ITIN's identity group: ITIN → (subtype of) Identity → (dep-1:1 of) Party
// Direct FK of ITIN: Identity (subtype edge — direct, so de-duped)
// Expected inherited:
//   Party — identity link (transitive, not direct)
//   X (via Party) — inherited through Party's connection
//   Y (via Identity) — inherited through Identity's connection (Identity is a direct FK
//     of ITIN but Y is NOT, so Y surfaces as inherited via=Identity)
{
  const index = buildModelIndex(transitiveModel());
  const result = buildInheritedConnections(index, 'ITIN');
  const ids = result.map(c => c.otherId);

  // Identity is a DIRECT FK target of ITIN → must be absent from inherited
  assert(!ids.includes('Identity'), 'T7: Identity de-duped (ITIN→Identity is direct)');
  // Party is transitively reachable via Identity dep-1:1 → present as identity link
  assert(ids.includes('Party'), 'T7: Party present (transitive identity link through Identity)');
  // X is Party's relationship → inherited via Party
  assert(ids.includes('X'), 'T7: X present (inherited via Party)');
  // Y is Identity's relationship → inherited (Y is not a direct edge of ITIN)
  assert(ids.includes('Y'), 'T7: Y present (inherited via Identity)');
  // Never self
  assert(!ids.includes('ITIN'), 'T7: excludes self ITIN');

  const partyConn = result.find(c => c.otherId === 'Party');
  assert(partyConn !== undefined && partyConn.via === 'identity', 'T7: Party carries via=identity (identity link)');
  const xConn = result.find(c => c.otherId === 'X');
  assert(xConn !== undefined && xConn.via === 'Party', "T7: X carries via='Party'");
  const yConn = result.find(c => c.otherId === 'Y');
  assert(yConn !== undefined && yConn.via === 'Identity', "T7: Y carries via='Identity'");

  console.log('PASS T7: transitive — ITIN surfaces Party (identity), X (via Party), Y (via Identity)');
}

// T8: Transitive — Identity perspective.
// Identity's identity group: Identity → (dep-1:1) Party; ITIN → (subtype) Identity
// Direct edges of Identity: Party (dep-1:1 out), Y (non-identifying out), ITIN (subtype in)
// Expected inherited:
//   Party — DIRECT → de-duped
//   ITIN — DIRECT in-edge → de-duped
//   Y — DIRECT → de-duped
//   X (via Party) — present (Party is in identity group but X is not a direct edge of Identity)
{
  const index = buildModelIndex(transitiveModel());
  const result = buildInheritedConnections(index, 'Identity');
  const ids = result.map(c => c.otherId);

  // Party is a direct outgoing FK of Identity → de-duped
  assert(!ids.includes('Party'), 'T8: Party de-duped (Identity→Party is direct)');
  // ITIN is a direct in-edge of Identity → de-duped
  assert(!ids.includes('ITIN'), 'T8: ITIN de-duped (ITIN→Identity is direct)');
  // Y is a direct outgoing of Identity → de-duped
  assert(!ids.includes('Y'), 'T8: Y de-duped (Identity→Y is direct)');
  // X (via Party) is NOT a direct edge of Identity → inherited
  assert(ids.includes('X'), 'T8: X present (inherited via Party)');
  // Never self
  assert(!ids.includes('Identity'), 'T8: excludes self Identity');

  const xConn = result.find(c => c.otherId === 'X');
  assert(xConn !== undefined && xConn.via === 'Party', "T8: X carries via='Party'");

  console.log('PASS T8: Identity perspective — X via Party, Party/ITIN/Y all de-duped (direct)');
}

// T9: Dependent-1:1 NEGATIVE — FK != full PK → should NOT create identity group.
// Child has pk=['id','extra'] (2-col PK) but FK is only on={child_id:'id'} (1 col).
// Even though edge is identifying+1:1, it's not a full-PK match → no identity group.
{
  const childNode: ModelNode = {
    id: 'Child',
    classification: 'Dependent',
    pk: ['id', 'extra'],
    columns: { id: idCol, extra: idCol },
    alternateKeys: [],
    bodyHtml: '',
  };
  const parentNode = makeNode('Parent');
  const parentRelNode = makeNode('ParentRel');

  // Edge where FK is only 'id' but child PK is ['id','extra'] — not full PK
  const partialFkEdge: ModelEdge = {
    source: 'Child',
    target: 'Parent',
    identifying: true,
    on: { id: 'id' },
    predicate: pred,
    cardinality: { parent: '1', child: '1' },
  };
  // Parent has a relationship to ParentRel
  const parentToRelEdge: ModelEdge = {
    source: 'Parent',
    target: 'ParentRel',
    identifying: false,
    on: { id: 'id' },
    predicate: pred,
    cardinality: { parent: '1', child: 'many' },
  };

  const model = makeModel(
    [childNode, parentNode, parentRelNode],
    [partialFkEdge, parentToRelEdge],
    [],
  );
  const index = buildModelIndex(model);
  const result = buildInheritedConnections(index, 'Child');
  const ids = result.map(c => c.otherId);

  // Child has no subtype cluster AND the partial FK does NOT qualify as dep-1:1
  // → no identity group → inherited is []
  assert(result.length === 0, 'T9: partial FK (FK != full PK) does not create identity group → []');
  assert(!ids.includes('Parent'), 'T9: Parent absent (partial FK not a full-PK dep-1:1)');
  assert(!ids.includes('ParentRel'), "T9: ParentRel absent (Parent's rels not inherited)");

  console.log('PASS T9: dep-1:1 negative — FK != full PK → no identity group');
}

// T10: Explicit positive dep-1:1 detection — edge qualifies when FK == full PK.
// Single-column PK, edge on the only PK column → qualifies.
{
  const depNode: ModelNode = {
    id: 'Dep',
    classification: 'Dependent',
    pk: ['base_id'],
    columns: { base_id: idCol },
    alternateKeys: [],
    bodyHtml: '',
  };
  const baseNode: ModelNode = {
    id: 'Base',
    classification: 'Independent',
    pk: ['id'],
    columns: { id: idCol },
    alternateKeys: [],
    bodyHtml: '',
  };
  const sideNode = makeNode('Side');

  const qualifyingEdge: ModelEdge = {
    source: 'Dep',
    target: 'Base',
    identifying: true,
    on: { base_id: 'id' },
    predicate: pred,
    cardinality: { parent: '1', child: '1' },
  };
  const baseToSideEdge: ModelEdge = {
    source: 'Base',
    target: 'Side',
    identifying: false,
    on: { id: 'id' },
    predicate: pred,
    cardinality: { parent: '1', child: 'many' },
  };

  const model = makeModel(
    [depNode, baseNode, sideNode],
    [qualifyingEdge, baseToSideEdge],
    [],
  );
  const index = buildModelIndex(model);
  const result = buildInheritedConnections(index, 'Dep');
  const ids = result.map(c => c.otherId);

  // Base is a direct FK of Dep → de-duped
  assert(!ids.includes('Base'), 'T10: Base de-duped (Dep→Base is direct)');
  // Side (Base's relationship) is inherited
  assert(ids.includes('Side'), 'T10: Side present (inherited via Base through dep-1:1)');

  const sideConn = result.find(c => c.otherId === 'Side');
  assert(sideConn !== undefined && sideConn.via === 'Base', "T10: Side carries via='Base'");

  console.log('PASS T10: dep-1:1 positive — FK == full PK → identity group formed, Base rels inherited');
}

// T11: Cycle safety — two dep-1:1 edges forming a bidirectional cycle (A→B and B→A,
// both qualifying as dep-1:1) must terminate and return a finite result.
{
  const aNode: ModelNode = {
    id: 'A',
    classification: 'Dependent',
    pk: ['id'],
    columns: { id: idCol },
    alternateKeys: [],
    bodyHtml: '',
  };
  const bNode: ModelNode = {
    id: 'B',
    classification: 'Dependent',
    pk: ['id'],
    columns: { id: idCol },
    alternateKeys: [],
    bodyHtml: '',
  };

  // A→B: identifying, 1:1, FK on {id:'id'} = A's full PK
  const aToB: ModelEdge = {
    source: 'A',
    target: 'B',
    identifying: true,
    on: { id: 'id' },
    predicate: pred,
    cardinality: { parent: '1', child: '1' },
  };
  // B→A: identifying, 1:1, FK on {id:'id'} = B's full PK
  const bToA: ModelEdge = {
    source: 'B',
    target: 'A',
    identifying: true,
    on: { id: 'id' },
    predicate: pred,
    cardinality: { parent: '1', child: '1' },
  };

  const model = makeModel([aNode, bNode], [aToB, bToA], []);
  const index = buildModelIndex(model);

  // Must not hang or throw
  const result = buildInheritedConnections(index, 'A');
  assert(Array.isArray(result), 'T11: returns an array (terminates)');
  // A is not in result (never self)
  const ids = result.map(c => c.otherId);
  assert(!ids.includes('A'), 'T11: excludes self A');
  // B is A's direct FK (A→B), so B is de-duped from inherited identity links.
  // A is B's direct in-edge (B→A), but that doesn't affect A perspective.
  // After de-dup: B (direct out-edge of A) and A (direct in-edge from B in A's spotlight).
  // The group has A+B. B is direct → de-duped from inherited. Result may be empty.
  assert(result.length >= 0, 'T11: finite result');

  console.log('PASS T11: cycle safety — bidirectional dep-1:1 cycle terminates and returns finite result');
}

console.log('\nAll tests passed.');
