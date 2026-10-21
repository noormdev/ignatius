/**
 * test-tree-layout.ts — the Tree layout reads like an outline: each table sits
 * below and to the right of the table whose key it inherits, and every line
 * drops down its own lane before turning right into its child.
 *
 * Coverage:
 *   1. A table hangs under its identifying parent; among several, the deepest
 *      wins, then the id.
 *   2. Without an identifying parent, a non-classifier FK parent is used; a
 *      classifier is never chosen as a parent while another exists.
 *   3. A root with no children of its own that a table references (a lookup)
 *      is never hung under that table; it sits above its tree, and a lookup
 *      used only by another lookup stays a root.
 *   4. Children sit right of their parent and below it, smaller subtrees
 *      first; no two boxes overlap, across separate trees too.
 *   5. Lanes nest: the lower a child's row, the further left its lane, so no
 *      horizontal run crosses a sibling's lane; the run is long enough for the label.
 *   6. A wide key parent's children wrap into columns to its right, each
 *      starting a row below the parent's bottom edge, only where a fresh column
 *      has room for two rows; lookup lines into wrapped tables are cross links.
 *   7. A subtype joiner never leaves its basetype, and goes first when its
 *      siblings wrap.
 *   8. Every drawn line leaves its parent's bottom edge and enters its child's
 *      left side, right-angled, including a tree line redrawn as a cross link.
 *   9. Lines into one child never cross on its left side; cross links from one
 *      parent each get their own lane and street.
 *  10. After a hide, lines re-route on the boxes as they stand, keep their
 *      kind, and still do not cross.
 */

import { buildForest, layoutTree, routeGeometry, routeTree } from '../../src/app/views/graph/tree-layout';
import type { TreeEdgeInput, TreeLine, TreeNodeInput, TreeRoute } from '../../src/app/views/graph/tree-layout';
import { assert } from '../assert';

function node(id: string, opts: { group?: string; classifier?: boolean; width?: number } = {}): TreeNodeInput {
  return { id, width: opts.width ?? 100, height: 30, group: opts.group ?? 'g', classifier: opts.classifier ?? false };
}
function fk(source: string, target: string, identifying = true, label = 'has'): TreeEdgeInput {
  return { id: `${source}-${target}`, source, target, identifying, label };
}
// Pairs of placed boxes that overlap, each box at its node's own size.
function overlapping(nodes: TreeNodeInput[], positions: Record<string, { x: number; y: number }>): string[] {
  const boxOf = (n: TreeNodeInput) => {
    const p = positions[n.id] ?? { x: NaN, y: NaN };
    return { x1: p.x - n.width / 2, x2: p.x + n.width / 2, y1: p.y - n.height / 2, y2: p.y + n.height / 2 };
  };
  const pairs: string[] = [];
  nodes.forEach((a, i) => {
    for (const b of nodes.slice(i + 1)) {
      const A = boxOf(a);
      const B = boxOf(b);
      if (!(A.x2 <= B.x1 || B.x2 <= A.x1 || A.y2 <= B.y1 || B.y2 <= A.y1)) pairs.push(`${a.id}/${b.id}`);
    }
  });
  return pairs;
}

// 1. identifying parents, deepest wins.
{
  const nodes = ['Community', 'Building', 'Floor', 'Room', 'RoomType', 'UnitType', 'Unit'].map(id => node(id));
  const edges = [
    fk('Community', 'Building'), fk('Building', 'Floor'), fk('Floor', 'Room'),
    fk('Community', 'RoomType'), fk('RoomType', 'Room'),
    fk('Community', 'UnitType'), fk('Building', 'Unit'), fk('UnitType', 'Unit'),
  ];
  const { parent } = buildForest(nodes, edges);
  assert(parent.get('Room') === 'Floor', `FAIL 1a: Room under its deeper parent Floor, got ${parent.get('Room')}`);
  assert(parent.get('Unit') === 'Building', `FAIL 1b: Unit under Building (tie broken by id), got ${parent.get('Unit')}`);
  assert(!parent.has('Community'), 'FAIL 1c: Community is a root');
}

// 2. non-identifying fallback skips classifiers.
{
  const nodes = [node('Customer'), node('OrderStatus', { classifier: true }), node('Order')];
  const edges = [fk('OrderStatus', 'Order', false), fk('Customer', 'Order', false)];
  const { parent } = buildForest(nodes, edges);
  assert(parent.get('Order') === 'Customer', `FAIL 2: Order under Customer, not the classifier, got ${parent.get('Order')}`);
}

// 3. A lookup is never hung under the table that uses it (its line would run
//    parent back to child); it is assigned a consumer in its own group.
{
  const nodes = [
    node('Party', { group: 'core' }), node('Lease', { group: 'core' }), node('Invoice', { group: 'billing' }),
    node('Status', { group: 'core', classifier: true }),
  ];
  const edges = [fk('Party', 'Lease'), fk('Party', 'Invoice'), fk('Status', 'Invoice', false), fk('Status', 'Lease', false)];
  const { parent, lookups, roots } = buildForest(nodes, edges);
  assert(!parent.has('Status'), `FAIL 3: Status has no tree parent, got ${parent.get('Status')}`);
  assert(lookups.get('Status') === 'Lease', `FAIL 3: Status serves Lease (same group), got ${lookups.get('Status')}`);
  assert(!roots.includes('Status'), 'FAIL 3c: a lookup is not a tree root of its own');
}

// 3c. A lookup sits above the tree it serves; its line drops from its bottom
//     and turns right into the consumer's left side, with room for the label.
{
  const nodes = [node('Party'), node('Lease'), node('Unit'), node('LeaseType', { classifier: true }), node('UnitKind', { classifier: true })];
  const edges = [
    fk('Party', 'Lease'), fk('Party', 'Unit'),
    fk('LeaseType', 'Lease', false, 'classifies'), fk('UnitKind', 'Unit', false, 'kinds'),
  ];
  const { positions, routes } = layoutTree(nodes, edges);
  const at = (id: string) => {
    const p = positions[id];
    if (!p) throw new Error(`no position for ${id}`);
    return p;
  };
  for (const [lookup, consumer] of [['LeaseType', 'Lease'], ['UnitKind', 'Unit']] as const) {
    const route = routes.get(`${lookup}-${consumer}`);
    assert(route?.kind === 'down' && route.parent === lookup, `FAIL 3d: ${lookup} → ${consumer} drops from the lookup (${JSON.stringify(route)})`);
    if (!route) continue;
    const laneX = at(lookup).x - 50 + route.laneDx;
    const consumerLeft = at(consumer).x - 50;
    assert(laneX < consumerLeft - 'classifies'.length * 6, `FAIL 3e: ${lookup}'s run into ${consumer} fits its label`);
    assert(at(lookup).y + 15 < at(consumer).y + route.entryDy, `FAIL 3f: ${lookup} sits above the row it enters`);
  }
  assert(at('LeaseType').y < at('Party').y && at('UnitKind').y < at('Party').y, 'FAIL 3h: lookups sit above the tree');
}

// 3i. A lookup used by two trees sits above its assigned consumer only; its
//     line into the other tree is a cross link.
{
  const nodes = [node('A'), node('A1'), node('B'), node('B1'), node('Kind', { classifier: true })];
  const edges = [fk('A', 'A1'), fk('B', 'B1'), fk('Kind', 'A1', false), fk('Kind', 'B1', false)];
  const { positions, routes } = layoutTree(nodes, edges);
  assert(routes.get('Kind-A1')?.kind === 'down', 'FAIL 3i: Kind feeds A1, its assigned consumer');
  const cross = routes.get('Kind-B1');
  assert(cross?.kind === 'cross' && cross.slot.streetDy > 0 && cross.slot.approachDx < 0,
    `FAIL 3j: Kind → B1 is a cross link under Kind into B1's left side (${JSON.stringify(cross)})`);
  const kind = positions['Kind'];
  const a1 = positions['A1'];
  assert(kind !== undefined && a1 !== undefined && kind.y < a1.y, 'FAIL 3k: Kind sits above A1');
}

// 3l. A lookup used only by another lookup has no tree to sit above: it stays
//     a root, placed, and its line is a cross link.
{
  const nodes = [node('Line'), node('LineType', { classifier: true }), node('LineCategory', { classifier: true })];
  const edges = [fk('LineType', 'Line', false), fk('LineCategory', 'LineType', false)];
  const { lookups, roots } = buildForest(nodes, edges);
  assert(lookups.get('LineType') === 'Line', 'FAIL 3l: LineType serves Line');
  assert(!lookups.has('LineCategory') && roots.includes('LineCategory'), 'FAIL 3m: LineCategory stays a root');
  const { positions, routes } = layoutTree(nodes, edges);
  assert(positions['LineCategory'] !== undefined, 'FAIL 3n: LineCategory is placed');
  assert(routes.get('LineCategory-LineType')?.kind === 'cross', 'FAIL 3o: LineCategory → LineType is a cross link');
}

// 3p. A cycle is cut at a plain FK link, never a key link: a table whose
//     fallback parent sits in its own subtree stays the root.
{
  const nodes = [node('product'), node('_joiner_product_x'), node('variant'), node('variant_price')];
  const edges = [
    fk('product', '_joiner_product_x'), fk('_joiner_product_x', 'variant'), fk('variant', 'variant_price'),
    fk('variant_price', 'product', false),
  ];
  const { parent } = buildForest(nodes, edges);
  assert(!parent.has('product'), `FAIL 3p: product stays the root, got parent ${parent.get('product')}`);
  assert(parent.get('_joiner_product_x') === 'product', 'FAIL 3q: the joiner keeps its key parent');
}

// 3r. An audit hub (`created_by` → users everywhere) is never a fallback
//     parent: tables with no key parent stay roots.
{
  const nodes = [node('users')];
  const edges: TreeEdgeInput[] = [];
  for (let i = 0; i < 10; i++) {
    nodes.push(node(`t${i}`));
    edges.push(fk('users', `t${i}`, false, 'created'));
  }
  const { parent } = buildForest(nodes, edges);
  assert([...parent.keys()].length === 0, `FAIL 3r: no table hangs under the hub, got ${JSON.stringify([...parent])}`);
}

// 4 + 5. geometry.
{
  const nodes = [
    node('Root'), node('Big'), node('Small'), node('Leaf1'), node('Leaf2'),
    node('Other'), node('OtherChild'),
  ];
  const edges = [
    fk('Root', 'Big', true, 'contains many things'), fk('Root', 'Small', true, 'has'),
    fk('Big', 'Leaf1'), fk('Big', 'Leaf2'),
    fk('Other', 'OtherChild'),
  ];
  const { positions, routes } = layoutTree(nodes, edges);
  const box = (id: string) => {
    const p = positions[id];
    if (!p) throw new Error(`no position for ${id}`);
    return { x1: p.x - 50, x2: p.x + 50, y1: p.y - 15, y2: p.y + 15 };
  };
  assert(Object.keys(positions).length === nodes.length, 'FAIL 4a: every node placed');
  assert(box('Big').x1 > box('Root').x1 && box('Big').y1 > box('Root').y2, 'FAIL 4b: child right of and below its parent');
  assert(box('Small').y1 < box('Big').y1, 'FAIL 4c: the smaller subtree comes first');
  const overlaps4 = overlapping(nodes, positions);
  assert(overlaps4.length === 0, `FAIL 4d: no two boxes overlap (${overlaps4.join(', ')})`);

  const toSmall = routes.get('Root-Small');
  const toBig = routes.get('Root-Big');
  assert(toSmall !== undefined && toBig !== undefined, 'FAIL 5a: both root edges are tree-routed');
  if (toSmall && toBig) {
    assert(toBig.laneDx < toSmall.laneDx, `FAIL 5b: the lower child's lane is further left (${toBig.laneDx} vs ${toSmall.laneDx})`);
    const labelWidth = 'contains many things'.length * 6;
    const run = box('Big').x1 - (box('Root').x1 + toBig.laneDx);
    assert(run > labelWidth, `FAIL 5c: the run (${run}) fits the label (${labelWidth})`);
    assert(toBig.laneDx < 50, 'FAIL 5d: tree lanes use the left half of the parent\'s bottom edge');
  }
}

// 6. A wide key parent's children that do not fit wrap into columns to its
//    right, each starting a row below it, so every line still runs down and right.
function wideParent(extra: TreeEdgeInput[] = []): { nodes: TreeNodeInput[]; edges: TreeEdgeInput[] } {
  const nodes = [node('Tenant')];
  const edges: TreeEdgeInput[] = [];
  for (let i = 0; i < 12; i++) {
    const kid = `T${String(i).padStart(2, '0')}`;
    nodes.push(node(kid));
    edges.push(fk('Tenant', kid));
    for (let j = 0; j < 4; j++) {
      nodes.push(node(`${kid}_${j}`));
      edges.push(fk(kid, `${kid}_${j}`));
    }
  }
  return { nodes, edges: [...edges, ...extra] };
}
function wrappedTooHigh(positions: Record<string, { x: number; y: number }>, routes: Map<string, TreeRoute>): string[] {
  const tenantBottom = (positions['Tenant']?.y ?? 0) + 15;
  return [...routes].filter(([id, r]) => id.startsWith('Tenant-') && r.kind !== 'down')
    .map(([, r]) => r.child).filter(child => (positions[child]?.y ?? 0) - 15 - tenantBottom < 20);
}
// Width over height of the placed boxes (100 × 30 in these fixtures).
function aspectOf(positions: Record<string, { x: number; y: number }>): number {
  const xs = Object.values(positions).map(p => p.x);
  const ys = Object.values(positions).map(p => p.y);
  return (Math.max(...xs) - Math.min(...xs) + 100) / (Math.max(...ys) - Math.min(...ys) + 30);
}
// A chain of single children `levels` deep whose last table has `leaves` children.
function chainTo(levels: number, leaves: number): { nodes: TreeNodeInput[]; edges: TreeEdgeInput[] } {
  const nodes: TreeNodeInput[] = [];
  const edges: TreeEdgeInput[] = [];
  for (let level = 0; level <= levels; level++) {
    nodes.push(node(`A${level}`));
    if (level > 0) edges.push(fk(`A${level - 1}`, `A${level}`));
  }
  for (let j = 0; j < leaves; j++) {
    nodes.push(node(`A${levels}_${j}`));
    edges.push(fk(`A${levels}`, `A${levels}_${j}`));
  }
  return { nodes, edges };
}
{
  const { nodes, edges } = wideParent();
  const { positions, routes } = layoutTree(nodes, edges);
  const aspect = aspectOf(positions);
  assert(aspect > 1 && aspect < 2.5, `FAIL 6a: the wide parent wraps into a picture near 16:10 (${aspect.toFixed(2)})`);
  assert(routes.get('Tenant-T11')?.kind === 'cross' && routes.get('T11-T11_0')?.kind === 'down',
    'FAIL 6b: the last child wraps, and keeps its own tree lines');
  const tenantEdges = [...routes].filter(([id, r]) => id.startsWith('Tenant-') && r.kind === 'down').length;
  assert(tenantEdges > 0 && tenantEdges < 12, `FAIL 6c: some, not all, of the parent's lines stay tree lines (${tenantEdges})`);
  const high = wrappedTooHigh(positions, routes);
  assert(high.length === 0, `FAIL 6d: wrapped children start a row below their parent's bottom edge (${high.join(', ')})`);
  const overlaps6 = overlapping(nodes, positions);
  assert(overlaps6.length === 0, `FAIL 6e: wrapped columns overlap no box (${overlaps6.join(', ')})`);
}
// 6f. Links from a wrapped subtree back into kept tables change nothing: the
//     wrapped children are part of the parent's tree, not trees ordered on their own.
{
  const { nodes, edges } = wideParent([fk('T05_0', 'T00_1', false), fk('T05_1', 'T01_1', false)]);
  const { positions, routes } = layoutTree(nodes, edges);
  const high = wrappedTooHigh(positions, routes);
  assert(high.length === 0, `FAIL 6f: with links back into kept tables, wrapped children still start below the parent (${high.join(', ')})`);
  assert(overlapping(nodes, positions).length === 0, 'FAIL 6f2: with links back into kept tables, no boxes overlap');
}
// 6g. A lookup's line into a wrapped table is a cross link: a straight run from
//     the staircase would pass behind the boxes sharing that row.
{
  const { nodes, edges } = wideParent([fk('Kind', 'T00', false), fk('Kind', 'T11', false)]);
  nodes.push(node('Kind', { classifier: true }));
  const { routes } = layoutTree(nodes, edges);
  assert(routes.get('Kind-T00')?.kind === 'down', 'FAIL 6g: a lookup line into a kept table drops from the staircase');
  assert(routes.get('Kind-T11')?.kind === 'cross', 'FAIL 6g2: a lookup line into a wrapped table is a cross link');
}
// 6h. A lookup that feeds only wrapped tables has no lanes; its tree still places.
{
  const { nodes, edges } = wideParent([fk('Kind', 'T11', false)]);
  nodes.push(node('Kind', { classifier: true }));
  const { positions, routes } = layoutTree(nodes, edges);
  const placed = Object.values(positions).every(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  assert(placed && Object.keys(positions).length === nodes.length, 'FAIL 6h: every box gets a finite position');
  assert(routes.get('Kind-T11')?.kind === 'cross', 'FAIL 6h2: its line is a cross link');
}
// 6i. A deep chain whose last child wraps at every level steps right, one
//     column per level; the picture stays under 3:1.
{
  const nodes: TreeNodeInput[] = [];
  const edges: TreeEdgeInput[] = [];
  for (let level = 0; level < 9; level++) {
    nodes.push(node(`C${level}`));
    if (level > 0) edges.push(fk(`C${level - 1}`, `C${level}`));
    for (let j = 0; j < 3; j++) {
      nodes.push(node(`C${level}_${j}`));
      edges.push(fk(`C${level}`, `C${level}_${j}`));
    }
  }
  const { positions } = layoutTree(nodes, edges);
  const aspect = aspectOf(positions);
  assert(aspect < 3, `FAIL 6i: a deep chain stays under 3:1 (${aspect.toFixed(2)})`);
  assert(overlapping(nodes, positions).length === 0, 'FAIL 6i2: the chain\'s wrapped columns overlap no box');
}
// 6j. A parent with room for one and a half rows below it keeps its children in
//     one column instead of a strip of one-table columns; with room for two, it wraps.
{
  const { nodes, edges } = chainTo(10, 4);
  const { routes } = layoutTree(nodes, edges);
  const leafLines = Array.from({ length: 4 }, (_, j) => routes.get(`A10-A10_${j}`)?.kind);
  assert(leafLines.every(kind => kind === 'down'), `FAIL 6j: without room for two rows the children stay under it (${leafLines.join(', ')})`);
}
{
  const { nodes, edges } = chainTo(5, 4);
  const { routes } = layoutTree(nodes, edges);
  const leafLines = Array.from({ length: 4 }, (_, j) => routes.get(`A5-A5_${j}`)?.kind);
  assert(leafLines.some(kind => kind === 'cross'), `FAIL 6j2: with room for two rows the children wrap (${leafLines.join(', ')})`);
}
// 6k. A wide parent partway down, with room for a few rows, still wraps.
{
  const { nodes, edges } = chainTo(8, 20);
  const { positions, routes } = layoutTree(nodes, edges);
  const wrapped = Array.from({ length: 20 }, (_, j) => routes.get(`A8-A8_${j}`)?.kind).filter(kind => kind === 'cross').length;
  assert(wrapped > 0, 'FAIL 6k: children of a parent with room for two rows below it wrap');
  assert(aspectOf(positions) > 0.8, `FAIL 6k2: the picture stays near 16:10 (${aspectOf(positions).toFixed(2)})`);
  assert(overlapping(nodes, positions).length === 0, 'FAIL 6k3: no boxes overlap');
}

// 7. Wrapping never moves a subtype joiner off its basetype: it stays under it
//    and only members that do not fit wrap.
{
  const nodes = [node('base'), { ...node('_joiner_base_x', { width: 20 }), joiner: true }, node('small')];
  const edges = [fk('base', '_joiner_base_x'), fk('base', 'small')];
  for (let i = 0; i < 8; i++) {
    const member = `m${i}`;
    nodes.push(node(member));
    edges.push(fk('_joiner_base_x', member));
    for (let j = 0; j < 4; j++) {
      nodes.push(node(`${member}_${j}`));
      edges.push(fk(member, `${member}_${j}`));
    }
  }
  const { positions, routes } = layoutTree(nodes, edges);
  assert(routes.get('base-_joiner_base_x')?.kind === 'down', 'FAIL 7a: the joiner stays under its basetype');
  const joiner = positions['_joiner_base_x'];
  const base = positions['base'];
  assert(joiner !== undefined && base !== undefined && joiner.y > base.y, 'FAIL 7b: the joiner sits below the basetype');
  const keptMembers = [...routes].filter(([id, r]) => id.startsWith('_joiner_base_x-') && r.kind === 'down').length;
  assert(keptMembers > 0 && keptMembers < 8, `FAIL 7c: some members stay with the joiner, the rest wrap (${keptMembers})`);
  assert(overlapping(nodes, positions).length === 0, 'FAIL 7d: the cluster\'s wrapped columns overlap no box');
}
// A basetype with 14 leaf children and one subtype cluster per kind ('x' exclusive,
// 'i' inclusive), each of 6 members with 3 children.
function wideBasetype(kinds: string[]): { nodes: TreeNodeInput[]; edges: TreeEdgeInput[] } {
  const nodes: TreeNodeInput[] = [node('base')];
  const edges: TreeEdgeInput[] = [];
  for (const kind of kinds) {
    const joiner = `_joiner_base_${kind}`;
    nodes.push({ ...node(joiner, { width: 20 }), joiner: true });
    edges.push(fk('base', joiner));
    for (let i = 0; i < 6; i++) {
      const member = `${kind}${i}`;
      nodes.push(node(member));
      edges.push(fk(joiner, member));
      for (let j = 0; j < 3; j++) {
        nodes.push(node(`${member}_${j}`));
        edges.push(fk(member, `${member}_${j}`));
      }
    }
  }
  for (let i = 0; i < 14; i++) {
    nodes.push(node(`leaf${i}`));
    edges.push(fk('base', `leaf${i}`));
  }
  return { nodes, edges };
}
// 7e. Under a basetype whose children wrap, the joiner goes first and stays under
//     it, so its cluster gets the column's room instead of running past it.
{
  const { nodes, edges } = wideBasetype(['x']);
  const { positions, routes } = layoutTree(nodes, edges);
  assert(routes.get('base-_joiner_base_x')?.kind === 'down', 'FAIL 7e: the joiner stays under its basetype');
  const joinerY = positions['_joiner_base_x']?.y ?? Infinity;
  const leafYs = Array.from({ length: 14 }, (_, i) => positions[`leaf${i}`]?.y ?? -Infinity);
  assert(leafYs.every(y => joinerY <= y), 'FAIL 7f: the joiner is on its basetype\'s first child row');
  const aspect = aspectOf(positions);
  assert(aspect > 0.8, `FAIL 7g: the cluster wraps instead of running down past the column (${aspect.toFixed(2)})`);
  assert(overlapping(nodes, positions).length === 0, 'FAIL 7h: no boxes overlap');
}
// 7i. When nothing wraps, the joiner keeps its smallest-subtree-first place.
{
  const nodes: TreeNodeInput[] = [node('base'), node('a'), { ...node('_joiner_base_x', { width: 20 }), joiner: true }, node('m0'), node('m1')];
  const edges = [fk('base', 'a'), fk('base', '_joiner_base_x'), fk('_joiner_base_x', 'm0'), fk('_joiner_base_x', 'm1')];
  // Standalone tables widen the picture, so the base tree fits its column.
  for (let i = 0; i < 30; i++) nodes.push(node(`solo${i}`));
  const { positions } = layoutTree(nodes, edges);
  assert((positions['a']?.y ?? Infinity) < (positions['_joiner_base_x']?.y ?? -Infinity), 'FAIL 7i: the smaller subtree stays above the joiner');
}
// 7i2. The same under a basetype too deep to wrap, whose subtree runs past the column.
{
  const { nodes, edges } = chainTo(10, 0);
  nodes.push(node('a'), { ...node('_joiner_A10_x', { width: 20 }), joiner: true }, node('m0'), node('m1'));
  edges.push(fk('A10', 'a'), fk('A10', '_joiner_A10_x'), fk('_joiner_A10_x', 'm0'), fk('_joiner_A10_x', 'm1'));
  const { positions } = layoutTree(nodes, edges);
  assert((positions['a']?.y ?? Infinity) < (positions['_joiner_A10_x']?.y ?? -Infinity), 'FAIL 7i2: without room to wrap, the joiner keeps its place');
}
// 7j. A basetype with two clusters keeps both joiners under it, even when the
//     second is reached after the column fills.
{
  const { nodes, edges } = wideBasetype(['x', 'i']);
  const { positions, routes } = layoutTree(nodes, edges);
  assert(routes.get('base-_joiner_base_x')?.kind === 'down' && routes.get('base-_joiner_base_i')?.kind === 'down',
    'FAIL 7j: both joiners stay under their basetype');
  assert(overlapping(nodes, positions).length === 0, 'FAIL 7j2: no boxes overlap');
}

// 8. Every drawn line leaves its parent's bottom edge and enters its child's
//    left side, and each segment is horizontal or vertical.
{
  const parent = { x: 100, y: 100, width: 100, height: 30 };
  const square = (pts: { x: number; y: number }[]) =>
    pts.every((p, i) => i === 0 || Math.abs(p.x - (pts[i - 1]?.x ?? p.x)) < 0.01 || Math.abs(p.y - (pts[i - 1]?.y ?? p.y)) < 0.01);
  const check = (name: string, route: TreeRoute, child: { x: number; y: number; width: number; height: number }, kind: string) => {
    const g = routeGeometry(route, parent, child);
    assert(g.kind === kind, `FAIL 8 ${name}: drawn as ${kind}, got ${g.kind}`);
    assert(Math.abs(g.parentEnd.y - (parent.y + 15)) < 0.01 && Math.abs(g.parentEnd.x - parent.x) <= 50,
      `FAIL 8 ${name}: leaves the parent's bottom edge (${JSON.stringify(g.parentEnd)})`);
    assert(Math.abs(g.childEnd.x - (child.x - child.width / 2)) < 0.01, `FAIL 8 ${name}: enters the child's left side`);
    assert(square([g.parentEnd, ...g.bends, g.childEnd]), `FAIL 8 ${name}: right-angled (${JSON.stringify(g)})`);
  };
  const slot = { laneDx: -10, streetDy: 10, approachDx: -12 };
  const down: TreeRoute = { kind: 'down', parent: 'P', child: 'C', laneDx: 10, slot, entryDy: 0 };
  check('below-right', down, { x: 250, y: 200, width: 100, height: 30 }, 'down');
  // After a hide or reveal the child can sit level with or above the parent, or under its lane.
  check('above', down, { x: 250, y: 40, width: 100, height: 30 }, 'cross');
  check('under the lane', down, { x: 90, y: 200, width: 100, height: 30 }, 'cross');
  const cross: TreeRoute = { kind: 'cross', parent: 'P', child: 'C', laneDx: 0, slot, entryDy: 3 };
  check('cross left', cross, { x: -200, y: 300, width: 100, height: 30 }, 'cross');
}

// Last turns into a child that cross: line b's run (from its last vertical to
// the child's left side) crosses line a's last vertical. Boxes are 100 × 30.
function lastTurnCrossings(routes: Map<string, TreeRoute>, positions: Record<string, { x: number; y: number }>): string[] {
  const at = (id: string) => positions[id] ?? { x: 0, y: 0 };
  const crossings: string[] = [];
  const byChild = new Map<string, TreeRoute[]>();
  for (const r of routes.values()) byChild.set(r.child, [...(byChild.get(r.child) ?? []), r]);
  for (const [child, list] of byChild) {
    const turns = list.map((r) => {
      const parent = at(r.parent);
      const vx = r.kind === 'down' ? parent.x - 50 + r.laneDx : at(child).x - 50 + r.slot.approachDx;
      const fromY = r.kind === 'down' ? parent.y + 15 : parent.y + 15 + r.slot.streetDy;
      return { id: r.parent, vx, fromY, entry: at(child).y + r.entryDy };
    });
    for (const t of turns) {
      for (const u of turns) {
        if (t === u || !(t.vx > u.vx)) continue;
        const lo = Math.min(t.fromY, t.entry);
        const hi = Math.max(t.fromY, t.entry);
        if (u.entry > lo + 0.01 && u.entry < hi - 0.01) crossings.push(`${u.id}→${child} crosses ${t.id}→${child}`);
      }
    }
  }
  return crossings;
}

// 9. Cross links from above and below plus a tree line into one child: no
//    last turn crosses another; cross links from one parent get distinct slots.
{
  const nodes = [
    node('Root'), node('Child'), node('Sibling'),
    node('Low1'), node('Low1a'), node('Low2'), node('Low2a'), node('Low2b'),
    node('High'),
  ];
  const edges = [
    fk('Root', 'Child'), fk('Root', 'Sibling'),
    fk('Low1', 'Low1a'), fk('Low2', 'Low2a'), fk('Low2', 'Low2b'),
    fk('High', 'Child', false), fk('Low1a', 'Child', false), fk('Low2b', 'Child', false), fk('Low2a', 'Child', false),
    fk('Root', 'Low1a', false), fk('Root', 'Low2b', false),
  ];
  const { positions, routes } = layoutTree(nodes, edges);
  const crossings = lastTurnCrossings(routes, positions);
  assert(crossings.length === 0, `FAIL 9a: last turns cross (${crossings.join('; ')})`);
  const crossFromRoot = [...routes.values()].filter(r => r.parent === 'Root' && r.kind === 'cross');
  const lanes = new Set(crossFromRoot.map(r => r.slot.laneDx.toFixed(2)));
  const streets = new Set(crossFromRoot.map(r => r.slot.streetDy.toFixed(2)));
  assert(crossFromRoot.length >= 2 && lanes.size === crossFromRoot.length && streets.size === crossFromRoot.length,
    `FAIL 9b: Root's cross links each have their own lane and street (${crossFromRoot.length})`);
}

// 10. Hiding a table re-routes on the boxes as they stand: every other line
//     keeps its kind, and still no last turns cross.
{
  const nodes = [
    node('Community'), node('Building'), node('Unit'), node('UnitType'), node('Amenity'),
    node('Lease'), node('LeaseType', { classifier: true }), node('Owner'),
  ];
  const edges = [
    fk('Community', 'Building'), fk('Building', 'Unit'), fk('Community', 'UnitType'), fk('UnitType', 'Unit'),
    fk('Unit', 'Amenity'), fk('Unit', 'Lease'), fk('LeaseType', 'Lease', false), fk('Owner', 'Building', false),
    fk('Owner', 'Lease', false),
  ];
  const { positions, routes } = layoutTree(nodes, edges);
  const remaining = nodes.filter(n => n.id !== 'UnitType');
  const lines: TreeLine[] = [...routes]
    .filter(([, r]) => r.parent !== 'UnitType' && r.child !== 'UnitType')
    .map(([id, r]) => ({ id, parent: r.parent, child: r.child, kind: r.kind }));
  const rerouted = routeTree(remaining, positions, lines);
  for (const line of lines) {
    assert(rerouted.get(line.id)?.kind === line.kind, `FAIL 10a: ${line.id} keeps its kind after the hide`);
  }
  const crossings = lastTurnCrossings(rerouted, positions);
  assert(crossings.length === 0, `FAIL 10b: last turns cross after the hide (${crossings.join('; ')})`);
}

if (process.exitCode !== 1) console.log('PASS: test-tree-layout');
