/**
 * test-edge-hover-data.ts — unit tests for normalizeEdgeData and the
 * dataLines field wired by buildFlowData.
 *
 * Proves:
 *  - normalizeEdgeData: array passthrough, string split, empty/undefined → [],
 *    and single-item string.
 *  - buildFlowData: edge elements carry dataLines matching normalizeEdgeData
 *    for both string[] and string edge.data values.
 */

import { normalizeEdgeData, buildFlowData } from '../../src/flow-view/flow-layout';
import type { FlowDiagram, FlowEdge, FlowEndpoint, FlowProcess, FlowStoreRef } from '../../src/flows/flow-parse';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ── normalizeEdgeData ─────────────────────────────────────────────────────────

// Array passthrough — order preserved, no splitting
const arr = normalizeEdgeData(['a', 'b', 'c']);
assert(arraysEqual(arr, ['a', 'b', 'c']), `array passthrough: expected ['a','b','c'], got [${arr}]`);
console.log('PASS: normalizeEdgeData — array passthrough');

// String split on ", " (comma-space)
const split = normalizeEdgeData('id, name, email');
assert(arraysEqual(split, ['id', 'name', 'email']), `string split: expected ['id','name','email'], got [${split}]`);
console.log('PASS: normalizeEdgeData — string split on ", "');

// Single-item string (no separator present)
const single = normalizeEdgeData('single');
assert(arraysEqual(single, ['single']), `single-item string: expected ['single'], got [${single}]`);
console.log('PASS: normalizeEdgeData — single-item string');

// Empty string → []
const empty = normalizeEdgeData('');
assert(arraysEqual(empty, []), `empty string: expected [], got [${empty}]`);
console.log('PASS: normalizeEdgeData — empty string → []');

// undefined → []
const undef = normalizeEdgeData(undefined);
assert(arraysEqual(undef, []), `undefined: expected [], got [${undef}]`);
console.log('PASS: normalizeEdgeData — undefined → []');

// ── buildFlowData — dataLines wiring ─────────────────────────────────────────

// Minimal valid FlowDiagram with two edges:
//   edge0: data is string[] (array form)
//   edge1: data is string (joined form)

const procEndpoint: FlowEndpoint = { kind: 'proc', name: 'p1', raw: 'proc:p1' };
const storeEndpointRead: FlowEndpoint = { kind: 'db', name: 'orders', raw: 'db:orders' };
const storeEndpointWrite: FlowEndpoint = { kind: 'db', name: 'payments', raw: 'db:payments' };

const edge0: FlowEdge = {
  from: procEndpoint,
  to: storeEndpointWrite,
  data: ['order_id', 'amount', 'status'],
  flowId: 'f0',
};

const edge1: FlowEdge = {
  from: storeEndpointRead,
  to: procEndpoint,
  data: 'customer_id, total',
  flowId: 'f1',
};

const process1: FlowProcess = {
  id: 'p1',
  label: 'Process 1',
  dottedNumber: '1',
  inputs: [edge1],
  outputs: [edge0],
  body: '',
  bodyHtml: '',
  hasSubDfd: false,
  flowId: 'test-diagram',
};

const storeOrders: FlowStoreRef = {
  kind: 'db',
  name: 'orders',
  displayName: 'Orders',
  flowId: 'test-diagram',
};

const storePayments: FlowStoreRef = {
  kind: 'db',
  name: 'payments',
  displayName: 'Payments',
  flowId: 'test-diagram',
};

const diagram: FlowDiagram = {
  id: 'test-diagram',
  title: 'Test Diagram',
  processes: [process1],
  externals: [],
  storeRefs: [storeOrders, storePayments],
  edges: [edge0, edge1],
  subDfds: [],
};

const { edges } = buildFlowData(diagram);

// Find the two edges by their data shape
// edge0 had data: string[] → dataLines should be ['order_id','amount','status']
// edge1 had data: string   → dataLines should be ['customer_id','total']
const expectedForEdge0 = normalizeEdgeData(edge0.data);
const expectedForEdge1 = normalizeEdgeData(edge1.data);

assert(
  edges.length === 2,
  `expected 2 edge elements, got ${edges.length}`,
);
console.log('PASS: buildFlowData — produces 2 edges');

// Both edges must have a dataLines field
for (const e of edges) {
  assert(
    Array.isArray(e.dataLines),
    `edge ${e.id} missing dataLines field (or not an array)`,
  );
}
console.log('PASS: buildFlowData — all edge elements have dataLines array');

// Verify each edge's dataLines matches normalizeEdgeData(edge.data) for the original input.
// We identify which diagram edge each output edge corresponds to by index (same loop order).
const e0 = edges[0];
const e1 = edges[1];
assert(e0 !== undefined && e1 !== undefined, 'buildFlowData should produce two indexed edge elements');

assert(
  arraysEqual(e0.dataLines, expectedForEdge0),
  `edge0 dataLines: expected [${expectedForEdge0}], got [${e0.dataLines}]`,
);
console.log('PASS: buildFlowData — edge0 dataLines matches normalizeEdgeData(string[])');

assert(
  arraysEqual(e1.dataLines, expectedForEdge1),
  `edge1 dataLines: expected [${expectedForEdge1}], got [${e1.dataLines}]`,
);
console.log('PASS: buildFlowData — edge1 dataLines matches normalizeEdgeData(string)');

// label field is still the joined string (unchanged)
assert(
  e0.label === 'order_id, amount, status',
  `edge0 label unchanged: expected "order_id, amount, status", got "${e0.label}"`,
);
assert(
  e1.label === 'customer_id, total',
  `edge1 label unchanged: expected "customer_id, total", got "${e1.label}"`,
);
console.log('PASS: buildFlowData — label field still the joined string');

console.log('\nAll test-edge-hover-data assertions passed.');
