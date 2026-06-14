/**
 * test-cp4b-elk-edge-routing.ts — assertion check for CP-4b: ELK edge routing.
 *
 * CI assertion script (PASS/FAIL/exit-1 style, like other test/checks/*.ts).
 *
 * Verifies C15 from docs/spec/dfd-overhaul.md:
 *   - computeElkLayout returns edgeRoutes with entries for routed edges.
 *   - Every route polyline has ≥ 2 points (start + end).
 *   - ORTHOGONAL invariant: for each route, every consecutive point pair is
 *     axis-aligned (shares x OR shares y) within a small epsilon.
 *   - At least some routes have > 2 points (bend points exist — proves real
 *     routing, not just straight lines).
 *   - Routes stay within the layout bounding box (within tolerance).
 *
 * Diagram under test: memory-lifecycle from models/llm-memory-db-mssql
 * (the dense leaf diagram that exercises all five bands and has parallel edges).
 */

import { createRequire } from 'node:module';
import { parseFlows } from '../../src/flows/flow-parse';
import { buildFlowData } from '../../src/flow-view/flow-layout';
import {
  computeElkLayout,
  nodeSize,
  type ElkLayoutResult,
} from '../../src/flow-view/elk-flow-layout';
import type { FlowDiagram } from '../../src/flows/flow-parse';

const MODEL_DIR = 'models/llm-memory-db-mssql';
const TARGET = 'memory-lifecycle';

// Supply a Bun-compatible ELK workerFactory (see test-elk-flow-positions.ts).
const require = createRequire(import.meta.url);
const workerPath = require.resolve('elkjs/lib/elk-worker.min.js');
const workerFactory = () => new Worker(workerPath);

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Walk the leveled tree to find a diagram by id. */
function findDiagramInTree(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
  for (const d of diagrams) {
    if (d.id === id) return d;
    const found = findDiagramInTree(d.subDfds, id);
    if (found) return found;
  }
  return undefined;
}

type Pt = { x: number; y: number };

/** Check that two consecutive points are axis-aligned (same x or same y). */
function isAxisAligned(a: Pt, b: Pt, epsilon = 0.5): boolean {
  return Math.abs(a.x - b.x) < epsilon || Math.abs(a.y - b.y) < epsilon;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { flowModel } = await parseFlows(MODEL_DIR);

const diagram = findDiagramInTree(flowModel.diagrams, TARGET);
if (!diagram) {
  console.error(`FAIL: diagram "${TARGET}" not found`);
  process.exit(1);
}

const { nodes, edges } = buildFlowData(diagram);
console.log(`\n=== ${TARGET} ===`);
console.log(`  Nodes: ${nodes.length}, Edges: ${edges.length}`);

const result: ElkLayoutResult = await computeElkLayout(diagram, { workerFactory });

// ── C15a: edgeRoutes is present in result ─────────────────────────────────────

assert(
  'edgeRoutes' in result,
  'ElkLayoutResult must have an edgeRoutes field',
);
console.log('PASS C15a: edgeRoutes field present in ElkLayoutResult');

// ── C15b: at least the majority of edges have a route ─────────────────────────

const routedEdgeIds = Object.keys(result.edgeRoutes);
console.log(`  edgeRoutes entries: ${routedEdgeIds.length} / ${edges.length} edges`);

// ORTHOGONAL routing produces a section for every laid-out edge — expect ALL of
// them routed. A partial result means routing silently broke for some edges, so
// fail fast rather than tolerating a permissive fraction.
assert(
  routedEdgeIds.length === edges.length,
  `Every edge must have a routed section; got ${routedEdgeIds.length} / ${edges.length}`,
);
console.log(`PASS C15b: all ${routedEdgeIds.length} / ${edges.length} edges have routed geometry`);

// ── C15c: every route polyline has ≥ 2 points ────────────────────────────────

for (const [edgeId, pts] of Object.entries(result.edgeRoutes)) {
  assert(
    pts.length >= 2,
    `Route for edge "${edgeId}" has ${pts.length} point(s) — must have ≥ 2`,
  );
}
console.log(`PASS C15c: all ${routedEdgeIds.length} routes have ≥ 2 points`);

// ── C15d: ORTHOGONAL invariant — each segment is axis-aligned ────────────────

let failedSegments = 0;
for (const [edgeId, pts] of Object.entries(result.edgeRoutes)) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a === undefined || b === undefined) continue;
    if (!isAxisAligned(a, b)) {
      console.error(
        `  Non-orthogonal segment in edge "${edgeId}": ` +
        `(${a.x.toFixed(1)},${a.y.toFixed(1)}) → (${b.x.toFixed(1)},${b.y.toFixed(1)})`,
      );
      failedSegments++;
    }
  }
}
assert(
  failedSegments === 0,
  `${failedSegments} non-orthogonal segment(s) found — all segments must be axis-aligned`,
);
console.log('PASS C15d: all route segments are axis-aligned (ORTHOGONAL invariant holds)');

// ── C15e: at least some routes have > 2 points (bend points exist) ────────────

const routesWithBends = Object.entries(result.edgeRoutes).filter(([, pts]) => pts.length > 2);
assert(
  routesWithBends.length > 0,
  `Expected at least one route with bend points (> 2 pts), but all have exactly 2 — ELK routing may not be active`,
);
console.log(`PASS C15e: ${routesWithBends.length} route(s) have bend points (> 2 points)`);

// ── C15f: routes stay within the layout bounding box (with tolerance) ─────────

// Compute the bounding box from node positions + sizes.
const BBOX_TOLERANCE = 100; // px — ELK may route slightly outside node extents
let bbMinX = Infinity, bbMinY = Infinity, bbMaxX = -Infinity, bbMaxY = -Infinity;
for (const n of nodes) {
  const pos = result.positions[n.id];
  if (!pos) continue;
  const { width, height } = nodeSize(n);
  bbMinX = Math.min(bbMinX, pos.x);
  bbMinY = Math.min(bbMinY, pos.y);
  bbMaxX = Math.max(bbMaxX, pos.x + width);
  bbMaxY = Math.max(bbMaxY, pos.y + height);
}

if (isFinite(bbMinX)) {
  const expandedMinX = bbMinX - BBOX_TOLERANCE;
  const expandedMinY = bbMinY - BBOX_TOLERANCE;
  const expandedMaxX = bbMaxX + BBOX_TOLERANCE;
  const expandedMaxY = bbMaxY + BBOX_TOLERANCE;

  for (const [edgeId, pts] of Object.entries(result.edgeRoutes)) {
    for (const pt of pts) {
      assert(
        pt.x >= expandedMinX && pt.x <= expandedMaxX,
        `Route for edge "${edgeId}" has x=${pt.x.toFixed(1)} outside bounding box [${expandedMinX.toFixed(1)}, ${expandedMaxX.toFixed(1)}]`,
      );
      assert(
        pt.y >= expandedMinY && pt.y <= expandedMaxY,
        `Route for edge "${edgeId}" has y=${pt.y.toFixed(1)} outside bounding box [${expandedMinY.toFixed(1)}, ${expandedMaxY.toFixed(1)}]`,
      );
    }
  }
  console.log(
    `PASS C15f: all route points within bounding box ` +
    `[${expandedMinX.toFixed(0)},${expandedMinY.toFixed(0)}]–[${expandedMaxX.toFixed(0)},${expandedMaxY.toFixed(0)}] (±${BBOX_TOLERANCE}px tolerance)`,
  );
}

console.log('\nAll C15 assertions passed.');
process.exit(0);
