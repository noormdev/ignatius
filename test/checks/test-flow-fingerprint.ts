/**
 * test-flow-fingerprint.ts — verifies layoutFlowFingerprint structural sensitivity
 * and the separate-key contract for flow vs ERD position stores.
 *
 * Assertions:
 *   1. Identical diagram topology → identical key.
 *   2. Adding a process → different key.
 *   3. Removing a process → different key.
 *   4. Adding an external → different key.
 *   5. Adding a store ref → different key.
 *   6. Adding a flow edge → different key.
 *   7. Removing a flow edge → different key.
 *   8. Changing process label → SAME key (non-structural).
 *   9. Changing process body → SAME key (non-structural).
 *   10. Changing data (column list) → SAME key (non-structural).
 *   11. Changing local number → SAME key (non-structural).
 *   12. Two endpoint spellings resolving to same kind:name → SAME key.
 *   13. Two different diagrams → different keys (distinct structural topology).
 *   14. Separate-key proof: flow store writes under FLOW_KEY, ERD store writes
 *       under ERD default — they never share bucket entries in the same storage.
 */

import { layoutFlowFingerprint } from '../../src/flows/flow-fingerprint';
import { createLayoutStore } from '../../src/app/views/graph/layout-store';
import type { FlowDiagram, FlowProcess, FlowExternal, FlowStoreRef, FlowEdge, FlowEndpoint } from '../../src/flows/flow-parse';
import type { StorageLike, PositionMap } from '../../src/app/views/graph/layout-store';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEndpoint(kind: FlowEndpoint['kind'], name: string): FlowEndpoint {
  return { kind, name, raw: `${kind}:${name}` };
}

function makeEdge(fromKind: FlowEndpoint['kind'], fromName: string, toKind: FlowEndpoint['kind'], toName: string, flowId = 'checkout'): FlowEdge {
  return {
    from: makeEndpoint(fromKind, fromName),
    to: makeEndpoint(toKind, toName),
    data: [],
    flowId,
  };
}

function makeProcess(id: string, flowId = 'checkout'): FlowProcess {
  return {
    id,
    label: `Label for ${id}`,
    number: 1,
    dottedNumber: '1',
    inputs: [],
    outputs: [],
    body: '',
    bodyHtml: '',
    hasSubDfd: false,
    flowId,
  };
}

function makeExternal(id: string, flowId = 'checkout'): FlowExternal {
  return {
    id,
    label: `External ${id}`,
    body: '',
    bodyHtml: '',
    flowId,
  };
}

function makeStoreRef(kind: FlowStoreRef['kind'], name: string, flowId = 'checkout'): FlowStoreRef {
  return { kind, name, displayName: name, flowId };
}

function makeDiagram(overrides: Partial<FlowDiagram> = {}): FlowDiagram {
  return {
    id: 'checkout',
    title: 'Checkout',
    processes: [makeProcess('PlaceOrder'), makeProcess('ValidateCart')],
    externals: [makeExternal('Shopper')],
    storeRefs: [makeStoreRef('db', 'Order')],
    edges: [
      makeEdge('ext', 'Shopper', 'proc', 'PlaceOrder'),
      makeEdge('proc', 'PlaceOrder', 'db', 'Order'),
    ],
    subDfds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Identical topology → identical key
// ---------------------------------------------------------------------------

{
  const d1 = makeDiagram();
  const d2 = makeDiagram();
  const k1 = layoutFlowFingerprint(d1);
  const k2 = layoutFlowFingerprint(d2);
  assert(k1 === k2, `FAIL: identical diagrams produced different keys: ${k1} vs ${k2}`);
  console.log('PASS: identical topology yields identical key');
}

// ---------------------------------------------------------------------------
// 2. Adding a process → different key
// ---------------------------------------------------------------------------

{
  const base = makeDiagram();
  const withExtra = makeDiagram({
    processes: [...base.processes, makeProcess('ExtraProcess')],
  });
  const k1 = layoutFlowFingerprint(base);
  const k2 = layoutFlowFingerprint(withExtra);
  assert(k1 !== k2, 'FAIL: adding a process should change the key');
  console.log('PASS: adding a process changes the key');
}

// ---------------------------------------------------------------------------
// 3. Removing a process → different key
// ---------------------------------------------------------------------------

{
  const base = makeDiagram();
  const withFewer = makeDiagram({
    processes: base.processes.slice(0, 1),
  });
  const k1 = layoutFlowFingerprint(base);
  const k2 = layoutFlowFingerprint(withFewer);
  assert(k1 !== k2, 'FAIL: removing a process should change the key');
  console.log('PASS: removing a process changes the key');
}

// ---------------------------------------------------------------------------
// 4. Adding an external → different key
// ---------------------------------------------------------------------------

{
  const base = makeDiagram();
  const withExtra = makeDiagram({
    externals: [...base.externals, makeExternal('AnotherExternal')],
  });
  const k1 = layoutFlowFingerprint(base);
  const k2 = layoutFlowFingerprint(withExtra);
  assert(k1 !== k2, 'FAIL: adding an external should change the key');
  console.log('PASS: adding an external changes the key');
}

// ---------------------------------------------------------------------------
// 5. Adding a store ref → different key
// ---------------------------------------------------------------------------

{
  const base = makeDiagram();
  const withExtra = makeDiagram({
    storeRefs: [...base.storeRefs, makeStoreRef('cache', 'Sessions')],
  });
  const k1 = layoutFlowFingerprint(base);
  const k2 = layoutFlowFingerprint(withExtra);
  assert(k1 !== k2, 'FAIL: adding a store ref should change the key');
  console.log('PASS: adding a store ref changes the key');
}

// ---------------------------------------------------------------------------
// 6. Adding a flow edge → different key
// ---------------------------------------------------------------------------

{
  const base = makeDiagram();
  const withExtra = makeDiagram({
    edges: [...base.edges, makeEdge('proc', 'ValidateCart', 'db', 'Order')],
  });
  const k1 = layoutFlowFingerprint(base);
  const k2 = layoutFlowFingerprint(withExtra);
  assert(k1 !== k2, 'FAIL: adding a flow edge should change the key');
  console.log('PASS: adding a flow edge changes the key');
}

// ---------------------------------------------------------------------------
// 7. Removing a flow edge → different key
// ---------------------------------------------------------------------------

{
  const base = makeDiagram();
  const withFewer = makeDiagram({
    edges: base.edges.slice(0, 1),
  });
  const k1 = layoutFlowFingerprint(base);
  const k2 = layoutFlowFingerprint(withFewer);
  assert(k1 !== k2, 'FAIL: removing a flow edge should change the key');
  console.log('PASS: removing a flow edge changes the key');
}

// ---------------------------------------------------------------------------
// 8. Changing process label → SAME key (non-structural)
// ---------------------------------------------------------------------------

{
  const base = makeDiagram();
  const withNewLabel = makeDiagram({
    processes: base.processes.map((p, i) =>
      i === 0 ? { ...p, label: 'Completely Different Label' } : p
    ),
  });
  const k1 = layoutFlowFingerprint(base);
  const k2 = layoutFlowFingerprint(withNewLabel);
  assert(k1 === k2, `FAIL: label change should NOT change the key: ${k1} vs ${k2}`);
  console.log('PASS: label change leaves key stable');
}

// ---------------------------------------------------------------------------
// 9. Changing process body → SAME key (non-structural)
// ---------------------------------------------------------------------------

{
  const base = makeDiagram();
  const withBody = makeDiagram({
    processes: base.processes.map((p, i) =>
      i === 0 ? { ...p, body: '## New body\n\nSome narrative.', bodyHtml: '<h2>New body</h2><p>Some narrative.</p>' } : p
    ),
  });
  const k1 = layoutFlowFingerprint(base);
  const k2 = layoutFlowFingerprint(withBody);
  assert(k1 === k2, `FAIL: body change should NOT change the key: ${k1} vs ${k2}`);
  console.log('PASS: body change leaves key stable');
}

// ---------------------------------------------------------------------------
// 10. Changing data (column list) → SAME key (non-structural)
// ---------------------------------------------------------------------------

{
  const base = makeDiagram();
  const withDifferentData = makeDiagram({
    edges: base.edges.map((e, i) =>
      i === 1 ? { ...e, data: ['orderId', 'customerId', 'amount'] } : e
    ),
  });
  const k1 = layoutFlowFingerprint(base);
  const k2 = layoutFlowFingerprint(withDifferentData);
  assert(k1 === k2, `FAIL: data/column change should NOT change the key: ${k1} vs ${k2}`);
  console.log('PASS: data/column change leaves key stable');
}

// ---------------------------------------------------------------------------
// 11. Changing local number → SAME key (non-structural)
// ---------------------------------------------------------------------------

{
  const base = makeDiagram();
  const withDifferentNumber = makeDiagram({
    processes: base.processes.map((p, i) =>
      i === 0 ? { ...p, number: 99, dottedNumber: '99' } : p
    ),
  });
  const k1 = layoutFlowFingerprint(base);
  const k2 = layoutFlowFingerprint(withDifferentNumber);
  assert(k1 === k2, `FAIL: local number change should NOT change the key: ${k1} vs ${k2}`);
  console.log('PASS: local/composed number change leaves key stable');
}

// ---------------------------------------------------------------------------
// 12. Two endpoint spellings resolving to same kind:name → SAME key
//
// The spec says resolved kind:name pairs are used, not raw authored strings.
// We simulate this: two edges with different raw values but the same resolved
// from.kind/from.name and to.kind/to.name must hash identically.
// ---------------------------------------------------------------------------

{
  const edgeSpellingA: FlowEdge = {
    from: { kind: 'ext', name: 'Shopper', raw: 'Shopper' },          // bare name → resolved as ext:Shopper
    to:   { kind: 'proc', name: 'PlaceOrder', raw: 'PlaceOrder' },    // bare name → resolved as proc:PlaceOrder
    data: [],
    flowId: 'checkout',
  };
  const edgeSpellingB: FlowEdge = {
    from: { kind: 'ext', name: 'Shopper', raw: 'ext:Shopper' },       // qualified → same resolved form
    to:   { kind: 'proc', name: 'PlaceOrder', raw: 'proc:PlaceOrder' },
    data: [],
    flowId: 'checkout',
  };

  const d1 = makeDiagram({ edges: [edgeSpellingA] });
  const d2 = makeDiagram({ edges: [edgeSpellingB] });

  const k1 = layoutFlowFingerprint(d1);
  const k2 = layoutFlowFingerprint(d2);
  assert(k1 === k2, `FAIL: same resolved kind:name should yield same key; raw strings differ but kind+name are equal. k1=${k1} k2=${k2}`);
  console.log('PASS: two endpoint spellings that resolve to same kind:name yield the same key');
}

// ---------------------------------------------------------------------------
// 13. Two different diagrams → different keys
// ---------------------------------------------------------------------------

{
  const d1 = makeDiagram({ id: 'checkout' });
  const d2 = makeDiagram({
    id: 'returns',
    processes: [makeProcess('InitReturn', 'returns')],
    externals: [makeExternal('Customer', 'returns')],
    storeRefs: [makeStoreRef('db', 'ReturnRequest', 'returns')],
    edges: [makeEdge('ext', 'Customer', 'proc', 'InitReturn', 'returns')],
  });
  const k1 = layoutFlowFingerprint(d1);
  const k2 = layoutFlowFingerprint(d2);
  assert(k1 !== k2, `FAIL: two different diagrams should produce different keys: ${k1} vs ${k2}`);
  console.log('PASS: two different diagrams produce different keys');
}

// ---------------------------------------------------------------------------
// 14. Separate-key proof: flow store and ERD store never share bucket entries
//
// Concrete proof of the "separate buckets per surface" decision:
//   - create a single in-memory storage instance (shared backing)
//   - create a flow store pointing at FLOW_KEY
//   - create an ERD store (default key)
//   - save positions via the flow store
//   - assert the ERD key bucket is empty (the flow save never wrote there)
//   - save positions via the ERD store
//   - assert the flow key bucket is unaffected by the ERD save
// ---------------------------------------------------------------------------

{
  const FLOW_KEY = 'ignatius-flow-layout-positions';
  const ERD_KEY  = 'ignatius-layout-positions';       // the default key

  // A single shared in-memory storage — both stores talk to the same backing store.
  function makeStorage(): StorageLike {
    const map = new Map<string, string>();
    return {
      getItem:    (k: string) => map.get(k) ?? null,
      setItem:    (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    };
  }
  const sharedStorage = makeStorage();

  // Flow store: distinct key
  const flowStore = createLayoutStore(sharedStorage, undefined, FLOW_KEY);
  // ERD store: default key (no third argument)
  const erdStore  = createLayoutStore(sharedStorage);

  const flowPositions: PositionMap = { PlaceOrder: { x: 100, y: 200 } };
  const erdPositions: PositionMap  = { Order:      { x:  50, y: 150 } };

  // Save under the flow store.
  flowStore.save('layout-abc', flowPositions);

  // The ERD bucket must be untouched.
  const erdRaw = sharedStorage.getItem(ERD_KEY);
  assert(
    erdRaw === null,
    `FAIL: saving flow positions mutated the ERD bucket. ERD bucket: ${erdRaw}`,
  );

  // Now save under the ERD store.
  erdStore.save('layout-xyz', erdPositions);

  // The flow store must still read its own entry without contamination.
  const loadedFlow = flowStore.load('layout-abc');
  assert(loadedFlow !== null, 'FAIL: flow entry disappeared after ERD save');
  assert(
    loadedFlow['PlaceOrder']?.x === 100,
    `FAIL: flow entry corrupted — expected x=100, got ${loadedFlow['PlaceOrder']?.x}`,
  );

  // The ERD store must only see its own entry.
  const loadedErd = erdStore.load('layout-xyz');
  assert(loadedErd !== null, 'FAIL: ERD entry not found');
  assert(
    loadedErd['Order']?.x === 50,
    `FAIL: ERD entry corrupted — expected x=50, got ${loadedErd['Order']?.x}`,
  );

  // And the flow store must NOT see the ERD key's entry.
  const crossLoad = flowStore.load('layout-xyz');
  assert(
    crossLoad === null,
    `FAIL: flow store can read ERD store entries — keys are not isolated. got: ${JSON.stringify(crossLoad)}`,
  );

  console.log('PASS: flow store and ERD store write to distinct localStorage buckets — keys are fully isolated');
}

console.log('\nAll flow-fingerprint tests passed.');
