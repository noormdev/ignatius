/**
 * test-flow-spotlight-connections.ts — unit tests for buildFlowSpotlightConnections.
 *
 * CI assertion script (PASS/FAIL/exit-1 style). Builds literal FlowDiagram[]
 * fixtures (same pattern as test-entity-usage-index.ts) and validates the
 * exported FlowSpotlightConnection shape.
 *
 * Covers:
 *   T1  - unknown / empty token → []
 *   T2  - empty diagrams → []
 *   T3  - simple out edge (active is source / from)
 *   T4  - simple in edge (active is sink / to)
 *   T5  - db: other-endpoint resolves to bare entity id (cross-domain otherCardId)
 *   T6  - non-db other-endpoint resolves to raw token
 *   T7  - multi-edge bundling to same otherCardId → one connection
 *   T8  - both-direction merge (out + in to same otherCardId → 'both')
 *   T9  - out edges precede in edges in bundled edges array
 *   T10 - self-edge excluded
 *   T11 - sort by otherCardId ascending
 *   T12 - sub-DFD edges included
 *   T13 - array data joined with ", "
 *   T14 - string data passed through unchanged
 *   T15 - proc: active lookup (process is the active node)
 */

import {
  buildFlowSpotlightConnections,
  type FlowSpotlightConnection,
  type FlowSpotlightEdge,
} from '../../src/app/logic/flow-spotlight';
import type { FlowDiagram, FlowEdge, FlowProcess } from '../../src/flows/flow-parse';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function ep(kind: string, name: string) {
  return { kind, name, raw: `${kind}:${name}` } as const;
}

function makeEdge(
  from: ReturnType<typeof ep>,
  to: ReturnType<typeof ep>,
  data: string | string[] = 'Order data',
): FlowEdge {
  return { from, to, data, flowId: 'test-dfd' } as FlowEdge;
}

function makeProcess(
  id: string,
  inputs: FlowEdge[],
  outputs: FlowEdge[],
  flowId = 'order-to-cash',
): FlowProcess {
  return {
    id,
    label: id,
    dottedNumber: '1',
    inputs,
    outputs,
    body: '',
    bodyHtml: '',
    hasSubDfd: false,
    flowId,
  };
}

function makeDiagram(
  id: string,
  edges: FlowEdge[],
  subDfds: FlowDiagram[] = [],
): FlowDiagram {
  return {
    id,
    title: id,
    processes: [],
    externals: [],
    storeRefs: [],
    edges,
    subDfds,
  };
}

// ---------------------------------------------------------------------------
// T1: unknown / empty token → []
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('proc', 'ProcessA'), ep('db', 'Payment')),
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'ext:Ghost');
  assert(Array.isArray(result), 'T1: result is array');
  assert(result.length === 0, 'T1: unknown token → []');
  console.log('PASS T1: unknown token → []');
}

// ---------------------------------------------------------------------------
// T2: empty diagrams array → []
// ---------------------------------------------------------------------------
{
  const result = buildFlowSpotlightConnections([], 'proc:ProcessA');
  assert(result.length === 0, 'T2: empty diagrams → []');
  console.log('PASS T2: empty diagrams → []');
}

// ---------------------------------------------------------------------------
// T3: simple out edge (active is source / from)
// Active token is proc:ProcessA; it sends data TO db:Payment → direction 'out'.
// The other endpoint is db:Payment → otherCardId = 'Payment' (bare entity id).
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('proc', 'ProcessA'), ep('db', 'Payment'), 'Invoice data'),
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'proc:ProcessA');
  assert(result.length === 1, 'T3: 1 connection');
  const conn = result[0] as FlowSpotlightConnection;
  assert(conn.otherCardId === 'Payment', 'T3: db: other resolves to bare entity id');
  assert(conn.direction === 'out', 'T3: direction out (active is source)');
  assert(conn.edges.length === 1, 'T3: 1 edge in bundle');
  const e0 = conn.edges[0] as FlowSpotlightEdge;
  assert(e0.direction === 'out', 'T3: edge direction out');
  assert(e0.data === 'Invoice data', 'T3: data passthrough');
  console.log('PASS T3: simple out edge → db: resolves to bare entity id');
}

// ---------------------------------------------------------------------------
// T4: simple in edge (active is sink / to)
// Active token is db:Payment; data flows FROM proc:ProcessA → direction 'in'.
// Other endpoint is proc:ProcessA → otherCardId = 'proc:ProcessA' (raw).
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('proc', 'ProcessA'), ep('db', 'Payment'), 'Payment record'),
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'db:Payment');
  assert(result.length === 1, 'T4: 1 connection');
  const conn = result[0] as FlowSpotlightConnection;
  assert(conn.otherCardId === 'proc:ProcessA', 'T4: proc: other resolves to raw');
  assert(conn.direction === 'in', 'T4: direction in (active is sink)');
  assert(conn.edges.length === 1, 'T4: 1 edge');
  const e0 = conn.edges[0] as FlowSpotlightEdge;
  assert(e0.direction === 'in', 'T4: edge direction in');
  assert(e0.data === 'Payment record', 'T4: data passthrough');
  console.log('PASS T4: simple in edge (active is sink)');
}

// ---------------------------------------------------------------------------
// T5: db: other-endpoint → bare entity id (cross-domain resolution)
// proc:ValidateOrder reads from db:SalesOrder (SalesOrder is the other endpoint)
// From proc:ValidateOrder's perspective: out edge (it sends data to db:SalesOrder)
// Wait — re-reading spec: from = source (data source), to = sink.
// proc:ValidateOrder -> db:SalesOrder means the process writes TO SalesOrder.
// Active = proc:ValidateOrder, other = db:SalesOrder → otherCardId = 'SalesOrder'
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('proc', 'ValidateOrder'), ep('db', 'SalesOrder'), 'Validated order'),
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'proc:ValidateOrder');
  assert(result.length === 1, 'T5: 1 connection');
  const conn = result[0] as FlowSpotlightConnection;
  assert(conn.otherCardId === 'SalesOrder', 'T5: db: resolves to bare "SalesOrder"');
  assert(conn.direction === 'out', 'T5: direction out');
  console.log('PASS T5: db: other-endpoint → bare entity id (cross-domain)');
}

// ---------------------------------------------------------------------------
// T6: non-db other-endpoint → raw token
// Active = proc:ProcessA; other = ext:Customer → otherCardId = 'ext:Customer'
// Edge: ext:Customer → proc:ProcessA (external sends to process = 'in' for process)
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('ext', 'Customer'), ep('proc', 'ProcessA'), 'Customer request'),
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'proc:ProcessA');
  assert(result.length === 1, 'T6: 1 connection');
  const conn = result[0] as FlowSpotlightConnection;
  assert(conn.otherCardId === 'ext:Customer', 'T6: ext: resolves to raw "ext:Customer"');
  assert(conn.direction === 'in', 'T6: direction in (active is sink)');
  console.log('PASS T6: non-db other-endpoint → raw token');
}

// ---------------------------------------------------------------------------
// T7: multi-edge bundling to same otherCardId → one connection
// Two separate edges from proc:ProcessA to ext:Customer → bundled into one connection.
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('proc', 'ProcessA'), ep('ext', 'Customer'), 'Confirmation'),
    makeEdge(ep('proc', 'ProcessA'), ep('ext', 'Customer'), 'Receipt'),
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'proc:ProcessA');
  assert(result.length === 1, 'T7: bundled into 1 connection');
  const conn = result[0] as FlowSpotlightConnection;
  assert(conn.otherCardId === 'ext:Customer', 'T7: otherCardId = ext:Customer');
  assert(conn.direction === 'out', 'T7: direction out (both out)');
  assert(conn.edges.length === 2, 'T7: 2 edges in bundle');
  assert((conn.edges[0] as FlowSpotlightEdge).direction === 'out', 'T7: edge[0] out');
  assert((conn.edges[1] as FlowSpotlightEdge).direction === 'out', 'T7: edge[1] out');
  console.log('PASS T7: multi-edge bundling → one connection');
}

// ---------------------------------------------------------------------------
// T8: both-direction merge — process reads AND writes the same store
// proc:Reconcile reads FROM db:Ledger AND writes TO db:Ledger → direction 'both'
// db:Ledger is the active token; other = proc:Reconcile → otherCardId = 'proc:Reconcile'
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('db', 'Ledger'), ep('proc', 'Reconcile'), 'Balance data'),  // db:Ledger → proc (read)
    makeEdge(ep('proc', 'Reconcile'), ep('db', 'Ledger'), 'Updated balance'), // proc → db:Ledger (write)
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'db:Ledger');
  assert(result.length === 1, 'T8: 1 connection (bundled)');
  const conn = result[0] as FlowSpotlightConnection;
  assert(conn.otherCardId === 'proc:Reconcile', 'T8: other is proc:Reconcile');
  assert(conn.direction === 'both', 'T8: direction both');
  assert(conn.edges.length === 2, 'T8: 2 edges');
  // out-before-in invariant must hold for the 'both' case with a db: active token too
  assert(conn.edges[0]?.direction === 'out', 'T8: edges[0] is out');
  assert(conn.edges[1]?.direction === 'in', 'T8: edges[1] is in');
  console.log('PASS T8: both-direction merge (read+write same store)');
}

// ---------------------------------------------------------------------------
// T9: out edges precede in edges in bundled edges array
// Active = proc:ProcessA; one out edge (to ext:Ext1) and one in edge (from ext:Ext1)
// Checking edges order within the connection to ext:Ext1.
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('proc', 'ProcessA'), ep('ext', 'Ext1'), 'Outgoing data'),  // out
    makeEdge(ep('ext', 'Ext1'), ep('proc', 'ProcessA'), 'Incoming data'),  // in
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'proc:ProcessA');
  assert(result.length === 1, 'T9: 1 connection');
  const conn = result[0] as FlowSpotlightConnection;
  assert(conn.direction === 'both', 'T9: direction both');
  assert(conn.edges.length === 2, 'T9: 2 edges');
  assert((conn.edges[0] as FlowSpotlightEdge).direction === 'out', 'T9: edges[0] is out');
  assert((conn.edges[1] as FlowSpotlightEdge).direction === 'in', 'T9: edges[1] is in');
  console.log('PASS T9: out edges precede in edges in bundle');
}

// ---------------------------------------------------------------------------
// T10: self-edge excluded
// Active = proc:ProcessA; edge from proc:ProcessA → proc:ProcessA (self-loop)
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('proc', 'ProcessA'), ep('proc', 'ProcessA'), 'Self loop'),
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'proc:ProcessA');
  assert(result.length === 0, 'T10: self-edge excluded → []');
  console.log('PASS T10: self-edge excluded');
}

// ---------------------------------------------------------------------------
// T11: sort by otherCardId ascending
// Active = proc:ProcessA; connects to ext:Bravo, db:Alpha (→ 'Alpha'), file:Charlie
// Expected sorted order: 'Alpha', 'ext:Bravo', 'file:Charlie'
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('proc', 'ProcessA'), ep('ext', 'Bravo'), 'B data'),
    makeEdge(ep('proc', 'ProcessA'), ep('db', 'Alpha'), 'A data'),
    makeEdge(ep('proc', 'ProcessA'), ep('file', 'Charlie'), 'C data'),
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'proc:ProcessA');
  assert(result.length === 3, 'T11: 3 connections');
  assert((result[0] as FlowSpotlightConnection).otherCardId === 'Alpha', 'T11: sorted[0] = Alpha (bare)');
  assert((result[1] as FlowSpotlightConnection).otherCardId === 'ext:Bravo', 'T11: sorted[1] = ext:Bravo');
  assert((result[2] as FlowSpotlightConnection).otherCardId === 'file:Charlie', 'T11: sorted[2] = file:Charlie');
  console.log('PASS T11: sort by otherCardId ascending');
}

// ---------------------------------------------------------------------------
// T12: sub-DFD edges included
// Edge lives in a sub-DFD, not the top-level diagram.
// ---------------------------------------------------------------------------
{
  const subEdge = makeEdge(ep('proc', 'SubProcess'), ep('db', 'Invoice'), 'Invoice record');
  const subDfd = makeDiagram('create-invoice', [subEdge]);
  const parentDiagram = makeDiagram('order-to-cash', [], [subDfd]);
  const result = buildFlowSpotlightConnections([parentDiagram], 'proc:SubProcess');
  assert(result.length === 1, 'T12: sub-DFD edge found');
  const conn = result[0] as FlowSpotlightConnection;
  assert(conn.otherCardId === 'Invoice', 'T12: db: sub-DFD resolves to bare id');
  assert(conn.direction === 'out', 'T12: direction out');
  console.log('PASS T12: sub-DFD edges included');
}

// ---------------------------------------------------------------------------
// T13: array data joined with ", "
// FlowEdge.data is string[] → FlowSpotlightEdge.data joins with ", "
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('proc', 'ProcessA'), ep('ext', 'Customer'), ['Order id', 'Total amount', 'Status']),
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'proc:ProcessA');
  assert(result.length === 1, 'T13: 1 connection');
  const e0 = (result[0] as FlowSpotlightConnection).edges[0] as FlowSpotlightEdge;
  assert(e0.data === 'Order id, Total amount, Status', `T13: array joined (got "${e0.data}")`);
  console.log('PASS T13: array data joined with ", "');
}

// ---------------------------------------------------------------------------
// T14: string data passed through unchanged
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('proc', 'ProcessA'), ep('ext', 'Customer'), 'Plain string'),
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'proc:ProcessA');
  const e0 = (result[0] as FlowSpotlightConnection).edges[0] as FlowSpotlightEdge;
  assert(e0.data === 'Plain string', 'T14: string data unchanged');
  console.log('PASS T14: string data passed through unchanged');
}

// ---------------------------------------------------------------------------
// T15: entity card looks up by db:<id> token; entity-to-process connection
// Entity "Order" → flow-lookup token is "db:Order"
// Process proc:Fulfill reads FROM db:Order → direction 'in' for db:Order
// otherCardId = 'proc:Fulfill' (raw, because proc is not db)
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram('dfd', [
    makeEdge(ep('db', 'Order'), ep('proc', 'Fulfill'), 'Order details'),
  ]);
  const result = buildFlowSpotlightConnections([diagram], 'db:Order');
  assert(result.length === 1, 'T15: 1 connection from entity perspective');
  const conn = result[0] as FlowSpotlightConnection;
  assert(conn.otherCardId === 'proc:Fulfill', 'T15: proc other resolves to raw proc:Fulfill');
  assert(conn.direction === 'out', 'T15: db:Order is source → out');
  assert((conn.edges[0] as FlowSpotlightEdge).data === 'Order details', 'T15: data passthrough');
  console.log('PASS T15: entity db: token → proc connection');
}

console.log('\nAll buildFlowSpotlightConnections assertions passed.');
