/**
 * test-grouped-layered.ts — the hierarchical layout keeps each colour family
 * in one block, so the family order and the block packing decide where every
 * family lands.
 *
 * Coverage:
 *   1. A family other families reference comes before them (its tables are
 *      the parents the cross-family FKs point at).
 *   2. A reference cycle still yields every family once, in the same order on
 *      every run.
 *   3. Packed blocks never overlap and keep the gap between them.
 *   4. A short block fills the hole beside a tall one instead of opening a new
 *      row under it.
 *   5. On a headless graph, layoutByGroup places every node and no two
 *      groups' blocks overlap, with a subtype joiner kept in its group.
 */

import cytoscape from 'cytoscape';
import { buildScratchCore } from '../../src/app/views/graph/organic-layout';
import { layoutByGroup, orderRegions, packRegions } from '../../src/app/views/graph/grouped-layered';
import type { RegionBox, RegionEdge } from '../../src/app/views/graph/grouped-layered';
import { assert } from '../assert';

// 1. referenced family first: sales and finance both point at core.
{
  const edges: RegionEdge[] = [
    { source: 'core', target: 'sales' },
    { source: 'core', target: 'finance' },
    { source: 'sales', target: 'finance' },
  ];
  const order = orderRegions(['finance', 'sales', 'core'], edges);
  assert(order.join(',') === 'core,sales,finance', `FAIL 1: expected core,sales,finance, got ${order.join(',')}`);
}

// 2. cycle: a → b → c → a, plus a second a → b edge so a has the most outgoing weight.
{
  const edges: RegionEdge[] = [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'a' },
  ];
  const first = orderRegions(['c', 'b', 'a'], edges);
  const second = orderRegions(['a', 'c', 'b'], edges);
  assert(first.length === 3 && new Set(first).size === 3, `FAIL 2a: every family once, got ${first.join(',')}`);
  assert(first.join(',') === second.join(','), `FAIL 2b: order depends on input order: ${first} vs ${second}`);
}

// 3 + 4. packing.
{
  const gap = 20;
  const boxes: RegionBox[] = [
    { id: 'tall', width: 400, height: 900 },
    { id: 'wide', width: 500, height: 200 },
    { id: 'short', width: 300, height: 150 },
    { id: 'small', width: 120, height: 100 },
  ];
  const corners = packRegions(boxes, 16 / 10, gap);
  assert(corners.size === boxes.length, 'FAIL 3a: every box placed');

  const rects = boxes.map((b) => {
    const c = corners.get(b.id) ?? { x: NaN, y: NaN };
    return { id: b.id, x1: c.x, y1: c.y, x2: c.x + b.width, y2: c.y + b.height };
  });
  for (const a of rects) {
    for (const b of rects) {
      if (a.id >= b.id) continue;
      const apart = a.x2 + gap <= b.x1 + 1e-6 || b.x2 + gap <= a.x1 + 1e-6
        || a.y2 + gap <= b.y1 + 1e-6 || b.y2 + gap <= a.y1 + 1e-6;
      assert(apart, `FAIL 3b: ${a.id} and ${b.id} overlap or sit closer than the gap`);
    }
  }

  const tall = rects.find(r => r.id === 'tall');
  const short = rects.find(r => r.id === 'short');
  assert(tall !== undefined && short !== undefined, 'FAIL 4a: boxes present');
  if (tall && short) {
    assert(short.y1 < tall.y2, `FAIL 4b: short block opened a row under the tall one (y=${short.y1}, tall ends ${tall.y2})`);
  }
}

// 5. End to end on a headless graph: each group lands in one block, blocks
//    apart, and a subtype joiner sits inside its cluster's block.
{
  const node = (id: string, group: string, parent?: string) =>
    ({ group: 'nodes' as const, data: parent ? { id, group, parent } : { id, group } });
  const edge = (source: string, target: string) =>
    ({ group: 'edges' as const, data: { id: `${source}-${target}`, source, target } });
  const live = cytoscape({
    headless: true,
    styleEnabled: true,
    style: [{ selector: 'node', style: { width: 80, height: 30 } }],
    elements: [
      node('Party', 'core'), node('Address', 'core'), node('Country', 'core'),
      { group: 'nodes', data: { id: '_cluster_Party_x', cluster: 'true' } },
      { group: 'nodes', data: { id: '_joiner_Party_x', joiner: 'true' } },
      node('Person', 'core', '_cluster_Party_x'), node('Business', 'core', '_cluster_Party_x'),
      node('Order', 'sales'), node('OrderLine', 'sales'), node('Invoice', 'sales'),
      node('Product', 'catalog'), node('Price', 'catalog'),
      edge('Party', '_joiner_Party_x'), edge('_joiner_Party_x', 'Person'), edge('_joiner_Party_x', 'Business'),
      edge('Country', 'Address'), edge('Party', 'Address'),
      edge('Party', 'Order'), edge('Order', 'OrderLine'), edge('Order', 'Invoice'),
      edge('Product', 'Price'), edge('Product', 'OrderLine'),
    ],
  });
  // elk.bundled.js takes Bun (a `self` but no `document`) for a web worker and
  // skips exporting its in-process worker; without `self` it runs in-process.
  Reflect.deleteProperty(globalThis, 'self');
  const layoutOptions = { name: 'elk', elk: { algorithm: 'layered', 'elk.direction': 'DOWN' } };
  const positions = await layoutByGroup(buildScratchCore(live, true), layoutOptions, 60);

  const groupOf = (id: string): string => (id === '_joiner_Party_x' ? 'core' : String(live.$id(id).data('group')));
  const boxes = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
  for (const [id, p] of Object.entries(positions)) {
    const g = groupOf(id);
    const b = boxes.get(g) ?? { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    boxes.set(g, { x1: Math.min(b.x1, p.x - 40), y1: Math.min(b.y1, p.y - 15), x2: Math.max(b.x2, p.x + 40), y2: Math.max(b.y2, p.y + 15) });
  }
  assert(Object.keys(positions).length === 11, `FAIL 5a: every childless node placed, got ${Object.keys(positions).length}`);
  const groups = [...boxes.entries()];
  for (const [ga, a] of groups) {
    for (const [gb, b] of groups) {
      if (ga >= gb) continue;
      const apart = a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1;
      assert(apart, `FAIL 5b: blocks ${ga} and ${gb} overlap`);
    }
  }
}

if (process.exitCode !== 1) console.log('PASS: test-grouped-layered');

// The in-process ELK worker keeps the Bun event loop alive.
process.exit();
