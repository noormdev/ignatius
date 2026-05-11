// =============================================================================
// layout.ts — Stage 5: produce coordinates for every node.
//
// Two-pass approach:
//   Pass A: within each group, run a small Sugiyama-style layout over the
//           identifying-edge subgraph restricted to that group's members.
//   Pass B: place each group on the canvas using cross-edge density as a
//           heuristic. Production version would use force-directed; the demo
//           version uses a deterministic 3-column arrangement.
// =============================================================================

import { Model, LayoutResult, NodePosition } from './types';

const ROW_HEIGHT = 120;
const COL_WIDTH = 180;
const NODE_W = 160;
const NODE_H = 80;
const GROUP_GUTTER = 100;

interface GroupLayout {
  members: string[];
  layers: Map<number, string[]>;
  width: number;
  height: number;
  positions: Map<string, NodePosition>;
}

export function layout(model: Model): LayoutResult {
  const groupLayouts = layoutWithinGroups(model);
  return placeGroups(model, groupLayouts);
}

// -----------------------------------------------------------------------------
// Pass A: Within-group Sugiyama
// -----------------------------------------------------------------------------

function layoutWithinGroups(model: Model): Map<string, GroupLayout> {
  // Bucket entities by primary group
  const byGroup = new Map<string, string[]>();
  for (const node of model.nodes.values()) {
    if (!node.primaryGroup) continue;
    if (!byGroup.has(node.primaryGroup)) byGroup.set(node.primaryGroup, []);
    byGroup.get(node.primaryGroup)!.push(node.name);
  }

  const out = new Map<string, GroupLayout>();
  for (const [groupName, members] of byGroup) {
    const memberSet = new Set(members);

    // Restrict identifying edges to in-group only
    const localParents = new Map<string, string[]>();
    for (const e of model.edges) {
      if (e.kind !== 'identifying') continue;
      if (!memberSet.has(e.parent) || !memberSet.has(e.child)) continue;
      if (!localParents.has(e.child)) localParents.set(e.child, []);
      localParents.get(e.child)!.push(e.parent);
    }

    // Sugiyama Phase 2: layer assignment via longest path
    const layerOf = new Map<string, number>();
    function computeLayer(n: string): number {
      const cached = layerOf.get(n);
      if (cached !== undefined) return cached;
      const parents = localParents.get(n) ?? [];
      const level = parents.length === 0 ? 0 : Math.max(...parents.map(computeLayer)) + 1;
      layerOf.set(n, level);
      return level;
    }
    for (const m of members) computeLayer(m);

    // Sugiyama Phase 3: order within each layer (group siblings under their parent)
    const layers = new Map<number, string[]>();
    for (const m of members) {
      const L = layerOf.get(m)!;
      if (!layers.has(L)) layers.set(L, []);
      layers.get(L)!.push(m);
    }
    for (const items of layers.values()) {
      items.sort((a, b) => {
        const pa = (localParents.get(a) ?? [])[0] ?? '';
        const pb = (localParents.get(b) ?? [])[0] ?? '';
        if (pa !== pb) return pa.localeCompare(pb);
        return a.localeCompare(b);
      });
    }

    // Sugiyama Phase 4: coordinate assignment within the group's local box
    const positions = new Map<string, NodePosition>();
    let maxX = 0, maxY = 0;
    for (const [L, items] of layers) {
      items.forEach((item, i) => {
        const pos: NodePosition = {
          group: groupName,
          x: i * COL_WIDTH,
          y: L * ROW_HEIGHT,
          width: NODE_W,
          height: NODE_H,
        };
        positions.set(item, pos);
        maxX = Math.max(maxX, pos.x + pos.width);
        maxY = Math.max(maxY, pos.y + pos.height);
      });
    }

    out.set(groupName, {
      members,
      layers,
      width: maxX,
      height: maxY,
      positions,
    });
  }

  return out;
}

// -----------------------------------------------------------------------------
// Pass B: Group placement (deterministic stand-in for force-directed)
// -----------------------------------------------------------------------------

function placeGroups(
  model: Model,
  groupLayouts: Map<string, GroupLayout>
): LayoutResult {
  // Count cross-group edges to rank groups by connectedness
  const crossWeight = new Map<string, number>();
  for (const e of model.edges) {
    const pg = model.nodes.get(e.parent)?.primaryGroup;
    const cg = model.nodes.get(e.child)?.primaryGroup;
    if (!pg || !cg || pg === cg) continue;
    crossWeight.set(pg, (crossWeight.get(pg) ?? 0) + 1);
    crossWeight.set(cg, (crossWeight.get(cg) ?? 0) + 1);
  }

  // Sort groups by weight desc — heaviest go to center column
  const sorted = Array.from(groupLayouts.keys()).sort(
    (a, b) => (crossWeight.get(b) ?? 0) - (crossWeight.get(a) ?? 0)
  );

  // Assign to 3 columns in a center-left-right rotating pattern
  const colOf = new Map<string, number>();
  const colOrder = [1, 0, 2];
  sorted.forEach((g, i) => colOf.set(g, colOrder[i % 3]));

  // Stack groups in each column
  const colGroups = new Map<number, string[]>([[0, []], [1, []], [2, []]]);
  for (const g of sorted) {
    colGroups.get(colOf.get(g)!)!.push(g);
  }

  // Compute per-column widths
  const colWidths = new Map<number, number>();
  for (const [col, gs] of colGroups) {
    const w = Math.max(0, ...gs.map(g => groupLayouts.get(g)!.width));
    colWidths.set(col, w);
  }

  // x-offset per column
  const colX = new Map<number, number>();
  colX.set(0, GROUP_GUTTER);
  colX.set(1, GROUP_GUTTER + colWidths.get(0)! + GROUP_GUTTER);
  colX.set(2, GROUP_GUTTER + colWidths.get(0)! + GROUP_GUTTER + colWidths.get(1)! + GROUP_GUTTER);

  // Vertical stacking within column
  const groupOrigin = new Map<string, { x: number; y: number }>();
  for (const [col, gs] of colGroups) {
    let y = GROUP_GUTTER;
    for (const g of gs) {
      groupOrigin.set(g, { x: colX.get(col)!, y });
      y += groupLayouts.get(g)!.height + GROUP_GUTTER;
    }
  }

  // Materialize final per-node coordinates
  const result: LayoutResult = new Map();
  for (const [groupName, gl] of groupLayouts) {
    const origin = groupOrigin.get(groupName)!;
    for (const [nodeName, pos] of gl.positions) {
      result.set(nodeName, {
        group: groupName,
        x: origin.x + pos.x,
        y: origin.y + pos.y,
        width: pos.width,
        height: pos.height,
      });
    }
  }

  return result;
}
