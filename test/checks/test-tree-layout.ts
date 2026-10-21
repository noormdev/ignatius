/**
 * test-tree-layout.ts — the Tree layout reads like an outline: each table sits
 * below and to the right of the table whose key it inherits, and a parent's lines
 * share one trunk, each branching right into its child.
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
 *   5. A parent's tree lines share one trunk a quarter in from its left edge;
 *      each branch is long enough for its label.
 *   6. A wide key parent's children wrap into columns to its right, each
 *      starting a row below the parent's bottom edge, only where a fresh column
 *      has room for two rows; lookup lines into wrapped tables are cross links; lines
 *      into a wrapped column share one drop with labels on their runs, owned by
 *      the parent with the most lines into it; approach columns move past boxes,
 *      from below as well as above, jogging when no straight drop is clear,
 *      never across the child's own trunk or down another line's column.
 *   7. A subtype joiner never leaves its basetype, and goes first when its
 *      siblings wrap.
 *   8. Every drawn line leaves its parent's bottom edge and enters its child's
 *      left side, right-angled, including a tree line redrawn as a cross link.
 *   9. Lines into one child never cross on its left side; cross links from one
 *      parent outside a shared drop each get their own lane and street.
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
    const trunkX = at(lookup).x - 50 + route.trunkDx;
    const consumerLeft = at(consumer).x - 50;
    assert(trunkX < consumerLeft - 'classifies'.length * 6, `FAIL 3e: ${lookup}'s run into ${consumer} fits its label`);
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
    assert(toBig.trunkDx === toSmall.trunkDx && toBig.trunkDx === 25,
      `FAIL 5b: a parent's tree lines share one trunk a quarter in from its left edge (${toBig.trunkDx}, ${toSmall.trunkDx})`);
    const labelWidth = 'contains many things'.length * 6;
    const run = box('Big').x1 - (box('Root').x1 + toBig.trunkDx);
    assert(run > labelWidth, `FAIL 5c: the run (${run}) fits the label (${labelWidth})`);
    assert(toBig.trunkDx < 50, 'FAIL 5d: the trunk sits in the left half of the parent\'s bottom edge');
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
// 6h. A lookup that feeds only wrapped tables has no trunk; its tree still places.
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
// 6j. A parent with room for one row but not two below it keeps its children in
//     one column instead of a strip of one-table columns; with room for two, it wraps.
{
  const { nodes, edges } = chainTo(24, 4);
  const { routes } = layoutTree(nodes, edges);
  const leafLines = Array.from({ length: 4 }, (_, j) => routes.get(`A24-A24_${j}`)?.kind);
  assert(leafLines.every(kind => kind === 'down'), `FAIL 6j: without room for two rows the children stay under it (${leafLines.join(', ')})`);
}
{
  const { nodes, edges } = chainTo(10, 4);
  const { routes } = layoutTree(nodes, edges);
  const leafLines = Array.from({ length: 4 }, (_, j) => routes.get(`A10-A10_${j}`)?.kind);
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
// 6l. A parent's lines into one wrapped column share a lane, a street and a drop,
//     and each label sits on its own run into its child, so no two labels stack.
{
  const { nodes, edges } = wideParent();
  const { positions, routes } = layoutTree(nodes, edges);
  const wrapped = [...routes.values()].filter(r => r.parent === 'Tenant' && r.kind === 'cross');
  const columns = new Map<number, TreeRoute[]>();
  for (const r of wrapped) {
    const left = Math.round((positions[r.child]?.x ?? 0) - 50);
    columns.set(left, [...(columns.get(left) ?? []), r]);
  }
  const shared = [...columns.values()].every(list => new Set(list.map(r => JSON.stringify(r.slot))).size === 1);
  assert(wrapped.length > 0 && shared, 'FAIL 6l: lines into one wrapped column share one lane, street and drop');
  assert(wrapped.every(r => r.runLabel === true && -r.slot.approachDx >= 'has'.length * 6 + 28),
    'FAIL 6l2: each wrapped line carries its label on the run into its child');
}
// 6m. A drop that would pass through a box moves left of it.
{
  const nodes = [node('P'), node('C'), node('B')];
  const positions = { P: { x: 0, y: 0 }, C: { x: 400, y: 300 }, B: { x: 338, y: 150 } };
  const routes = routeTree(nodes, positions, [{ id: 'P-C', parent: 'P', child: 'C', kind: 'cross', label: 'has' }]);
  const route = routes.get('P-C');
  const dropX = 350 + (route?.slot.approachDx ?? 0);
  assert(route !== undefined && dropX < 286, `FAIL 6m: the drop moves left of the box in its way (x ${dropX})`);
}

// 6n. With no straight drop clear of the boxes, the line drops through a clear column,
//     crosses above the child, and drops into it, so no segment runs behind a box.
{
  const nodes = [node('P'), node('C'), node('B1'), node('B2'), node('B3')];
  const positions: Record<string, { x: number; y: number }> = {
    P: { x: 0, y: 0 }, C: { x: 400, y: 300 }, B1: { x: 380, y: 215 }, B2: { x: 285, y: 165 }, B3: { x: 250, y: 300 },
  };
  const routes = routeTree(nodes, positions, [{ id: 'P-C', parent: 'P', child: 'C', kind: 'cross', label: 'has' }]);
  const route = routes.get('P-C');
  assert(route?.slot.jog !== undefined, 'FAIL 6n: the route jogs around the boxes');
  if (route) {
    const pts = drawn(route, positions);
    const behind = ['B1', 'B2', 'B3'].filter(id => through(pts, positions[id] ?? { x: 0, y: 0 }));
    assert(behind.length === 0, `FAIL 6n2: no segment runs behind a box (${behind.join(', ')})`);
  }
}

// 6o. Moving an approach column past a box never takes it across the child's own trunk.
{
  const nodes = [node('Q'), node('P'), node('C')];
  const positions = { Q: { x: 0, y: 0 }, P: { x: 300, y: 100 }, C: { x: 390, y: 170 } };
  const routes = routeTree(nodes, positions, [
    { id: 'P-C', parent: 'P', child: 'C', kind: 'down', label: 'has' },
    { id: 'Q-C', parent: 'Q', child: 'C', kind: 'cross', label: 'has' },
  ]);
  const crossings = lastTurnCrossings(routes, positions);
  assert(crossings.length === 0, `FAIL 6o: no last turns into C cross (${crossings.join('; ')})`);
}

// The drawn points of a route between 100 × 30 boxes.
function drawn(route: TreeRoute, positions: Record<string, { x: number; y: number }>): { x: number; y: number }[] {
  const box = (id: string) => ({ ...(positions[id] ?? { x: 0, y: 0 }), width: 100, height: 30 });
  const g = routeGeometry(route, box(route.parent), box(route.child));
  return [g.parentEnd, ...g.bends, g.childEnd];
}
// True when a polyline passes through the 100 × 30 box centred at `at`.
function through(pts: { x: number; y: number }[], at: { x: number; y: number }): boolean {
  return pts.some((a, i) => {
    const b = pts[i + 1];
    return b !== undefined && at.x - 50 < Math.max(a.x, b.x) && Math.min(a.x, b.x) < at.x + 50
      && at.y - 15 < Math.max(a.y, b.y) && Math.min(a.y, b.y) < at.y + 15;
  });
}
// 6p. A line from below clears a box under its child, even beside a line from above into the same child.
{
  const positions = { A: { x: 380, y: 0 }, B: { x: 0, y: 600 }, C: { x: 400, y: 300 }, X: { x: 332, y: 450 } };
  const routes = routeTree(['A', 'B', 'C', 'X'].map(id => node(id)), positions, [
    { id: 'A-C', parent: 'A', child: 'C', kind: 'cross', label: 'has' },
    { id: 'B-C', parent: 'B', child: 'C', kind: 'cross', label: 'has' },
  ]);
  const route = routes.get('B-C');
  assert(route !== undefined && !through(drawn(route, positions), positions.X), 'FAIL 6p: the line from below misses the box under its child');
}
// 6q. A jog never crosses the child's own trunk on its way across.
{
  const positions = { Q: { x: 0, y: 0 }, P: { x: 330, y: 200 }, S: { x: 400, y: 250 }, C: { x: 400, y: 300 } };
  const routes = routeTree(['Q', 'P', 'S', 'C'].map(id => node(id)), positions, [
    { id: 'P-S', parent: 'P', child: 'S', kind: 'down', label: 'has' },
    { id: 'P-C', parent: 'P', child: 'C', kind: 'down', label: 'has' },
    { id: 'Q-C', parent: 'Q', child: 'C', kind: 'cross', label: 'has' },
  ]);
  const qc = routes.get('Q-C');
  const pc = routes.get('P-C');
  const count = qc && pc ? clashes(drawn(qc, positions), drawn(pc, positions)) : -1;
  assert(count === 0, `FAIL 6q: the line from Q never crosses P's trunk into C (${count})`);
}
// 6r. A jog never drops down another line's column into the same child, where the two would draw as one.
{
  const positions = { C: { x: 400, y: 300 }, A: { x: 268, y: 195 }, B: { x: -112, y: 185 }, D: { x: 316, y: 163 }, X: { x: 286, y: 222 } };
  const routes = routeTree(['C', 'A', 'B', 'D', 'X'].map(id => node(id)), positions, [
    { id: 'A-C', parent: 'A', child: 'C', kind: 'cross', label: 'has' },
    { id: 'B-C', parent: 'B', child: 'C', kind: 'cross', label: 'has' },
    { id: 'D-C', parent: 'D', child: 'C', kind: 'down', label: 'has' },
  ]);
  const columnOf = (r: TreeRoute | undefined) => r?.slot?.jog?.dropDx ?? r?.slot?.approachDx;
  const jog = routes.get('A-C')?.slot?.jog;
  const other = columnOf(routes.get('B-C'));
  assert(other !== undefined && (jog === undefined || Math.abs(jog.dropDx - other) >= 6),
    `FAIL 6r: A's jog, if any, drops 6 px or more from B's column (${jog?.dropDx} vs ${other})`);
}
// 6s. A wrapped column fed by two parents gets one shared drop, owned by the parent with the most lines into it.
{
  const { nodes, edges } = wideParent([fk('Kind', 'T11', false)]);
  nodes.push(node('Kind', { classifier: true }));
  edges.push(fk('Kind', 'T00', false));
  const { routes } = layoutTree(nodes, edges);
  const shared = [...routes.values()].filter(r => r.runLabel === true && r.child === 'T11');
  assert(shared.length === 1 && shared[0]?.parent === 'Tenant', `FAIL 6s: one shared drop into T11, Tenant's (${shared.map(r => r.parent).join(', ')})`);
}
// A box spanning x1..x2 and y1..y2, to stand in a line's way.
function blocker(id: string, x1: number, x2: number, y1: number, y2: number): { node: TreeNodeInput; at: { x: number; y: number } } {
  return { node: { id, width: x2 - x1, height: y2 - y1, group: 'g', classifier: false }, at: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
}
// Places where one polyline runs across the other, or along it.
function clashes(a: { x: number; y: number }[], b: { x: number; y: number }[]): number {
  let count = 0;
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      const [s0, s1, t0, t1] = [a[i], a[i + 1], b[j], b[j + 1]];
      if (!s0 || !s1 || !t0 || !t1) continue;
      const sH = s0.y === s1.y;
      const tH = t0.y === t1.y;
      const span = (p: number, q: number): [number, number] => [Math.min(p, q), Math.max(p, q)];
      if (sH !== tH) {
        const [h0, h1, v0, v1] = sH ? [s0, s1, t0, t1] : [t0, t1, s0, s1];
        const [hx1, hx2] = span(h0.x, h1.x);
        const [vy1, vy2] = span(v0.y, v1.y);
        if (hx1 < v0.x && v0.x < hx2 && vy1 < h0.y && h0.y < vy2) count++;
      } else if (sH ? s0.y === t0.y : s0.x === t0.x) {
        const [a1, a2] = sH ? span(s0.x, s1.x) : span(s0.y, s1.y);
        const [b1, b2] = sH ? span(t0.x, t1.x) : span(t0.y, t1.y);
        if (Math.min(a2, b2) - Math.max(a1, b1) > 0) count++;
      }
    }
  }
  return count;
}
// 6t. With no clear place for a column's drop, several lines keep the drop and their labels on their runs
//     (on one street the labels would print as one), and a single line takes its own slot.
{
  const box = blocker('B', 135, 165, 140, 160);
  const positions = { P: { x: 0, y: 0 }, C1: { x: 250, y: 100 }, C2: { x: 250, y: 150 }, C3: { x: 250, y: 200 }, B: box.at };
  const lines = (children: string[]): TreeLine[] => children.map(c => ({ id: `P-${c}`, parent: 'P', child: c, kind: 'cross', label: 'is placed by' }));
  const several = routeTree([node('P'), node('C1'), node('C2'), node('C3'), box.node], positions, lines(['C1', 'C2', 'C3']));
  assert([...several.values()].every(r => r.runLabel === true),
    `FAIL 6t: three lines keep their labels on their runs (${[...several.values()].map(r => r.runLabel).join(', ')})`);
  const one = routeTree([node('P'), node('C2'), box.node], positions, lines(['C2'])).get('P-C2');
  assert(one !== undefined && !one.runLabel && one.slot.approachDx === -12, `FAIL 6t: one line takes its own slot (${JSON.stringify(one?.slot)})`);
}
// 6u. A cross link never crosses the trunk of a tree line into the same child, even with no box in its way.
{
  const positions = { P: { x: 300, y: 100 }, C: { x: 330, y: 250 }, Q: { x: 0, y: 150 } };
  const routes = routeTree([node('P'), node('C'), node('Q')], positions, [
    { id: 'P-C', parent: 'P', child: 'C', kind: 'down', label: 'has' },
    { id: 'Q-C', parent: 'Q', child: 'C', kind: 'cross', label: 'has' },
  ]);
  const pc = routes.get('P-C');
  const qc = routes.get('Q-C');
  const count = pc && qc ? clashes(drawn(pc, positions), drawn(qc, positions)) : -1;
  assert(count === 0, `FAIL 6u: Q's line into C stays clear of P's trunk into C (${count})`);
}
// Lines into `child` that cross or overlap one another.
function clashesInto(routes: Map<string, TreeRoute>, positions: Record<string, { x: number; y: number }>, child: string): number {
  const into = [...routes.values()].filter(r => r.child === child).map(r => drawn(r, positions));
  return into.reduce((n, a, i) => n + into.slice(i + 1).reduce((m, b) => m + clashes(a, b), 0), 0);
}
// 6u2. A second tree line into the child, itself routed as a cross link, counts toward the room the trunk keeps.
{
  const positions = { C: { x: 400, y: 300 }, T: { x: 359, y: 150 }, L: { x: 500, y: 50 }, A: { x: 0, y: 100 } };
  const routes = routeTree(['C', 'T', 'L', 'A'].map(id => node(id)), positions, [
    { id: 'T-C', parent: 'T', child: 'C', kind: 'down', label: 'has' },
    { id: 'L-C', parent: 'L', child: 'C', kind: 'down', label: 'has' },
    { id: 'A-C', parent: 'A', child: 'C', kind: 'cross', label: 'has' },
  ]);
  const count = clashesInto(routes, positions, 'C');
  assert(count === 0, `FAIL 6u2: no two lines into C cross (${count})`);
}
// 6u3. A line from below enters under the trunk, so it takes none of the room the trunk keeps.
{
  const positions = { P: { x: 300, y: 100 }, C: { x: 330, y: 250 }, B: { x: 0, y: 500 } };
  const routes = routeTree(['P', 'C', 'B'].map(id => node(id)), positions, [
    { id: 'P-C', parent: 'P', child: 'C', kind: 'down', label: 'has' },
    { id: 'B-C', parent: 'B', child: 'C', kind: 'cross', label: 'has' },
  ]);
  assert(routes.get('P-C')?.kind === 'down', `FAIL 6u3: P's tree line stays a tree line (${routes.get('P-C')?.kind})`);
}
// 6v. Lines from above that both need a jog into one child neither cross nor overlap,
//     and a jog's run across above the child never crosses another line's column.
{
  const scenes = [
    { boxes: [blocker('X', -100, 345, 200, 230)], name: 'one wide box' },
    { boxes: [blocker('R', 337, 500, 30, 60), blocker('W1', -100, 316, 40, 90), blocker('W2', 324, 335, 40, 90), blocker('Z', 310, 316, 150, 180)], name: 'a box maze' },
  ];
  for (const scene of scenes) {
    const positions: Record<string, { x: number; y: number }> = { A: { x: 0, y: 0 }, B: { x: 0, y: 100 }, C: { x: 400, y: 300 } };
    for (const b of scene.boxes) positions[b.node.id] = b.at;
    const routes = routeTree([node('A'), node('B'), node('C'), ...scene.boxes.map(b => b.node)], positions, [
      { id: 'A-C', parent: 'A', child: 'C', kind: 'cross', label: 'has' },
      { id: 'B-C', parent: 'B', child: 'C', kind: 'cross', label: 'has' },
    ]);
    const ac = routes.get('A-C');
    const bc = routes.get('B-C');
    const count = ac && bc ? clashes(drawn(ac, positions), drawn(bc, positions)) : -1;
    assert(count === 0, `FAIL 6v: with ${scene.name}, the two lines into C neither cross nor overlap (${count})`);
  }
}
// 6v2. A jog's drop stays beside its child: the only clear column, 550 px past it, is not taken.
{
  const wall = blocker('X', 200, 1000, 150, 250);
  const positions: Record<string, { x: number; y: number }> = { P: { x: 0, y: 0 }, T: { x: 325, y: 100 }, C: { x: 400, y: 300 }, X: wall.at };
  const routes = routeTree([node('P'), node('T'), node('C'), wall.node], positions, [
    { id: 'T-C', parent: 'T', child: 'C', kind: 'down', label: 'has' },
    { id: 'P-C', parent: 'P', child: 'C', kind: 'cross', label: 'has' },
  ]);
  const jog = routes.get('P-C')?.slot.jog;
  assert(jog === undefined || jog.dropDx <= 112, `FAIL 6v2: a jog drops no further than 12 px past its child (${jog?.dropDx})`);
}
// 6v2b. A line from a parent far to the right may drop anywhere short of its own lane: its path only runs left.
{
  const boxes = [blocker('X', 300, 470, 150, 250), blocker('W', -300, 299, 150, 250)];
  const positions: Record<string, { x: number; y: number }> = { P: { x: 900, y: 0 }, C: { x: 400, y: 300 } };
  for (const b of boxes) positions[b.node.id] = b.at;
  const routes = routeTree([node('P'), node('C'), ...boxes.map(b => b.node)], positions,
    [{ id: 'P-C', parent: 'P', child: 'C', kind: 'cross', label: 'has' }]);
  const jog = routes.get('P-C')?.slot.jog;
  assert(jog !== undefined && jog.dropDx > 112, `FAIL 6v2b: the line jogs right of the box, past its child (${jog?.dropDx})`);
}
// 6v3. Jogs into different children never drop down one column, where they would draw as one line.
{
  const wall = { node: { id: 'X', width: 387, height: 63, group: 'g', classifier: false }, at: { x: 257, y: 199 } };
  const positions: Record<string, { x: number; y: number }> = {
    C1: { x: 400, y: 284 }, C2: { x: 490, y: 447 }, P1: { x: 266, y: 76 }, P2: { x: 22, y: 113 }, X: wall.at,
  };
  const routes = routeTree([node('C1'), node('C2'), node('P1'), node('P2'), wall.node], positions, [
    { id: 'P1-C1', parent: 'P1', child: 'C1', kind: 'cross', label: 'has' },
    { id: 'P2-C2', parent: 'P2', child: 'C2', kind: 'cross', label: 'has' },
  ]);
  const a = routes.get('P1-C1')?.slot.jog;
  const b = routes.get('P2-C2')?.slot.jog;
  const apart = a === undefined || b === undefined || Math.abs(350 + a.dropDx - (440 + b.dropDx)) >= 6;
  assert(apart, `FAIL 6v3: two jogs drop at least 6 px apart (${a?.dropDx}, ${b?.dropDx})`);
}
// 6w. Each blocked line from above jogs when it has a clear column, the outer ones to either side.
{
  const boxes = [blocker('K', 328, 342, 150, 250), blocker('W', -100, 327, 150, 250)];
  const positions: Record<string, { x: number; y: number }> = { A: { x: 0, y: 0 }, B: { x: 0, y: 100 }, C: { x: 400, y: 300 } };
  for (const b of boxes) positions[b.node.id] = b.at;
  const routes = routeTree([node('A'), node('B'), node('C'), ...boxes.map(b => b.node)], positions, [
    { id: 'A-C', parent: 'A', child: 'C', kind: 'cross', label: 'has' },
    { id: 'B-C', parent: 'B', child: 'C', kind: 'cross', label: 'has' },
  ]);
  const ac = routes.get('A-C');
  const bc = routes.get('B-C');
  const count = ac && bc ? clashes(drawn(ac, positions), drawn(bc, positions)) : -1;
  assert(ac?.slot.jog !== undefined && bc?.slot.jog !== undefined && count === 0,
    `FAIL 6w: both lines jog and neither crosses the other (${ac?.slot.jog?.dropDx}, ${bc?.slot.jog?.dropDx}, ${count})`);
}
// 6x. A column's drop on a box moves left of it and keeps the labels on the runs.
{
  const box = blocker('B', 85, 115, 50, 70);
  const positions = { P: { x: 0, y: 0 }, C1: { x: 250, y: 100 }, C2: { x: 250, y: 150 }, C3: { x: 250, y: 200 }, B: box.at };
  const routes = routeTree([node('P'), node('C1'), node('C2'), node('C3'), box.node], positions,
    ['C1', 'C2', 'C3'].map(c => ({ id: `P-${c}`, parent: 'P', child: c, kind: 'cross', label: 'is placed by' })));
  const drops = [...routes.values()].map(r => 200 + r.slot.approachDx);
  assert([...routes.values()].every(r => r.runLabel === true) && drops.every(x => x < 83),
    `FAIL 6x: the drop moves left of the box at 85 (${drops.join(', ')})`);
}
// 6x2. A drop sits left of the other parents' columns into its children and a full label run from them;
//      with no room for that right of the parent, its lines take their own slots.
{
  const positions = { C: { x: 400, y: 300 }, C2: { x: 400, y: 400 }, O: { x: 290, y: 0 }, A1: { x: -300, y: 50 }, A2: { x: -300, y: 100 } };
  const lines = (o: string): TreeLine[] => [
    { id: `${o}-C`, parent: o, child: 'C', kind: 'cross', label: 'has' },
    { id: `${o}-C2`, parent: o, child: 'C2', kind: 'cross', label: 'has' },
    { id: 'A1-C', parent: 'A1', child: 'C', kind: 'cross', label: 'has' },
    { id: 'A2-C', parent: 'A2', child: 'C', kind: 'cross', label: 'has' },
  ];
  const near = routeTree(Object.keys(positions).map(id => node(id)), positions, lines('O'));
  const count = clashesInto(near, positions, 'C');
  assert(count === 0 && !near.get('O-C')?.runLabel, `FAIL 6x2: a parent too close to the column gives up its drop (${count})`);
  // Seven other lines into C need 12 + 7 × 6 = 54 px of columns, more than the 46 px label run.
  const more = ['A3', 'A4', 'A5', 'A6', 'A7'];
  const far: Record<string, { x: number; y: number }> = { ...positions, F: { x: 0, y: 0 } };
  more.forEach((id, i) => { far[id] = { x: -450 - 150 * Math.floor(i / 3), y: 50 + 50 * (i % 3) }; });
  const routes = routeTree(Object.keys(far).map(id => node(id)), far,
    [...lines('F'), ...more.map((id): TreeLine => ({ id: `${id}-C`, parent: id, child: 'C', kind: 'cross', label: 'has' }))]);
  const drop = routes.get('F-C');
  const run = drop ? -drop.slot.approachDx : 0;
  const others = ['A1', 'A2', ...more].map(id => -(routes.get(`${id}-C`)?.slot.approachDx ?? 0));
  assert(drop?.runLabel === true && run >= 46 && others.every(o => run > o),
    `FAIL 6x2: a far parent's drop sits a label run left of the column, left of the other columns (${run} vs ${others.join(', ')})`);
}
// 6y. A drop of several lines stays shared when another street crosses it: on their own streets,
//     at most 2 px apart, their labels would print as one.
{
  const positions = { O: { x: 0, y: 0 }, M1: { x: 400, y: 200 }, M2: { x: 400, y: 250 }, R: { x: -100, y: 150 } };
  const routes = routeTree(['O', 'M1', 'M2', 'R'].map(id => node(id)), positions, [
    { id: 'O-M1', parent: 'O', child: 'M1', kind: 'cross', label: 'has' },
    { id: 'O-M2', parent: 'O', child: 'M2', kind: 'cross', label: 'has' },
    { id: 'R-M2', parent: 'R', child: 'M2', kind: 'cross', label: 'has' },
  ]);
  assert(routes.get('O-M1')?.runLabel === true && routes.get('O-M2')?.runLabel === true, 'FAIL 6y: O\'s two lines keep their shared drop');
}
// 6z. A one-line drop gives way when another line's street into its child would cross it.
{
  const positions = { O: { x: -100, y: 0 }, M: { x: 400, y: 250 }, R: { x: 0, y: 150 } };
  const routes = routeTree(['O', 'M', 'R'].map(id => node(id)), positions, [
    { id: 'O-M', parent: 'O', child: 'M', kind: 'cross', label: 'has' },
    { id: 'R-M', parent: 'R', child: 'M', kind: 'cross', label: 'has' },
  ]);
  const om = routes.get('O-M');
  const rm = routes.get('R-M');
  const count = om && rm ? clashes(drawn(om, positions), drawn(rm, positions)) : -1;
  assert(count === 0, `FAIL 6z: R's line into M crosses none of O's (${count})`);
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
  const { nodes, edges } = chainTo(32, 0);
  nodes.push(node('a'), { ...node('_joiner_A32_x', { width: 20 }), joiner: true }, node('m0'), node('m1'));
  edges.push(fk('A32', 'a'), fk('A32', '_joiner_A32_x'), fk('_joiner_A32_x', 'm0'), fk('_joiner_A32_x', 'm1'));
  const { positions } = layoutTree(nodes, edges);
  assert((positions['a']?.y ?? Infinity) < (positions['_joiner_A32_x']?.y ?? -Infinity), 'FAIL 7i2: without room to wrap, the joiner keeps its place');
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
  const down: TreeRoute = { kind: 'down', parent: 'P', child: 'C', trunkDx: 10, slot, entryDy: 0 };
  check('below-right', down, { x: 250, y: 200, width: 100, height: 30 }, 'down');
  // After a hide or reveal the child can sit level with or above the parent, or under its trunk.
  check('above', down, { x: 250, y: 40, width: 100, height: 30 }, 'cross');
  check('under the trunk', down, { x: 90, y: 200, width: 100, height: 30 }, 'cross');
  const cross: TreeRoute = { kind: 'cross', parent: 'P', child: 'C', trunkDx: 0, slot, entryDy: 3 };
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
      const vx = r.kind === 'down' ? parent.x - 50 + r.trunkDx : at(child).x - 50 + r.slot.approachDx;
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
