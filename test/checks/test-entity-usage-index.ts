/**
 * test-entity-usage-index.ts — unit tests for buildEntityUsageIndex.
 *
 * Verifies the pure usage-index helper that maps entityId → ProcessUsage[]
 * from a flat flow model (all diagrams). Covers:
 *   - read-only (entity appears only in inputs)
 *   - write-only (entity appears only in outputs)
 *   - readwrite (entity appears in both inputs and outputs across one process)
 *   - sub-DFD process (entity referenced inside a nested diagram)
 *   - entity with no usage → empty array / no key in the map
 */

import { buildEntityUsageIndex, type ProcessUsage } from '../../src/flow-usage-index';
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
// Test: read-only (db:Payment appears only in inputs)
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Collect-Payment', [
    makeEdge(ep('db', 'Payment'), ep('proc', 'Collect-Payment')),
  ], []);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildEntityUsageIndex([diagram]);

  const usages = index.get('Payment');
  assert(usages !== undefined && usages.length === 1, 'Payment should have 1 usage');
  assert(usages![0]!.direction === 'read', `direction should be "read" (got "${usages![0]!.direction}")`);
  assert(usages![0]!.processId === 'Collect-Payment', `processId should match`);
  assert(usages![0]!.dfdId === 'order-to-cash', `dfdId should match`);
  console.log('PASS: read-only entity');
}

// ---------------------------------------------------------------------------
// Test: write-only (db:Payment appears only in outputs)
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Collect-Payment', [], [
    makeEdge(ep('proc', 'Collect-Payment'), ep('db', 'Payment')),
  ]);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildEntityUsageIndex([diagram]);

  const usages = index.get('Payment');
  assert(usages !== undefined && usages.length === 1, 'Payment should have 1 usage');
  assert(usages![0]!.direction === 'write', `direction should be "write" (got "${usages![0]!.direction}")`);
  console.log('PASS: write-only entity');
}

// ---------------------------------------------------------------------------
// Test: readwrite (db:Payment in both inputs and outputs of same process)
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Adjust-Payment', [
    makeEdge(ep('db', 'Payment'), ep('proc', 'Adjust-Payment')),
  ], [
    makeEdge(ep('proc', 'Adjust-Payment'), ep('db', 'Payment')),
  ]);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildEntityUsageIndex([diagram]);

  const usages = index.get('Payment');
  assert(usages !== undefined && usages.length === 1, 'Payment should have exactly 1 (deduplicated) usage');
  assert(usages![0]!.direction === 'readwrite', `direction should be "readwrite" (got "${usages![0]!.direction}")`);
  console.log('PASS: readwrite entity');
}

// ---------------------------------------------------------------------------
// Test: sub-DFD process (entity referenced inside a nested diagram)
// ---------------------------------------------------------------------------
{
  const subProc = makeProcess('Record-Order', [
    makeEdge(ep('db', 'SalesOrder'), ep('proc', 'Record-Order')),
  ], [], 'create-sales-order');
  const subDfd = makeDiagram('Create-Sales-Order', [subProc]);
  const parentProc = makeProcess('Create-Sales-Order', [], [], 'order-to-cash');
  const rootDfd = makeDiagram('order-to-cash', [parentProc], [subDfd]);
  const index = buildEntityUsageIndex([rootDfd]);

  const usages = index.get('SalesOrder');
  assert(usages !== undefined && usages.length === 1, 'SalesOrder should have 1 usage from sub-DFD');
  assert(usages![0]!.processId === 'Record-Order', `processId should be sub-DFD process`);
  assert(usages![0]!.dfdId === 'Create-Sales-Order', `dfdId should be the sub-DFD id`);
  console.log('PASS: sub-DFD process');
}

// ---------------------------------------------------------------------------
// Test: entity with no usage → no key in map (or empty array not present)
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Collect-Payment', [], [
    makeEdge(ep('proc', 'Collect-Payment'), ep('db', 'Payment')),
  ]);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildEntityUsageIndex([diagram]);

  const usages = index.get('Party');
  assert(!usages || usages.length === 0, 'Party should have no usages');
  console.log('PASS: entity with no usage');
}

// ---------------------------------------------------------------------------
// Test: non-db endpoints are ignored
// ---------------------------------------------------------------------------
{
  const proc = makeProcess('Collect-Payment', [
    makeEdge(ep('ext', 'Customer'), ep('proc', 'Collect-Payment')),
    makeEdge(ep('cache', 'session-cache'), ep('proc', 'Collect-Payment')),
  ], [
    makeEdge(ep('proc', 'Collect-Payment'), ep('file', 'gateway-log')),
  ]);
  const diagram = makeDiagram('order-to-cash', [proc]);
  const index = buildEntityUsageIndex([diagram]);

  assert(index.size === 0, `non-db endpoints should produce empty map (got size ${index.size})`);
  console.log('PASS: non-db endpoints ignored');
}

// ---------------------------------------------------------------------------
// Test: multiple processes touch same entity → multiple usage entries
// ---------------------------------------------------------------------------
{
  const proc1 = makeProcess('Collect-Payment', [], [
    makeEdge(ep('proc', 'Collect-Payment'), ep('db', 'Payment')),
  ]);
  const proc2 = makeProcess('Issue-Invoice', [
    makeEdge(ep('db', 'Payment'), ep('proc', 'Issue-Invoice')),
  ], []);
  const diagram = makeDiagram('order-to-cash', [proc1, proc2]);
  const index = buildEntityUsageIndex([diagram]);

  const usages = index.get('Payment');
  assert(usages !== undefined && usages.length === 2, `Payment should have 2 usages (got ${usages?.length})`);
  const ids = new Set(usages!.map(u => u.processId));
  assert(ids.has('Collect-Payment'), 'Collect-Payment should be in usages');
  assert(ids.has('Issue-Invoice'), 'Issue-Invoice should be in usages');
  console.log('PASS: multiple processes → multiple entries');
}

console.log('\nAll buildEntityUsageIndex assertions passed.');
