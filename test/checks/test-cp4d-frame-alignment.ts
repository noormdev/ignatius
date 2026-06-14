/**
 * test-cp4d-frame-alignment.ts — assertion check for CP-4d: coordinate-frame fix.
 *
 * CI assertion script (PASS/FAIL/exit-1 style, like other test/checks/*.ts).
 *
 * Verifies C17 from docs/spec/dfd-overhaul.md:
 *   - ELK positions are returned as node CENTERS (ELK top-left + half size),
 *     matching the renderer's center-based convention (nodeBounds treats a
 *     position as the node center).
 *   - Consequently each ELK edge-route endpoint connects to its endpoint node's
 *     rendered (center-based) bounding box — routes do not pass through or beside
 *     nodes from a half-node offset.
 *
 * Test strategy:
 *   For each edge with a route in edgeRoutes:
 *     - Let srcPos = positions[edge.source], tgtPos = positions[edge.target].
 *     - Compute center-based bounds: the rect [cx - w/2, cx + w/2] × [cy - h/2, cy + h/2].
 *     - Assert the route's FIRST point lies within ε (6px) of the source node's
 *       center-based bounds (maxDistance = max(0, dist outside rect) ≤ ε).
 *     - Assert the route's LAST point lies within ε of the target node's bounds.
 *
 * This FAILS on top-left positions (endpoints sit ~half-a-node outside the
 * rendered box) and PASSES once positions are node centers.
 *
 * Diagrams under test: memory-lifecycle and tag-administration from
 * models/llm-memory-db-mssql (the two dense leaves with all five bands).
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
const TARGETS = ['memory-lifecycle', 'tag-administration'];

// ε in pixels — the maximum distance a route endpoint may lie outside
// the center-based node bounding box.
const EPSILON = 6;

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

// ── Types ────────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };

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

/**
 * distOutsideRect — distance a point lies outside a center-based bounding box.
 *
 * Returns 0 if the point is inside or on the rect. Otherwise returns the
 * Chebyshev distance from the point to the nearest edge.
 *
 * The rect is defined by its center (cx, cy) and half-sizes (hw, hh).
 */
function distOutsideRect(pt: Pt, cx: number, cy: number, hw: number, hh: number): number {
  const dx = Math.max(0, Math.abs(pt.x - cx) - hw);
  const dy = Math.max(0, Math.abs(pt.y - cy) - hh);
  return Math.max(dx, dy);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { flowModel } = await parseFlows(MODEL_DIR);

let totalEdges = 0;
let totalFailed = 0;

for (const target of TARGETS) {
  console.log(`\n=== ${target} ===`);

  const diagram = findDiagramInTree(flowModel.diagrams, target);
  if (!diagram) {
    console.error(`FAIL: diagram "${target}" not found`);
    process.exit(1);
  }

  const { nodes, edges } = buildFlowData(diagram);
  const result: ElkLayoutResult = await computeElkLayout(diagram, { workerFactory });

  // Build a map from node id → center-based bounds for quick lookup.
  // center-based: position is the node CENTER (cx, cy); bounds extend ±(w/2, h/2).
  const nodeBoundsMap = new Map<string, { cx: number; cy: number; hw: number; hh: number }>();
  for (const n of nodes) {
    const pos = result.positions[n.id];
    if (pos === undefined) continue;
    const { width, height } = nodeSize(n);
    nodeBoundsMap.set(n.id, {
      cx: pos.x,
      cy: pos.y,
      hw: width / 2,
      hh: height / 2,
    });
  }

  // Build a map from node id → edge element for source/target lookup.
  const edgeMap = new Map<string, { source: string; target: string }>();
  for (const e of edges) {
    edgeMap.set(e.id, { source: e.source, target: e.target });
  }

  let diagramFailed = 0;

  for (const [edgeId, pts] of Object.entries(result.edgeRoutes)) {
    totalEdges++;

    const edgeInfo = edgeMap.get(edgeId);
    if (edgeInfo === undefined) {
      // Route for an edge we didn't ask for — skip.
      continue;
    }

    const { source, target } = edgeInfo;

    const srcBounds = nodeBoundsMap.get(source);
    const tgtBounds = nodeBoundsMap.get(target);

    if (srcBounds === undefined || tgtBounds === undefined) {
      // Position missing — already caught by C4 test; skip here.
      continue;
    }

    const firstPt = pts[0];
    const lastPt = pts[pts.length - 1];

    if (firstPt === undefined || lastPt === undefined) {
      console.error(`FAIL: route for edge "${edgeId}" has no points`);
      process.exit(1);
    }

    // Assert first point is within ε of source node's center-based bounds.
    const srcDist = distOutsideRect(firstPt, srcBounds.cx, srcBounds.cy, srcBounds.hw, srcBounds.hh);
    if (srcDist > EPSILON) {
      console.error(
        `  C17 FAIL: edge "${edgeId}" first point (${firstPt.x.toFixed(1)},${firstPt.y.toFixed(1)}) ` +
        `is ${srcDist.toFixed(1)}px outside source node "${source}" ` +
        `center-based box center=(${srcBounds.cx.toFixed(1)},${srcBounds.cy.toFixed(1)}) ` +
        `half=(${srcBounds.hw.toFixed(1)},${srcBounds.hh.toFixed(1)})`,
      );
      diagramFailed++;
      totalFailed++;
    }

    // Assert last point is within ε of target node's center-based bounds.
    const tgtDist = distOutsideRect(lastPt, tgtBounds.cx, tgtBounds.cy, tgtBounds.hw, tgtBounds.hh);
    if (tgtDist > EPSILON) {
      console.error(
        `  C17 FAIL: edge "${edgeId}" last point (${lastPt.x.toFixed(1)},${lastPt.y.toFixed(1)}) ` +
        `is ${tgtDist.toFixed(1)}px outside target node "${target}" ` +
        `center-based box center=(${tgtBounds.cx.toFixed(1)},${tgtBounds.cy.toFixed(1)}) ` +
        `half=(${tgtBounds.hw.toFixed(1)},${tgtBounds.hh.toFixed(1)})`,
      );
      diagramFailed++;
      totalFailed++;
    }
  }

  if (diagramFailed > 0) {
    console.log(`  ${diagramFailed} endpoint(s) outside center-based bounds on "${target}"`);
  } else {
    console.log(`PASS C17 (${target}): all route endpoints within ${EPSILON}px of center-based node bounds`);
  }
}

assert(
  totalFailed === 0,
  `C17 failed: ${totalFailed} route endpoint(s) lie outside center-based node bounds (ε=${EPSILON}px). ` +
  `This indicates positions are top-left, not centers — apply the CP-4d center fix.`,
);

console.log(`\nAll C17 assertions passed (${totalEdges} routed edges checked).`);
process.exit(0);
