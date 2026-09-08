/**
 * test-flow-chip-placement.ts — pure geometry check for chip pile-up at a
 * high fan-out stack outlet (docs/spec/dfd-store-clusters.md).
 *
 * Replicates FlowDiagramSvg's own chip-placement pipeline (elkChannelChip →
 * suppressDuplicateChips → deoverlapChips) against hub-diagram's connected
 * view, using real ELK-computed positions and routed edges (headless, no
 * browser — the same computeElkLayout output FlowsView feeds the renderer),
 * then asserts the placed chip rectangles never intersect each other or a
 * node box.
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assert, must } from '../assert';
import { parseModels } from '../../src/model/parse';
import { parseFlows } from '../../src/flows/flow-parse';
import type { FlowDiagram } from '../../src/flows/flow-parse';
import { buildFlowData, resolveChipLines, stackNodeSize, stackRowLayout } from '../../src/flow-view/flow-layout';
import { computeElkLayout } from '../../src/flow-view/elk-flow-layout';
import {
  nodeBounds, sizingInfo, elkChannelChip, chipDims,
  suppressDuplicateChips, deoverlapChips, boxesOverlap,
} from '../../src/flow-view/FlowDiagramSvg';
import type { Box, Pt, FlowNode } from '../../src/flow-view/FlowDiagramSvg';

const ROOT = resolve(import.meta.dir, '../..');
const HUB_DFD = `${ROOT}/test/fixtures/hub-dfd`;

const require = createRequire(import.meta.url);
const workerPath = require.resolve('elkjs/lib/elk-worker.min.js');
const workerFactory = () => new Worker(workerPath);

function findDiagram(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
  for (const d of diagrams) {
    if (d.id === id) return d;
    const found = findDiagram(d.subDfds, id);
    if (found) return found;
  }
  return undefined;
}

const { flowModel } = await parseFlows(HUB_DFD);
const hub = findDiagram(flowModel.diagrams, 'hub-diagram');
if (!hub) throw new Error('hub-diagram not found in parsed hub-dfd model');

const { model: hubModel } = await parseModels(HUB_DFD);
const entityGroups: Record<string, string> = {};
for (const node of hubModel.nodes) if (node.group) entityGroups[node.id] = node.group;

const flowDataOpts = {
  view: 'connected' as const,
  collapseLevel: 'clusters' as const,
  clusters: flowModel.clusters,
  subtypeClusters: hubModel.subtypeClusters,
  groups: hubModel.groups,
  entityGroups,
};

const { nodes, edges } = buildFlowData(hub, flowDataOpts);
const { positions: elkPositions, edgeRoutes } = await computeElkLayout(hub, { ...flowDataOpts, workerFactory });
const positions = new Map(Object.entries(elkPositions));

const nodeById = new Map(nodes.map(n => [n.id, n]));

const nodeBoxes: Box[] = [];
for (const n of nodes) {
  const p = positions.get(n.id);
  if (!p) continue;
  const b = nodeBounds(p, n.nodeType, sizingInfo(n));
  nodeBoxes.push({ x: b.x, y: b.y, w: b.w, h: b.h });
}

type Render = { id: string; source: string; chip: { x: number; y: number }; lines: string[] };
const renders: Render[] = [];
for (const edge of edges) {
  const fromNode = nodeById.get(edge.source);
  const toNode = nodeById.get(edge.target);
  const fromPos = positions.get(edge.source);
  const toPos = positions.get(edge.target);
  const route = edgeRoutes[edge.id];
  if (!fromNode || !toNode || !fromPos || !toPos || !route || route.length < 2) continue;
  const fromLabel = sizingInfo(fromNode);
  const toLabel = sizingInfo(toNode);
  const elkPts: Pt[] = route.map((p): Pt => [p.x, p.y]);
  const chip = elkChannelChip(fromPos, fromNode.nodeType, fromLabel, toPos, toNode.nodeType, toLabel, elkPts);
  const { lines } = edge.chipLines
    ? { lines: edge.chipLines }
    : resolveChipLines(edge.label, edge.hasAuthoredLabel);
  renders.push({ id: edge.id, source: edge.source, chip, lines });
}

assert(renders.length > 0, 'FAIL: expected ELK to route at least one edge on hub-diagram\'s connected view, got 0');

suppressDuplicateChips(renders, new Set(), nodeById);
deoverlapChips(renders, nodeBoxes);

const chipRects = renders
  .filter(r => r.lines.length > 0)
  .map(r => {
    const { w, h } = chipDims(r.lines);
    return { id: r.id, box: { x: r.chip.x - w / 2, y: r.chip.y - h / 2, w, h } };
  });

assert(chipRects.length > 0, 'FAIL: expected at least one visible chip on hub-diagram\'s connected view, got 0');
console.log(`PASS: hub-diagram's connected view places ${chipRects.length} visible chip(s)`);

let chipOverlaps = 0;
for (let i = 0; i < chipRects.length; i++) {
  for (let j = i + 1; j < chipRects.length; j++) {
    if (boxesOverlap(chipRects[i]!.box, chipRects[j]!.box)) {
      chipOverlaps++;
      console.error(`FAIL: chip ${chipRects[i]!.id} overlaps chip ${chipRects[j]!.id}`);
    }
  }
}
assert(chipOverlaps === 0, `FAIL: ${chipOverlaps} chip-chip overlap(s) on hub-diagram's connected view`);
console.log('PASS: no two placed chips intersect on hub-diagram\'s connected view');

let chipNodeOverlaps = 0;
for (const cr of chipRects) {
  for (const nb of nodeBoxes) {
    if (boxesOverlap(cr.box, nb)) {
      chipNodeOverlaps++;
      console.error(`FAIL: chip ${cr.id} overlaps a node box`, nb);
    }
  }
}
assert(chipNodeOverlaps === 0, `FAIL: ${chipNodeOverlaps} chip-node overlap(s) on hub-diagram's connected view`);
console.log('PASS: no placed chip intersects a node box on hub-diagram\'s connected view');

// ---------------------------------------------------------------------------
// suppressDuplicateChips is scoped to stack outlets: a plain process writing
// the identical label to two genuinely different stores (Process Three's
// "log entry" to LogStoreOne and LogStoreTwo) must keep both chips — with
// flow_view.adjacency_stacks off, these render as two independent edges
// rather than one aggregated adjacency stack.
// ---------------------------------------------------------------------------

{
  const noAdjacencyOpts = { ...flowDataOpts, adjacencyStacks: false };
  const { nodes: n2, edges: e2 } = buildFlowData(hub, noAdjacencyOpts);
  const { positions: pos2, edgeRoutes: routes2 } = await computeElkLayout(hub, { ...noAdjacencyOpts, workerFactory });
  const positions2 = new Map(Object.entries(pos2));
  const nodeById2 = new Map(n2.map(n => [n.id, n]));

  const logEdges = e2.filter(e => e.source === 'proc:Process-Three' && (e.target === 'db:LogStoreOne' || e.target === 'db:LogStoreTwo'));
  assert(logEdges.length === 2, `FAIL: expected 2 plain edges from Process Three to the log stores with adjacency off, got ${logEdges.length}`);

  const logRenders: Render[] = [];
  for (const edge of logEdges) {
    const fromPos = must(positions2.get(edge.source), `position for ${edge.source}`);
    const toPos = must(positions2.get(edge.target), `position for ${edge.target}`);
    const route = must(routes2[edge.id], `ELK route for ${edge.id}`);
    const fromNode = must(nodeById2.get(edge.source), `node for ${edge.source}`);
    const toNode = must(nodeById2.get(edge.target), `node for ${edge.target}`);
    const elkPts: Pt[] = route.map((p): Pt => [p.x, p.y]);
    const { lines } = edge.chipLines ? { lines: edge.chipLines } : resolveChipLines(edge.label, edge.hasAuthoredLabel);
    logRenders.push({
      id: edge.id, source: edge.source,
      chip: elkChannelChip(fromPos, fromNode.nodeType, sizingInfo(fromNode), toPos, toNode.nodeType, sizingInfo(toNode), elkPts),
      lines,
    });
  }
  assert(
    logRenders.every(r => r.lines.join(',') === 'log entry'),
    `FAIL: expected both log-store edges labelled "log entry", got ${JSON.stringify(logRenders.map(r => r.lines))}`,
  );

  suppressDuplicateChips(logRenders, new Set(), nodeById2);
  assert(
    logRenders.every(r => r.lines.length > 0),
    `FAIL: a plain process's identical-label edges to two different stores must both keep their chip, got ${JSON.stringify(logRenders.map(r => r.lines))}`,
  );
  console.log('PASS: suppressDuplicateChips leaves both of a process\'s same-label edges to different stores visible (not a stack outlet)');
}

// ---------------------------------------------------------------------------
// A chipOverrides-dragged sibling suppresses every auto sibling in its group,
// regardless of the dragged position — a drag never resurrects a duplicate.
// ---------------------------------------------------------------------------

{
  const fakeStack: FlowNode = {
    kind: 'node', id: 'stack:synthetic--read', nodeType: 'stack', label: '2 stores',
    direction: 'read', members: [], rows: [], source: 'per-process',
  };
  const syntheticNodeById = new Map<string, FlowNode>([[fakeStack.id, fakeStack]]);
  const synthetic: Render[] = [
    { id: 'edge-a', source: fakeStack.id, chip: { x: 100, y: 200 }, lines: ['hub id'] },
    { id: 'edge-b', source: fakeStack.id, chip: { x: 105, y: 200 }, lines: ['hub id'] },
    { id: 'edge-c', source: fakeStack.id, chip: { x: 900, y: 200 }, lines: ['hub id'] }, // dragged far away
  ];
  suppressDuplicateChips(synthetic, new Set(['edge-c']), syntheticNodeById);
  const edgeA = must(synthetic.find(r => r.id === 'edge-a'), 'synthetic render edge-a');
  const edgeB = must(synthetic.find(r => r.id === 'edge-b'), 'synthetic render edge-b');
  const edgeC = must(synthetic.find(r => r.id === 'edge-c'), 'synthetic render edge-c');
  assert(edgeC.lines.length > 0, 'FAIL: the dragged (overridden) sibling must stay visible');
  assert(
    edgeA.lines.length === 0 && edgeB.lines.length === 0,
    `FAIL: every auto sibling must be suppressed once one sibling is dragged, got ${JSON.stringify(synthetic)}`,
  );
  console.log('PASS: a dragged survivor suppresses its auto siblings instead of one of them resurfacing');
}

// ---------------------------------------------------------------------------
// Channel bucketing anchors against the channel's FIRST member, not the
// previous one — a chain of siblings on a steady y-gradient (each 10px from
// the last, well under CHIP_CHANNEL_TOLERANCE=24) must not transitively merge
// into one channel once the span from the first member exceeds the tolerance.
// ---------------------------------------------------------------------------

{
  const fakeStack: FlowNode = {
    kind: 'node', id: 'stack:gradient--read', nodeType: 'stack', label: '2 stores',
    direction: 'read', members: [], rows: [], source: 'per-process',
  };
  const syntheticNodeById = new Map<string, FlowNode>([[fakeStack.id, fakeStack]]);
  // y = 0, 10, 20, 30, 40 — each step 10px (within tolerance of its immediate
  // neighbor) but the first (0) and last (40) are 40px apart (over tolerance).
  const gradient: Render[] = [0, 10, 20, 30, 40].map((y, i) => ({
    id: `edge-${i}`, source: fakeStack.id, chip: { x: 100, y }, lines: ['hub id'],
  }));
  suppressDuplicateChips(gradient, new Set(), syntheticNodeById);
  const visibleCount = gradient.filter(r => r.lines.length > 0).length;
  assert(
    visibleCount === 2,
    `FAIL: expected 2 surviving chips (two channels: y∈[0,20] and y∈[30,40]), got ${visibleCount}: ${JSON.stringify(gradient)}`,
  );
  console.log('PASS: channel bucketing anchors against the first member, not a transitive chain');
}

// ---------------------------------------------------------------------------
// nodeBounds' stack case must report the FULL drawn box (rows plus every
// grouped row's "more inside" peek reserve), not just the ELK-facing height
// — otherwise a chip can be placed in the reserve strip thinking it's clear
// and land on top of the peek marker's sheets.
// ---------------------------------------------------------------------------

{
  const groupsOpts = { ...flowDataOpts, view: 'per-process' as const, collapseLevel: 'groups' as const };
  const { nodes: gNodes, edges: gEdges } = buildFlowData(hub, groupsOpts);
  const { positions: gElkPositions, edgeRoutes: gEdgeRoutes } = await computeElkLayout(hub, { ...groupsOpts, workerFactory });
  const gPositions = new Map(Object.entries(gElkPositions));
  const gNodeById = new Map(gNodes.map(n => [n.id, n]));

  const stacksWithGroupedRow = gNodes.filter(n => n.nodeType === 'stack' && n.rows.some(r => r.kind !== 'store'));
  assert(
    stacksWithGroupedRow.length > 0,
    `FAIL: expected at least one stack with a grouped row on hub-diagram's per-process view at collapse=groups, got 0`,
  );
  console.log(`PASS: hub-diagram's per-process view at collapse=groups has ${stacksWithGroupedRow.length} stack(s) with a grouped row`);

  const gNodeBoxes: Box[] = [];
  for (const n of gNodes) {
    const p = gPositions.get(n.id);
    if (!p) continue;
    const b = nodeBounds(p, n.nodeType, sizingInfo(n));
    gNodeBoxes.push({ x: b.x, y: b.y, w: b.w, h: b.h });
  }

  const gRenders: Render[] = [];
  for (const edge of gEdges) {
    const fromNode = gNodeById.get(edge.source);
    const toNode = gNodeById.get(edge.target);
    const fromPos = gPositions.get(edge.source);
    const toPos = gPositions.get(edge.target);
    const route = gEdgeRoutes[edge.id];
    if (!fromNode || !toNode || !fromPos || !toPos || !route || route.length < 2) continue;
    const elkPts: Pt[] = route.map((p): Pt => [p.x, p.y]);
    const chip = elkChannelChip(fromPos, fromNode.nodeType, sizingInfo(fromNode), toPos, toNode.nodeType, sizingInfo(toNode), elkPts);
    const { lines } = edge.chipLines ? { lines: edge.chipLines } : resolveChipLines(edge.label, edge.hasAuthoredLabel);
    gRenders.push({ id: edge.id, source: edge.source, chip, lines });
  }

  suppressDuplicateChips(gRenders, new Set(), gNodeById);
  deoverlapChips(gRenders, gNodeBoxes);

  const gChipRects = gRenders
    .filter(r => r.lines.length > 0)
    .map(r => {
      const { w, h } = chipDims(r.lines);
      return { id: r.id, box: { x: r.chip.x - w / 2, y: r.chip.y - h / 2, w, h } };
    });

  // The stack's TRUE drawn box — width/vertical-center from stackNodeSize (the
  // ELK-facing size, same center StackNode anchors its top to) but height from
  // stackRowLayout (rows plus every grouped row's peek reserve), independent of
  // whatever nodeBounds itself currently reports — this is the box a chip must
  // never land inside, not the (possibly still-buggy) box used to place it.
  const stackBoxesByNodeId = new Map<string, Box>();
  for (const n of stacksWithGroupedRow) {
    if (n.nodeType !== 'stack') continue;
    const p = gPositions.get(n.id);
    if (!p) continue;
    const { width: w, height: officialH } = stackNodeSize(n.members, n.rows);
    const { height: visualH } = stackRowLayout(n.rows);
    stackBoxesByNodeId.set(n.id, { x: p.x - w / 2, y: p.y - officialH / 2, w, h: visualH });
  }

  let chipStackOverlaps = 0;
  for (const cr of gChipRects) {
    for (const [stackId, box] of stackBoxesByNodeId) {
      if (boxesOverlap(cr.box, box)) {
        chipStackOverlaps++;
        console.error(`FAIL: chip ${cr.id} overlaps grouped-row stack ${stackId}'s visual box`);
      }
    }
  }
  assert(
    chipStackOverlaps === 0,
    `FAIL: ${chipStackOverlaps} chip-vs-grouped-stack overlap(s) on hub-diagram's per-process view at collapse=groups`,
  );
  console.log('PASS: no chip overlaps a grouped-row stack\'s visual box on hub-diagram\'s per-process view at collapse=groups');
}

console.log('\nFlow chip placement: all assertions passed.');
process.exit(process.exitCode ?? 0);
