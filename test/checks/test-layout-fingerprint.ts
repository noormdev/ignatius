/**
 * test-layout-fingerprint.ts — verifies layoutFingerprint structural sensitivity.
 *
 * Assertions:
 *   - identical topology → identical key
 *   - added node → different key
 *   - removed node → different key
 *   - added edge → different key
 *   - removed edge → different key
 *   - changed edge endpoint → different key
 *   - predicate text change → SAME key (non-structural)
 *   - column change → SAME key (non-structural)
 *   - description/body change → SAME key (non-structural)
 *   - array ordering does NOT affect key (sort proven)
 */

import { layoutFingerprint } from '../../src/layout-fingerprint';
import type { Model, ModelNode, ModelEdge } from '../../src/parse';
import { defaultTheme } from '../../src/theme-defaults';

// Hard assert: exits non-zero on failure so bun run test / CI gates on it.
function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Minimal base model — only fields layoutFingerprint reads + type requirements.
// ---------------------------------------------------------------------------

const minBranding = {
  logo: { dark: '', light: '' },
  title: '',
  subtitle: '',
  copyright: { holder: '', year: 2024 },
  poweredBy: false,
};

function makeNode(id: string): ModelNode {
  return {
    id,
    classification: 'independent',
    pk: ['id'],
    columns: { id: { type: 'uuid' } },
    alternateKeys: [],
    bodyHtml: '',
  };
}

function makeEdge(source: string, target: string): ModelEdge {
  return {
    source,
    target,
    identifying: false,
    on: { [`${source.toLowerCase()}_id`]: 'id' },
    predicate: { fwd: 'has', rev: 'belongs to' },
    cardinality: { parent: '1', child: 'many' },
  };
}

function makeModel(nodes: ModelNode[], edges: ModelEdge[]): Model {
  return {
    groups: {},
    nodes,
    edges,
    subtypeClusters: [],
    theme: defaultTheme,
    branding: minBranding,
  };
}

// ---------------------------------------------------------------------------
// Base topology: two nodes (A, B), one edge A→B
// ---------------------------------------------------------------------------

const nodeA = makeNode('A');
const nodeB = makeNode('B');
const nodeC = makeNode('C');
const edgeAB = makeEdge('A', 'B');
const edgeAC = makeEdge('A', 'C');

const base = makeModel([nodeA, nodeB], [edgeAB]);
const baseKey = layoutFingerprint(base);

// 1. Identical topology → identical key
{
  const same = makeModel([makeNode('A'), makeNode('B')], [makeEdge('A', 'B')]);
  assert(
    layoutFingerprint(same) === baseKey,
    `FAIL: identical topology should give same key (got ${layoutFingerprint(same)} vs ${baseKey})`,
  );
  console.log('PASS: identical topology → identical key');
}

// 2. Added node → different key
{
  const withC = makeModel([nodeA, nodeB, nodeC], [edgeAB]);
  assert(
    layoutFingerprint(withC) !== baseKey,
    'FAIL: added node should give different key',
  );
  console.log('PASS: added node → different key');
}

// 3. Removed node → different key
{
  const onlyA = makeModel([nodeA], []);
  assert(
    layoutFingerprint(onlyA) !== baseKey,
    'FAIL: removed node should give different key',
  );
  console.log('PASS: removed node → different key');
}

// 4. Added edge → different key (3-node base keeps node count fixed; only edge count changes)
{
  const threeNodeOneEdge = makeModel([nodeA, nodeB, nodeC], [edgeAB]);
  const threeNodeTwoEdges = makeModel([nodeA, nodeB, nodeC], [edgeAB, edgeAC]);
  assert(
    layoutFingerprint(threeNodeTwoEdges) !== layoutFingerprint(threeNodeOneEdge),
    'FAIL: added edge should give different key',
  );
  console.log('PASS: added edge → different key');
}

// 5. Removed edge → different key
{
  const noEdge = makeModel([nodeA, nodeB], []);
  assert(
    layoutFingerprint(noEdge) !== baseKey,
    'FAIL: removed edge should give different key',
  );
  console.log('PASS: removed edge → different key');
}

// 6. Changed edge endpoint (source) → different key
{
  const rewired = makeModel([nodeA, nodeB, nodeC], [makeEdge('C', 'B')]);
  const rewiredKey = layoutFingerprint(rewired);
  // compare against a model with same nodes but original edge
  const original = makeModel([nodeA, nodeB, nodeC], [edgeAB]);
  assert(
    rewiredKey !== layoutFingerprint(original),
    'FAIL: changed edge source should give different key',
  );
  console.log('PASS: changed edge source → different key');
}

// 7. Changed edge target → different key
{
  const rewiredTarget = makeModel([nodeA, nodeB, nodeC], [makeEdge('A', 'C')]);
  const sameSource = makeModel([nodeA, nodeB, nodeC], [makeEdge('A', 'B')]);
  assert(
    layoutFingerprint(rewiredTarget) !== layoutFingerprint(sameSource),
    'FAIL: changed edge target should give different key',
  );
  console.log('PASS: changed edge target → different key');
}

// ---------------------------------------------------------------------------
// Invariant assertions — non-structural changes must NOT change the key
// ---------------------------------------------------------------------------

// 8. Predicate text change → SAME key
{
  const diffPredicate = makeModel(
    [makeNode('A'), makeNode('B')],
    [{ ...edgeAB, predicate: { fwd: 'owns', rev: 'is owned by' } }],
  );
  assert(
    layoutFingerprint(diffPredicate) === baseKey,
    `FAIL: predicate text change should not change key (got ${layoutFingerprint(diffPredicate)} vs ${baseKey})`,
  );
  console.log('PASS: predicate text change → same key (invariant)');
}

// 9. Column change → SAME key
{
  const nodeAMoreCols: ModelNode = {
    ...nodeA,
    columns: { id: { type: 'uuid' }, name: { type: 'text' }, email: { type: 'text' } },
    pk: ['id', 'name'],
    alternateKeys: [{ rule: 'ak1', columns: ['email'] }],
  };
  const diffCols = makeModel([nodeAMoreCols, makeNode('B')], [edgeAB]);
  assert(
    layoutFingerprint(diffCols) === baseKey,
    `FAIL: column change should not change key (got ${layoutFingerprint(diffCols)} vs ${baseKey})`,
  );
  console.log('PASS: column / pk / ak change → same key (invariant)');
}

// 10. Description / body change → SAME key
{
  const nodeABody: ModelNode = { ...nodeA, bodyHtml: '<p>A rich business description.</p>' };
  const diffBody = makeModel([nodeABody, makeNode('B')], [edgeAB]);
  assert(
    layoutFingerprint(diffBody) === baseKey,
    `FAIL: body change should not change key (got ${layoutFingerprint(diffBody)} vs ${baseKey})`,
  );
  console.log('PASS: description / body change → same key (invariant)');
}

// 11. Group assignment change → SAME key
{
  const nodeAGroup: ModelNode = { ...nodeA, group: 'billing' };
  const diffGroup = makeModel([nodeAGroup, makeNode('B')], [edgeAB]);
  assert(
    layoutFingerprint(diffGroup) === baseKey,
    `FAIL: group change should not change key (got ${layoutFingerprint(diffGroup)} vs ${baseKey})`,
  );
  console.log('PASS: group assignment change → same key (invariant)');
}

// 12. Theme change → SAME key
{
  const altTheme = {
    ...defaultTheme,
    dark: { ...defaultTheme.dark, background: '#ff0000' },
  };
  const diffTheme = { ...base, theme: altTheme };
  assert(
    layoutFingerprint(diffTheme) === baseKey,
    `FAIL: theme change should not change key (got ${layoutFingerprint(diffTheme)} vs ${baseKey})`,
  );
  console.log('PASS: theme change → same key (invariant)');
}

// ---------------------------------------------------------------------------
// 13. Array ordering does NOT affect the key (sort proven)
// ---------------------------------------------------------------------------
{
  // Nodes reversed
  const nodesReversed = makeModel([nodeB, nodeA], [edgeAB]);
  assert(
    layoutFingerprint(nodesReversed) === baseKey,
    `FAIL: reversed node array should give same key`,
  );
  console.log('PASS: reversed node array → same key (sort proven)');
}

{
  // Add a second edge and test both orders
  const modelAB_AC = makeModel([nodeA, nodeB, nodeC], [edgeAB, edgeAC]);
  const modelAC_AB = makeModel([nodeA, nodeB, nodeC], [edgeAC, edgeAB]);
  assert(
    layoutFingerprint(modelAB_AC) === layoutFingerprint(modelAC_AB),
    'FAIL: edge array order should not affect key',
  );
  console.log('PASS: reversed edge array → same key (sort proven)');
}

console.log('\nAll layout-fingerprint tests passed.');
