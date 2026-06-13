/**
 * test-spotlight-connections.ts — unit tests for buildSpotlightConnections.
 *
 * CI assertion script (PASS/FAIL/exit-1 style).
 * Builds plain Model literals, runs them through buildModelIndex, then calls
 * buildSpotlightConnections and validates the exported SpotlightConnection shape.
 */

import { buildModelIndex } from '../../src/model/model-index';
import {
  buildSpotlightConnections,
  type SpotlightConnection,
  type SpotlightEdge,
} from '../../src/app/logic/spotlight';
import type { Model, ModelNode, ModelEdge, ColumnDef, Predicate } from '../../src/model/parse';
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

function makeNode(id: string, group?: string): ModelNode {
  return {
    id,
    classification: 'Independent',
    group,
    pk: ['id'],
    columns: { id: idCol },
    alternateKeys: [],
    bodyHtml: '',
  };
}

const predAB: Predicate = { fwd: 'owns', rev: 'owned by' };
const predBA: Predicate = { fwd: 'belongs to', rev: 'has' };
const predAC: Predicate = { fwd: 'contains', rev: 'part of' };

function makeEdge(
  source: string,
  target: string,
  predicate: Predicate,
  identifying = false,
): ModelEdge {
  return {
    source,
    target,
    identifying,
    on: { [`${source.toLowerCase()}_id`]: 'id' },
    predicate,
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

function makeModel(nodes: ModelNode[], edges: ModelEdge[]): Model {
  return {
    groups: {},
    nodes,
    edges,
    subtypeClusters: [],
    theme: defaultTheme,
    branding: defaultBrandingStub,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// T1: unknown entityId → [] without throw
{
  const model = makeModel([], []);
  const index = buildModelIndex(model);
  const result = buildSpotlightConnections(index, 'Ghost');
  assert(Array.isArray(result), 'T1: result is an array');
  assert(result.length === 0, 'T1: unknown id returns []');
  console.log('PASS T1: unknown entityId → []');
}

// T2: known id with no edges → []
{
  const model = makeModel([makeNode('A'), makeNode('B')], []);
  const index = buildModelIndex(model);
  const result = buildSpotlightConnections(index, 'A');
  assert(result.length === 0, 'T2: no edges returns []');
  console.log('PASS T2: known id with no edges → []');
}

// T3: empty model → []
{
  const model = makeModel([], []);
  const index = buildModelIndex(model);
  const result = buildSpotlightConnections(index, 'A');
  assert(result.length === 0, 'T3: empty model returns []');
  console.log('PASS T3: empty model → []');
}

// T4: simple out edge (A → B, A is source/child)
{
  const edgeAB = makeEdge('A', 'B', predAB);
  const model = makeModel([makeNode('A'), makeNode('B')], [edgeAB]);
  const index = buildModelIndex(model);
  const result = buildSpotlightConnections(index, 'A');
  assert(result.length === 1, 'T4: 1 connection');
  const conn = result[0] as SpotlightConnection;
  assert(conn.otherId === 'B', 'T4: otherId is B');
  assert(conn.direction === 'out', 'T4: direction is out');
  assert(conn.edges.length === 1, 'T4: 1 edge in bundle');
  const e0 = conn.edges[0] as SpotlightEdge;
  assert(e0.direction === 'out', 'T4: edge direction is out');
  assert(e0.predicate.fwd === 'owns', 'T4: predicate passthrough');
  assert(e0.cardinality.parent === '1', 'T4: cardinality passthrough');
  assert(e0.identifying === false, 'T4: identifying passthrough');
  console.log('PASS T4: simple out edge');
}

// T5: simple in edge (B → A, A is target/parent, so from A's perspective it's 'in')
{
  const edgeBA = makeEdge('B', 'A', predBA);
  const model = makeModel([makeNode('A'), makeNode('B')], [edgeBA]);
  const index = buildModelIndex(model);
  const result = buildSpotlightConnections(index, 'A');
  assert(result.length === 1, 'T5: 1 connection');
  const conn = result[0] as SpotlightConnection;
  assert(conn.otherId === 'B', 'T5: otherId is B');
  assert(conn.direction === 'in', 'T5: direction is in');
  const e0 = conn.edges[0] as SpotlightEdge;
  assert(e0.direction === 'in', 'T5: edge direction is in');
  assert(e0.predicate.fwd === 'belongs to', 'T5: predicate passthrough');
  console.log('PASS T5: simple in edge');
}

// T6: self-edge excluded
{
  const selfEdge = makeEdge('A', 'A', predAB);
  const model = makeModel([makeNode('A')], [selfEdge]);
  const index = buildModelIndex(model);
  const result = buildSpotlightConnections(index, 'A');
  assert(result.length === 0, 'T6: self-edge excluded');
  console.log('PASS T6: self-edge excluded');
}

// T7: bundling — multiple edges to the same otherId (all out) merge into one connection
// Two out edges from A to B (parallel edges) → one connection, both edges, direction 'out'
{
  const edge1 = makeEdge('A', 'B', predAB);
  const edge2: ModelEdge = {
    source: 'A',
    target: 'B',
    identifying: true,
    on: { a_other_id: 'id' },
    predicate: predAC,
    cardinality: { parent: '1', child: '0..1' },
  };
  const model = makeModel([makeNode('A'), makeNode('B')], [edge1, edge2]);
  const index = buildModelIndex(model);
  const result = buildSpotlightConnections(index, 'A');
  assert(result.length === 1, 'T7: bundled into 1 connection');
  const conn = result[0] as SpotlightConnection;
  assert(conn.otherId === 'B', 'T7: otherId B');
  assert(conn.direction === 'out', 'T7: direction out (all out)');
  assert(conn.edges.length === 2, 'T7: 2 edges in bundle');
  assert((conn.edges[0] as SpotlightEdge).direction === 'out', 'T7: edge[0] direction out');
  assert((conn.edges[1] as SpotlightEdge).direction === 'out', 'T7: edge[1] direction out');
  console.log('PASS T7: multi-edge bundling (all out)');
}

// T8: direction 'both' when bundle has out and in edges for same otherId
// A → B (out) and B → A (in from A's view) — but B→A goes in edgesBySource(B) not A
// To get a 'both' case: A has edge to B (out) AND B has edge to A (in)
// Actually: A→B means A is source, B is target. From A's perspective = out edge to B.
// B→A means B is source, A is target. From A's perspective = in edge from B.
// So from A's view, otherId=B has an out edge (A→B) and an in edge (B→A).
{
  const edgeOut = makeEdge('A', 'B', predAB); // A→B: out for A
  const edgeIn = makeEdge('B', 'A', predBA);  // B→A: in for A (A is target)
  const model = makeModel([makeNode('A'), makeNode('B')], [edgeOut, edgeIn]);
  const index = buildModelIndex(model);
  const result = buildSpotlightConnections(index, 'A');
  assert(result.length === 1, 'T8: bundled into 1 connection for B');
  const conn = result[0] as SpotlightConnection;
  assert(conn.otherId === 'B', 'T8: otherId B');
  assert(conn.direction === 'both', 'T8: direction both');
  assert(conn.edges.length === 2, 'T8: 2 edges in bundle');
  // Out edges before in edges within bundle
  assert((conn.edges[0] as SpotlightEdge).direction === 'out', 'T8: edges[0] is out');
  assert((conn.edges[1] as SpotlightEdge).direction === 'in', 'T8: edges[1] is in');
  console.log('PASS T8: direction both + out-before-in edge order');
}

// T9: sort by otherId ascending
// A connects to C, B, D — result should be B, C, D
{
  const edgeAB = makeEdge('A', 'B', predAB);
  const edgeAC = makeEdge('A', 'C', predAC);
  // D→A so from A's view: in edge from D
  const edgeDA = makeEdge('D', 'A', predBA);
  const model = makeModel(
    [makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')],
    [edgeAB, edgeAC, edgeDA],
  );
  const index = buildModelIndex(model);
  const result = buildSpotlightConnections(index, 'A');
  assert(result.length === 3, 'T9: 3 connections');
  assert((result[0] as SpotlightConnection).otherId === 'B', 'T9: sorted[0] = B');
  assert((result[1] as SpotlightConnection).otherId === 'C', 'T9: sorted[1] = C');
  assert((result[2] as SpotlightConnection).otherId === 'D', 'T9: sorted[2] = D');
  console.log('PASS T9: sort by otherId ascending');
}

// T10: identifying passthrough
{
  const identEdge: ModelEdge = {
    source: 'A',
    target: 'B',
    identifying: true,
    on: { a_id: 'id' },
    predicate: predAB,
    cardinality: { parent: '1', child: 'many' },
  };
  const model = makeModel([makeNode('A'), makeNode('B')], [identEdge]);
  const index = buildModelIndex(model);
  const result = buildSpotlightConnections(index, 'A');
  const t10conn = result[0] as SpotlightConnection;
  assert((t10conn.edges[0] as SpotlightEdge).identifying === true, 'T10: identifying passthrough');
  console.log('PASS T10: identifying passthrough');
}

// T11: out-before-in within bundle (explicit order check with 3 edges)
// A has 2 out edges to B and 1 in edge from B.
// Because edgesBySource only stores unique source→target edges (the index uses lists),
// we need to store two separate "A→B" conceptual paths. In the actual model-index,
// edgesBySource keeps all edges keyed by source. Let's add a second A→B parallel edge
// by using a different `on` mapping.
{
  const outEdge1: ModelEdge = {
    source: 'A', target: 'B', identifying: false,
    on: { fk1: 'id' }, predicate: predAB,
    cardinality: { parent: '1', child: 'many' },
  };
  const outEdge2: ModelEdge = {
    source: 'A', target: 'B', identifying: false,
    on: { fk2: 'id' }, predicate: predAC,
    cardinality: { parent: '1', child: '0..1' },
  };
  const inEdge: ModelEdge = {
    source: 'B', target: 'A', identifying: false,
    on: { b_id: 'id' }, predicate: predBA,
    cardinality: { parent: '1', child: 'many' },
  };
  const model = makeModel([makeNode('A'), makeNode('B')], [outEdge1, outEdge2, inEdge]);
  const index = buildModelIndex(model);
  const result = buildSpotlightConnections(index, 'A');
  assert(result.length === 1, 'T11: 1 connection');
  const t11conn = result[0] as SpotlightConnection;
  assert(t11conn.direction === 'both', 'T11: direction both');
  assert(t11conn.edges.length === 3, 'T11: 3 edges');
  // Out edges come first
  assert((t11conn.edges[0] as SpotlightEdge).direction === 'out', 'T11: edges[0] out');
  assert((t11conn.edges[1] as SpotlightEdge).direction === 'out', 'T11: edges[1] out');
  assert((t11conn.edges[2] as SpotlightEdge).direction === 'in', 'T11: edges[2] in');
  console.log('PASS T11: out-before-in within bundle (3 edges)');
}

console.log('\nAll tests passed.');
