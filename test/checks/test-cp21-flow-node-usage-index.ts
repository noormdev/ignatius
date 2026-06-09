/**
 * test-cp21-flow-node-usage-index.ts — unit tests for buildFlowNodeUsageIndex (CP21).
 *
 * Asserts that the token-keyed index covers ext:, non-db store, AND db: endpoints,
 * while buildEntityUsageIndex (entity path) is unchanged (regression guard).
 *
 * Covers:
 *   - ext: external node → indexed by "ext:<id>" token
 *   - non-db store (file:) → indexed by "file:<name>" token
 *   - db: entity → indexed by "db:<name>" token (NOT the bare entity id)
 *   - no-usage node → not present in the map
 *   - direction: read / write / readwrite
 *   - sub-DFD recursion: ext/store referenced inside a nested diagram
 *   - regression: buildEntityUsageIndex still returns bare entityId keys for db: endpoints
 */

import { buildFlowNodeUsageIndex, buildEntityUsageIndex, type ProcessUsage } from '../../src/flow-usage-index';
import type { FlowDiagram, FlowProcess, FlowEdge } from '../../src/flow-parse';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function ep(kind: string, name: string) {
  return { kind, name, raw: `${kind}:${name}` } as const;
}

function makeEdge(from: ReturnType<typeof ep>, to: ReturnType<typeof ep>): FlowEdge {
  return { from, to, data: [], flowId: 'test-dfd' } as FlowEdge;
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
  processes: FlowProcess[],
  subDfds: FlowDiagram[] = [],
): FlowDiagram {
  return {
    id,
    title: id,
    processes,
    externals: [],
    storeRefs: [],
    edges: [],
    subDfds,
  };
}

// ---------------------------------------------------------------------------
// Test: ext: external → indexed by "ext:<id>" (read direction)
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Collect-Payment', [
    makeEdge(ep('ext', 'Customer'), ep('proc', 'Collect-Payment')),
  ], []);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildFlowNodeUsageIndex([diagram]);

  const usages = index.get('ext:Customer');
  assert(usages !== undefined && usages.length === 1, 'ext:Customer should have 1 usage');
  assert(usages[0]!.direction === 'read', `direction should be "read" (got "${usages[0]!.direction}")`);
  assert(usages[0]!.processId === 'Collect-Payment', 'processId should match');
  assert(usages[0]!.dfdId === 'order-to-cash', 'dfdId should match');
  // No entry under bare id
  assert(!index.has('Customer'), 'bare "Customer" key should NOT exist — token-keyed only');
  console.log('PASS: ext: external indexed by ext:Customer token (read)');
}

// ---------------------------------------------------------------------------
// Test: ext: external write direction
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Issue-Invoice', [], [
    makeEdge(ep('proc', 'Issue-Invoice'), ep('ext', 'Customer')),
  ]);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildFlowNodeUsageIndex([diagram]);

  const usages = index.get('ext:Customer');
  assert(usages !== undefined && usages.length === 1, 'ext:Customer should have 1 usage (write)');
  assert(usages[0]!.direction === 'write', `direction should be "write" (got "${usages[0]!.direction}")`);
  console.log('PASS: ext: external indexed (write)');
}

// ---------------------------------------------------------------------------
// Test: ext: readwrite — same external in both inputs and outputs
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Collect-Payment', [
    makeEdge(ep('ext', 'Customer'), ep('proc', 'Collect-Payment')),
  ], [
    makeEdge(ep('proc', 'Collect-Payment'), ep('ext', 'Customer')),
  ]);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildFlowNodeUsageIndex([diagram]);

  const usages = index.get('ext:Customer');
  assert(usages !== undefined && usages.length === 1, 'ext:Customer should have 1 deduplicated entry');
  assert(usages[0]!.direction === 'readwrite', `direction should be "readwrite" (got "${usages[0]!.direction}")`);
  console.log('PASS: ext: external readwrite dedup');
}

// ---------------------------------------------------------------------------
// Test: file: store → indexed by "file:<name>"
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Collect-Payment', [], [
    makeEdge(ep('proc', 'Collect-Payment'), ep('file', 'gateway-log')),
  ]);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildFlowNodeUsageIndex([diagram]);

  const usages = index.get('file:gateway-log');
  assert(usages !== undefined && usages.length === 1, 'file:gateway-log should have 1 usage');
  assert(usages[0]!.direction === 'write', `direction should be "write" (got "${usages[0]!.direction}")`);
  assert(usages[0]!.processId === 'Collect-Payment', 'processId should match');
  assert(!index.has('gateway-log'), 'bare "gateway-log" key should NOT exist');
  console.log('PASS: file: store indexed by file:gateway-log token');
}

// ---------------------------------------------------------------------------
// Test: db: entity → indexed by "db:<name>" token in buildFlowNodeUsageIndex
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Collect-Payment', [
    makeEdge(ep('db', 'Payment'), ep('proc', 'Collect-Payment')),
  ], []);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildFlowNodeUsageIndex([diagram]);

  const usages = index.get('db:Payment');
  assert(usages !== undefined && usages.length === 1, 'db:Payment should have 1 usage in node index');
  assert(usages[0]!.direction === 'read', `direction should be "read" (got "${usages[0]!.direction}")`);
  assert(!index.has('Payment'), 'bare "Payment" key should NOT exist in node index');
  console.log('PASS: db: entity indexed by db:Payment token in node index');
}

// ---------------------------------------------------------------------------
// Test: no-usage node → not in map
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Collect-Payment', [
    makeEdge(ep('ext', 'Customer'), ep('proc', 'Collect-Payment')),
  ], []);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildFlowNodeUsageIndex([diagram]);

  assert(!index.has('ext:Supplier'), 'ext:Supplier should not be in map (no usage)');
  assert(!index.has('file:gateway-log'), 'file:gateway-log should not be in map (no usage)');
  console.log('PASS: no-usage node absent from map');
}

// ---------------------------------------------------------------------------
// Test: sub-DFD recursion — ext: referenced inside a nested diagram
// ---------------------------------------------------------------------------
{
  const subProc = makeProcess('Validate-Customer', [
    makeEdge(ep('ext', 'Customer'), ep('proc', 'Validate-Customer')),
  ], [], 'create-sales-order');
  const subDfd = makeDiagram('Create-Sales-Order', [subProc]);
  const parentProc = makeProcess('Create-Sales-Order', [], [], 'order-to-cash');
  const rootDfd = makeDiagram('order-to-cash', [parentProc], [subDfd]);
  const index = buildFlowNodeUsageIndex([rootDfd]);

  const usages = index.get('ext:Customer');
  assert(usages !== undefined && usages.length === 1, 'ext:Customer from sub-DFD should appear');
  assert(usages[0]!.processId === 'Validate-Customer', 'processId should be the sub-DFD process');
  assert(usages[0]!.dfdId === 'Create-Sales-Order', 'dfdId should be the sub-DFD id');
  console.log('PASS: sub-DFD recursion for ext:');
}

// ---------------------------------------------------------------------------
// REGRESSION TEST: buildEntityUsageIndex still keys by bare entityId
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Collect-Payment', [
    makeEdge(ep('db', 'Payment'), ep('proc', 'Collect-Payment')),
    makeEdge(ep('ext', 'Customer'), ep('proc', 'Collect-Payment')),
  ], [
    makeEdge(ep('proc', 'Collect-Payment'), ep('file', 'gateway-log')),
  ]);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const entityIndex = buildEntityUsageIndex([diagram]);

  // Entity index uses bare id "Payment", NOT "db:Payment"
  const entityUsages = entityIndex.get('Payment');
  assert(entityUsages !== undefined && entityUsages.length === 1, 'entity index: Payment should have 1 usage');
  assert(entityUsages[0]!.direction === 'read', 'entity index: direction should be "read"');

  // Entity index does NOT contain ext: or file: tokens
  assert(!entityIndex.has('Customer'), 'entity index: Customer (ext) should be absent');
  assert(!entityIndex.has('ext:Customer'), 'entity index: ext:Customer token should be absent');
  assert(!entityIndex.has('file:gateway-log'), 'entity index: file:gateway-log should be absent');
  assert(!entityIndex.has('gateway-log'), 'entity index: bare gateway-log should be absent');

  console.log('PASS: buildEntityUsageIndex regression — bare entityId keys, ext/store excluded');
}

// ---------------------------------------------------------------------------
// Test: proc: endpoints are NOT indexed (sanity — only non-proc endpoints)
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Collect-Payment', [
    makeEdge(ep('proc', 'Another-Process'), ep('proc', 'Collect-Payment')),
  ], []);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildFlowNodeUsageIndex([diagram]);

  assert(index.size === 0, `proc: endpoints must not be indexed (got size ${index.size})`);
  console.log('PASS: proc: endpoints excluded from node index');
}

console.log('\nAll buildFlowNodeUsageIndex (CP21) assertions passed.');
