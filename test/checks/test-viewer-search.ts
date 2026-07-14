/**
 * test-viewer-search.ts — unit tests for the Graph/Flows search matchers and
 * the recursive cross-diagram flow walker (CP1 of docs/spec/graph-flow-search.md).
 *
 * CI assertion script (PASS/FAIL/exit-1 style), same idiom as
 * test-flow-spotlight-connections.ts.
 *
 * Covers:
 *   T1  - entityMatches: id title match, case-insensitive substring
 *   T2  - entityMatches: body opt-in (off → no match, on → match), tags stripped
 *   T3  - flowProcessMatches: id/label/dottedNumber title fields
 *   T4  - flowProcessMatches: body opt-in
 *   T5  - flowExternalMatches: id/label title fields + body opt-in
 *   T6  - flowStoreMatches: name/displayName title fields + body opt-in (incl. missing body)
 *   T7  - flowDiagramMatches: id/title fields
 *   T8  - searchFlowDiagrams: recursive sub-DFD coverage
 *   T9  - searchFlowDiagrams: synthetic diagram exclusion (still walks through to leaves)
 *   T10 - searchFlowDiagrams: token construction (proc:/ext:/<kind>: scheme)
 *   T11 - searchFlowDiagrams: per-diagram grouping/ordering (parent before child;
 *         diagram title, then processes, externals, stores within a diagram)
 *   T12 - searchFlowDiagrams: process result carries dottedNumber; external/store do not
 */

import {
  entityMatches,
  flowProcessMatches,
  flowExternalMatches,
  flowStoreMatches,
  flowDiagramMatches,
  searchFlowDiagrams,
  type FlowSearchResult,
} from '../../src/app/logic/search';
import type { ModelNode } from '../../src/model/parse';
import type {
  FlowDiagram,
  FlowProcess,
  FlowExternal,
  FlowStoreRef,
} from '../../src/flows/flow-parse';
import { SYNTHETIC_DIAGRAM_IDS, CONTEXT_DIAGRAM_ID, SYSTEM_PROCESS_ID } from '../../src/flows/flow-derive-levels';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, bodyHtml = ''): ModelNode {
  return {
    id,
    classification: 'Independent',
    pk: ['id'],
    columns: {},
    alternateKeys: [],
    bodyHtml,
  };
}

function makeProcess(overrides: Partial<FlowProcess> & { id: string }): FlowProcess {
  return {
    label: overrides.id,
    dottedNumber: '1',
    inputs: [],
    outputs: [],
    body: '',
    bodyHtml: '',
    hasSubDfd: false,
    flowId: 'dfd',
    ...overrides,
  };
}

function makeExternal(overrides: Partial<FlowExternal> & { id: string }): FlowExternal {
  return {
    label: overrides.id,
    body: '',
    bodyHtml: '',
    flowId: 'dfd',
    ...overrides,
  };
}

function makeStore(overrides: Partial<FlowStoreRef> & { name: string }): FlowStoreRef {
  return {
    kind: 'db',
    displayName: overrides.name,
    flowId: 'dfd',
    ...overrides,
  };
}

function makeDiagram(overrides: Partial<FlowDiagram> & { id: string }): FlowDiagram {
  return {
    title: overrides.id,
    processes: [],
    externals: [],
    storeRefs: [],
    edges: [],
    subDfds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T1: entityMatches — id title match, case-insensitive substring
// ---------------------------------------------------------------------------
{
  const node = makeNode('Customer');
  assert(entityMatches(node, 'custom', false) === true, 'T1: substring match on id');
  assert(entityMatches(node, 'CUSTOM', false) === true, 'T1: case-insensitive');
  assert(entityMatches(node, 'zzz', false) === false, 'T1: no match → false');
  console.log('PASS T1: entityMatches id title match');
}

// ---------------------------------------------------------------------------
// T2: entityMatches — body opt-in, tags stripped
// ---------------------------------------------------------------------------
{
  const node = makeNode('Order', '<p>contains a <b>refund</b> clause</p>');
  assert(entityMatches(node, 'refund', false) === false, 'T2: body off → no match');
  assert(entityMatches(node, 'refund', true) === true, 'T2: body on → match');
  assert(entityMatches(node, '<b>', true) === false, 'T2: html tags stripped before matching');
  console.log('PASS T2: entityMatches body opt-in, tags stripped');
}

// ---------------------------------------------------------------------------
// T3: flowProcessMatches — id/label/dottedNumber title fields
// ---------------------------------------------------------------------------
{
  const byId = makeProcess({ id: 'ValidateOrder', label: 'Validate the Order', dottedNumber: '3.2' });
  assert(flowProcessMatches(byId, 'validateorder', false) === true, 'T3: id match');
  assert(flowProcessMatches(byId, 'validate the', false) === true, 'T3: label match');
  assert(flowProcessMatches(byId, '3.2', false) === true, 'T3: dottedNumber match');
  assert(flowProcessMatches(byId, 'nope', false) === false, 'T3: no match → false');
  console.log('PASS T3: flowProcessMatches title fields');
}

// ---------------------------------------------------------------------------
// T4: flowProcessMatches — body opt-in
// ---------------------------------------------------------------------------
{
  const proc = makeProcess({ id: 'ProcessRefund', body: 'issues a refund to the customer' });
  assert(flowProcessMatches(proc, 'issues a refund', false) === false, 'T4: body off → no match');
  assert(flowProcessMatches(proc, 'issues a refund', true) === true, 'T4: body on → match');
  console.log('PASS T4: flowProcessMatches body opt-in');
}

// ---------------------------------------------------------------------------
// T5: flowExternalMatches — id/label title fields + body opt-in
// ---------------------------------------------------------------------------
{
  const ext = makeExternal({ id: 'PaymentGateway', label: 'Payment Gateway', body: 'charges the card' });
  assert(flowExternalMatches(ext, 'paymentgateway', false) === true, 'T5: id match');
  assert(flowExternalMatches(ext, 'gateway', false) === true, 'T5: label match');
  assert(flowExternalMatches(ext, 'charges', false) === false, 'T5: body off → no match');
  assert(flowExternalMatches(ext, 'charges', true) === true, 'T5: body on → match');
  console.log('PASS T5: flowExternalMatches title + body');
}

// ---------------------------------------------------------------------------
// T6: flowStoreMatches — name/displayName title fields + body opt-in (incl. missing body)
// ---------------------------------------------------------------------------
{
  const store = makeStore({ name: 'orders-db', displayName: 'Orders Database', body: 'stores order rows' });
  assert(flowStoreMatches(store, 'orders-db', false) === true, 'T6: name match');
  assert(flowStoreMatches(store, 'orders database', false) === true, 'T6: displayName match');
  assert(flowStoreMatches(store, 'order rows', false) === false, 'T6: body off → no match');
  assert(flowStoreMatches(store, 'order rows', true) === true, 'T6: body on → match');

  const storeNoBody = makeStore({ name: 'cache-1' });
  assert(flowStoreMatches(storeNoBody, 'anything', true) === false, 'T6: missing body never throws / never matches');
  console.log('PASS T6: flowStoreMatches title + body, missing body safe');
}

// ---------------------------------------------------------------------------
// T7: flowDiagramMatches — id/title fields
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram({ id: 'order-to-cash', title: 'Order To Cash' });
  assert(flowDiagramMatches(diagram, 'order-to-cash') === true, 'T7: id match');
  assert(flowDiagramMatches(diagram, 'to cash') === true, 'T7: title match');
  assert(flowDiagramMatches(diagram, 'nope') === false, 'T7: no match → false');
  console.log('PASS T7: flowDiagramMatches id/title');
}

// ---------------------------------------------------------------------------
// T8: searchFlowDiagrams — recursive sub-DFD coverage
// ---------------------------------------------------------------------------
{
  const subDfd = makeDiagram({
    id: 'create-invoice',
    title: 'Create Invoice',
    processes: [makeProcess({ id: 'SendInvoice', label: 'Send Invoice', dottedNumber: '3.1.1' })],
  });
  const parent = makeDiagram({
    id: 'order-to-cash',
    title: 'Order To Cash',
    processes: [makeProcess({ id: 'CreateInvoice', label: 'Create Invoice', dottedNumber: '3.1', hasSubDfd: true })],
    subDfds: [subDfd],
  });
  const results: FlowSearchResult[] = searchFlowDiagrams([parent], 'invoice', false);
  const labels = results.map(r => r.label);
  assert(labels.includes('Create Invoice'), 'T8: parent-level process found');
  assert(labels.includes('Send Invoice'), 'T8: sub-DFD process found (recursive walk)');
  console.log('PASS T8: searchFlowDiagrams recursive sub-DFD coverage');
}

// ---------------------------------------------------------------------------
// T9: searchFlowDiagrams — synthetic diagram exclusion (still walks through)
// ---------------------------------------------------------------------------
{
  const leaf = makeDiagram({
    id: 'order-to-cash',
    title: 'Order To Cash',
    processes: [makeProcess({ id: 'ValidateOrder', label: 'Validate Order', dottedNumber: '1' })],
  });
  const l1 = makeDiagram({
    id: SYSTEM_PROCESS_ID,
    title: 'System',
    processes: [makeProcess({ id: 'order-to-cash', label: 'Validate Order copy', dottedNumber: '1' })],
    subDfds: [leaf],
  });
  const context = makeDiagram({
    id: CONTEXT_DIAGRAM_ID,
    title: 'Context',
    processes: [makeProcess({ id: SYSTEM_PROCESS_ID, label: 'Validate Order copy', dottedNumber: '0' })],
    subDfds: [l1],
  });
  assert(SYNTHETIC_DIAGRAM_IDS.has(CONTEXT_DIAGRAM_ID) && SYNTHETIC_DIAGRAM_IDS.has(SYSTEM_PROCESS_ID), 'T9: sanity — ids are synthetic');

  const results = searchFlowDiagrams([context], 'validate order', false);
  assert(results.length === 1, `T9: only the leaf-diagram match survives (got ${results.length})`);
  assert(results[0]?.diagramId === 'order-to-cash', 'T9: surviving match is owned by the leaf diagram, not context/L1');
  console.log('PASS T9: searchFlowDiagrams synthetic exclusion, still walks to leaves');
}

// ---------------------------------------------------------------------------
// T10: searchFlowDiagrams — token construction (proc:/ext:/<kind>: scheme)
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram({
    id: 'order-to-cash',
    title: 'Order To Cash',
    processes: [makeProcess({ id: 'ValidateOrder', label: 'Validate Order' })],
    externals: [makeExternal({ id: 'Customer', label: 'Customer' })],
    storeRefs: [makeStore({ kind: 'cache', name: 'orders-cache', displayName: 'Orders Cache' })],
  });
  const all = searchFlowDiagrams([diagram], '', false); // empty term → substring-matches everything
  const proc = all.find(r => r.kind === 'process');
  const ext = all.find(r => r.kind === 'external');
  const store = all.find(r => r.kind === 'store');
  assert(proc?.token === 'proc:ValidateOrder', `T10: process token is proc:<id> (got ${proc?.token})`);
  assert(ext?.token === 'ext:Customer', `T10: external token is ext:<id> (got ${ext?.token})`);
  assert(store?.token === 'cache:orders-cache', `T10: store token is <kind>:<name> (got ${store?.token})`);
  console.log('PASS T10: searchFlowDiagrams token construction');
}

// ---------------------------------------------------------------------------
// T11: searchFlowDiagrams — per-diagram grouping/ordering
// Parent diagram (with a title match, a process match, an external match, a
// store match) precedes its sub-DFD in the result list; within the parent
// diagram, the diagram-title row precedes process rows, which precede
// external rows, which precede store rows — the diagram's authored order.
// ---------------------------------------------------------------------------
{
  const subDfd = makeDiagram({
    id: 'sub-flow',
    title: 'Sub Flow',
    processes: [makeProcess({ id: 'InnerProcess', label: 'Inner Process' })],
  });
  const parent = makeDiagram({
    id: 'main-flow',
    title: 'Main Flow',
    processes: [makeProcess({ id: 'OuterProcess', label: 'Outer Process' })],
    externals: [makeExternal({ id: 'OuterExternal', label: 'Outer External' })],
    storeRefs: [makeStore({ name: 'outer-store', displayName: 'Outer Store' })],
    subDfds: [subDfd],
  });
  const results = searchFlowDiagrams([parent], 'outer', false);
  // All 4 "outer" matches (diagram title itself is "Main Flow" — no "outer" —
  // so only process/external/store match here) must precede the sub-DFD walk.
  assert(results.length === 3, `T11: 3 "outer" matches in the parent diagram (got ${results.length})`);
  assert(results[0]?.kind === 'process', 'T11: process rows precede external rows');
  assert(results[1]?.kind === 'external', 'T11: external rows precede store rows');
  assert(results[2]?.kind === 'store', 'T11: store rows last within a diagram');
  assert(results.every(r => r.diagramId === 'main-flow'), 'T11: all rows owned by the parent diagram');

  const titleResults = searchFlowDiagrams([parent], 'main flow', false);
  assert(titleResults.length === 1 && titleResults[0]?.kind === 'diagram', 'T11: diagram-title match produces a diagram-kind row');

  const grouped = searchFlowDiagrams([parent], 'process', false);
  assert(grouped.length === 2, `T11: parent + sub-DFD process both match "process" (got ${grouped.length})`);
  assert(grouped[0]?.diagramId === 'main-flow', 'T11: parent diagram group precedes sub-DFD group');
  assert(grouped[1]?.diagramId === 'sub-flow', 'T11: sub-DFD group follows parent group');
  console.log('PASS T11: searchFlowDiagrams per-diagram grouping/ordering');
}

// ---------------------------------------------------------------------------
// T12: searchFlowDiagrams — dottedNumber only on process results
// ---------------------------------------------------------------------------
{
  const diagram = makeDiagram({
    id: 'order-to-cash',
    title: 'Order To Cash',
    processes: [makeProcess({ id: 'MatchTerm', label: 'Match Term', dottedNumber: '2.4' })],
    externals: [makeExternal({ id: 'MatchTermExt', label: 'Match Term Ext' })],
    storeRefs: [makeStore({ name: 'match-term-store', displayName: 'Match Term Store' })],
  });
  const results = searchFlowDiagrams([diagram], 'match term', false);
  const proc = results.find(r => r.kind === 'process');
  const ext = results.find(r => r.kind === 'external');
  const store = results.find(r => r.kind === 'store');
  assert(proc?.dottedNumber === '2.4', 'T12: process result carries dottedNumber');
  assert(ext?.dottedNumber === undefined, 'T12: external result has no dottedNumber');
  assert(store?.dottedNumber === undefined, 'T12: store result has no dottedNumber');
  console.log('PASS T12: dottedNumber only present on process results');
}

console.log('\nAll viewer search assertions passed.');
