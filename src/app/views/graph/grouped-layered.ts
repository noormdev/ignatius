import cytoscape from 'cytoscape';
import type { PositionMap } from './layout-store';

// Flat ELK layered spreads every colour family across every layer, and one
// compound per family stacks them in a tall column: see docs/design/graph-arrangement.md.

export type RegionBox = { id: string; width: number; height: number };
export type RegionEdge = { source: string; target: string };

const UNGROUPED_REGION = '';

// Referenced families first, so the picture reads top-down like each block.
export function orderRegions(ids: string[], edges: RegionEdge[]): string[] {
  const incoming = new Map<string, Map<string, number>>();
  const outgoingWeight = new Map<string, number>();
  for (const id of ids) {
    incoming.set(id, new Map());
    outgoingWeight.set(id, 0);
  }
  for (const { source, target } of edges) {
    if (source === target) continue;
    const into = incoming.get(target);
    if (!into || !incoming.has(source)) continue;
    into.set(source, (into.get(source) ?? 0) + 1);
    outgoingWeight.set(source, (outgoingWeight.get(source) ?? 0) + 1);
  }

  const placed = new Set<string>();
  const order: string[] = [];
  const unplacedIncoming = (id: string) => {
    let total = 0;
    for (const [from, weight] of incoming.get(id) ?? []) {
      if (!placed.has(from)) total += weight;
    }
    return total;
  };
  while (order.length < ids.length) {
    let best: string | null = null;
    for (const id of [...ids].sort()) {
      if (placed.has(id)) continue;
      if (best === null) { best = id; continue; }
      const byIncoming = unplacedIncoming(id) - unplacedIncoming(best);
      const byOutgoing = (outgoingWeight.get(best) ?? 0) - (outgoingWeight.get(id) ?? 0);
      if (byIncoming < 0 || (byIncoming === 0 && byOutgoing < 0)) best = id;
    }
    if (best === null) break;
    placed.add(best);
    order.push(best);
  }
  return order;
}

// Skyline packing, so a short box fills the hole beside a tall one instead of
// opening a row under it. Returns top-left corners; `aspect` is width / height.
export function packRegions(boxes: RegionBox[], aspect: number, gap: number): Map<string, { x: number; y: number }> {
  const area = boxes.reduce((sum, b) => sum + (b.width + gap) * (b.height + gap), 0);
  const widest = boxes.reduce((max, b) => Math.max(max, b.width + gap), 0);
  const limit = Math.max(widest, Math.sqrt(area * aspect));

  // The skyline: contiguous segments covering [0, limit), each with the y
  // where free space starts.
  let skyline = [{ x: 0, width: limit, y: 0 }];
  const corners = new Map<string, { x: number; y: number }>();
  for (const box of boxes) {
    const span = box.width + gap;
    let bestX = 0;
    let bestY = Infinity;
    for (const start of skyline) {
      if (start.x + span > limit + 1e-6) continue;
      const top = skyline
        .filter(s => s.x < start.x + span && s.x + s.width > start.x)
        .reduce((max, s) => Math.max(max, s.y), 0);
      if (top < bestY) { bestY = top; bestX = start.x; }
    }
    corners.set(box.id, { x: bestX, y: bestY });
    skyline = raiseSkyline(skyline, bestX, span, bestY + box.height + gap);
  }
  return corners;
}

function raiseSkyline(
  skyline: { x: number; width: number; y: number }[],
  x: number,
  width: number,
  y: number,
): { x: number; width: number; y: number }[] {
  const end = x + width;
  const next: { x: number; width: number; y: number }[] = [];
  for (const s of skyline) {
    const sEnd = s.x + s.width;
    if (sEnd <= x || s.x >= end) { next.push(s); continue; }
    if (s.x < x) next.push({ x: s.x, width: x - s.x, y: s.y });
    if (sEnd > end) next.push({ x: end, width: sEnd - end, y: s.y });
  }
  next.push({ x, width, y });
  return next.sort((a, b) => a.x - b.x);
}

const REGION_PREFIX = '_group_';

function regionOf(node: cytoscape.NodeSingular): string {
  const region = node.ancestors().filter(a => a.id().startsWith(REGION_PREFIX));
  return region.nonempty() ? region.first().id() : UNGROUPED_REGION;
}

function layoutRegion(
  members: cytoscape.NodeCollection,
  layoutOptions: cytoscape.LayoutOptions,
): Promise<PositionMap> {
  const memberIds = new Set(members.map(n => n.id()));
  const elements: cytoscape.ElementDefinition[] = [];
  members.forEach((n) => {
    const data = { ...n.data() };
    if (data.parent !== undefined && !memberIds.has(data.parent)) delete data.parent;
    elements.push({ group: 'nodes', data });
  });
  members.connectedEdges().forEach((e) => {
    if (memberIds.has(e.source().id()) && memberIds.has(e.target().id())) {
      elements.push({ group: 'edges', data: { ...e.data() } });
    }
  });
  const region = cytoscape({
    headless: true,
    styleEnabled: true,
    elements,
    style: [{ selector: 'node[dw]', style: { 'width': 'data(dw)', 'height': 'data(dh)' } }],
  });
  return new Promise((resolve) => {
    region.one('layoutstop', () => {
      const positions: PositionMap = {};
      region.nodes(':childless').forEach((n) => {
        const p = n.position();
        positions[n.id()] = { x: p.x, y: p.y };
      });
      region.destroy();
      resolve(positions);
    });
    region.layout(layoutOptions).run();
  });
}

// `scratch` must come from buildScratchCore(live, true): each top-level
// compound is a colour-family region, and ungrouped nodes sit at the top level.
export async function layoutByGroup(
  scratch: cytoscape.Core,
  layoutOptions: cytoscape.LayoutOptions,
  gap: number,
): Promise<PositionMap> {
  const regions = new Map<string, cytoscape.NodeCollection>();
  scratch.nodes().forEach((n) => {
    if (n.parent().nonempty()) return;
    if (n.id().startsWith(REGION_PREFIX)) {
      regions.set(n.id(), n.descendants());
    } else {
      const loose = regions.get(UNGROUPED_REGION) ?? scratch.collection();
      regions.set(UNGROUPED_REGION, loose.union(n).union(n.descendants()));
    }
  });

  const local = new Map<string, PositionMap>();
  const boxes: RegionBox[] = [];
  for (const [id, members] of regions) {
    const positions = await layoutRegion(members, layoutOptions);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [nodeId, p] of Object.entries(positions)) {
      const n = scratch.$id(nodeId);
      const halfW = n.width() / 2;
      const halfH = n.height() / 2;
      x1 = Math.min(x1, p.x - halfW); x2 = Math.max(x2, p.x + halfW);
      y1 = Math.min(y1, p.y - halfH); y2 = Math.max(y2, p.y + halfH);
    }
    if (!Number.isFinite(x1)) continue;
    for (const p of Object.values(positions)) { p.x -= x1; p.y -= y1; }
    local.set(id, positions);
    boxes.push({ id, width: x2 - x1, height: y2 - y1 });
  }

  const crossEdges: RegionEdge[] = [];
  scratch.edges().forEach((e) => {
    const source = regionOf(e.source());
    const target = regionOf(e.target());
    if (source !== target) crossEdges.push({ source, target });
  });
  const order = orderRegions(boxes.map(b => b.id), crossEdges);
  const byId = new Map(boxes.map(b => [b.id, b]));
  const ordered = order.flatMap(id => byId.get(id) ?? []);
  const corners = packRegions(ordered, 16 / 10, gap);

  const result: PositionMap = {};
  for (const [id, positions] of local) {
    const corner = corners.get(id) ?? { x: 0, y: 0 };
    for (const [nodeId, p] of Object.entries(positions)) {
      result[nodeId] = { x: p.x + corner.x, y: p.y + corner.y };
    }
  }
  return result;
}
