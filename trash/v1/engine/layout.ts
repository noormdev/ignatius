// =============================================================================
// layout.ts — Stage 5: positions + orthogonal edge routes via ELK.
//
// Per-edge port convention (matches the diagram contract):
//   * source-side: SOUTH (bottom of node) — one port per outgoing edge
//   * target-side: WEST  (left   of node) — one port per incoming edge
//   * portConstraints = FIXED_SIDE
// ELK lays the layered hierarchy out and produces orthogonal edge polylines
// terminating at the per-edge ports.
//
// Output:
//   positions  : Map<entityName, NodePosition>
//   edgeRoutes : Map<edgeIndex,  EdgeRoute>      (polyline incl. endpoints)
// =============================================================================

import ELK from 'elkjs/lib/elk.bundled.js';
import type { Model, LayoutResult, EdgeRoutes, EdgeRoute } from './types';

const NODE_W = 220;
const NODE_H = 150;

const elk = new ELK();

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '120',
  'elk.spacing.nodeNode': '80',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.edgeNode': '24',
  'elk.spacing.edgeEdge': '16',
  'elk.layered.spacing.edgeNodeBetweenLayers': '40',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  'elk.padding': '[top=60,left=60,bottom=60,right=60]',
};

const NODE_LAYOUT_OPTIONS = {
  'portConstraints': 'FIXED_SIDE',
  // Distribute ports evenly along their side; ELK picks the within-side order
  // to minimize crossings.
  'org.eclipse.elk.portAlignment.south': 'DISTRIBUTED',
  'org.eclipse.elk.portAlignment.west':  'DISTRIBUTED',
};

export interface LayoutOutput {
  positions:  LayoutResult;
  edgeRoutes: EdgeRoutes;
}

export async function layout(model: Model): Promise<LayoutOutput> {
  // Index outgoing / incoming edges per entity (covering ALL edges — identifying
  // and referential alike all follow the SOUTH-out / WEST-in convention).
  const outgoing = new Map<string, number[]>();
  const incoming = new Map<string, number[]>();
  for (const name of model.nodes.keys()) {
    outgoing.set(name, []);
    incoming.set(name, []);
  }
  model.edges.forEach((e, i) => {
    outgoing.get(e.parent)?.push(i);
    incoming.get(e.child)?.push(i);
  });

  // Build ELK input
  const elkNodes = [...model.nodes.values()].map(n => {
    const outs = outgoing.get(n.name) ?? [];
    const ins  = incoming.get(n.name) ?? [];
    const ports = [
      ...outs.map(i => ({
        id: `${n.name}.out-${i}`,
        layoutOptions: { 'port.side': 'SOUTH' },
      })),
      ...ins.map(i => ({
        id: `${n.name}.in-${i}`,
        layoutOptions: { 'port.side': 'WEST' },
      })),
    ];
    return {
      id: n.name,
      width: NODE_W,
      height: NODE_H,
      ports,
      layoutOptions: NODE_LAYOUT_OPTIONS,
    };
  });

  const elkEdges = model.edges.map((e, i) => ({
    id: `e${i}`,
    sources: [`${e.parent}.out-${i}`],
    targets: [`${e.child}.in-${i}`],
  }));

  const elkGraph = {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: elkNodes,
    edges: elkEdges,
  };

  const result = await elk.layout(elkGraph);

  // Extract positions
  const positions: LayoutResult = new Map();
  for (const child of result.children ?? []) {
    if (!child.id || child.x == null || child.y == null) continue;
    const entity = model.nodes.get(child.id);
    positions.set(child.id, {
      group:  entity?.primaryGroup ?? '',
      x:      child.x,
      y:      child.y,
      width:  child.width  ?? NODE_W,
      height: child.height ?? NODE_H,
    });
  }

  // Extract edge polylines. ELK reports each edge's path as a `sections` array;
  // for orthogonal routing each edge has exactly one section. Stitch
  // startPoint → bendPoints → endPoint into a single polyline.
  const edgeRoutes: EdgeRoutes = new Map();
  for (const e of result.edges ?? []) {
    if (!e.id || !e.sections || e.sections.length === 0) continue;
    const idx = parseInt(e.id.slice(1), 10);
    if (Number.isNaN(idx)) continue;
    const section = e.sections[0];
    const points = [
      { x: section.startPoint.x, y: section.startPoint.y },
      ...((section.bendPoints ?? []).map(p => ({ x: p.x, y: p.y }))),
      { x: section.endPoint.x,   y: section.endPoint.y   },
    ];
    edgeRoutes.set(idx, { edgeIndex: idx, points });
  }

  return { positions, edgeRoutes };
}
