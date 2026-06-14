/**
 * test-cp4c-single-row-bands.ts — assertion check for CP-4c: single-row bands.
 *
 * CI assertion script (PASS/FAIL/exit-1 style, like other test/checks/*.ts).
 *
 * Verifies C16 from docs/spec/dfd-overhaul.md:
 *   Each of the five bands renders as ONE horizontal row — all nodes assigned
 *   to a band share a single y coordinate. Verified on the proving model's dense
 *   leaves (memory-lifecycle and tag-administration): each occupied band has
 *   exactly one distinct rounded y.
 *
 * Root cause that C16 closes: ELK label-dummy nodes (submitted via the `labels`
 * array on edges) force ELK to split a band across two sub-layers. Without them,
 * ELK produces single-row bands. CP-4c removes all label dummies; this test
 * proves the fix holds.
 *
 * Diagrams under test: memory-lifecycle and tag-administration from
 * models/llm-memory-db-mssql (the two dense leaves that exposed the multi-row
 * band defect).
 */

import { createRequire } from 'node:module';
import { parseFlows } from '../../src/flows/flow-parse';
import { buildFlowData } from '../../src/flow-view/flow-layout';
import {
  computeElkLayout,
  nodeSize,
  bandOf,
} from '../../src/flow-view/elk-flow-layout';
import type { FlowDiagram } from '../../src/flows/flow-parse';

const MODEL_DIR = 'models/llm-memory-db-mssql';
const DIAGRAMS = ['memory-lifecycle', 'tag-administration'];

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

/** Walk the leveled diagram tree to find a diagram by id. */
function findDiagramInTree(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
  for (const d of diagrams) {
    if (d.id === id) return d;
    const found = findDiagramInTree(d.subDfds, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Round a y coordinate to the nearest integer to absorb sub-pixel ELK jitter.
 * Two nodes in the "same row" should share rounded-y; ELK may place them at
 * e.g. 200.0 and 200.4 — these count as the same row.
 */
function roundY(y: number): number {
  return Math.round(y);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { flowModel } = await parseFlows(MODEL_DIR);

for (const targetId of DIAGRAMS) {
  const diagram = findDiagramInTree(flowModel.diagrams, targetId);
  if (!diagram) {
    console.error(`FAIL: diagram "${targetId}" not found in ${MODEL_DIR}`);
    process.exit(1);
  }

  const { nodes, edges } = buildFlowData(diagram);
  console.log(`\n=== ${targetId} ===`);
  console.log(`  Nodes: ${nodes.length}, Edges: ${edges.length}`);

  const result = await computeElkLayout(diagram, { workerFactory });

  // Build srcSet for bandOf (same logic as other test files and elk-flow-layout
  // internals — the srcSet is derived from edge sources).
  const srcSet = new Set(edges.map(e => e.source));

  // Group nodes by their band index, then check that each band's node positions
  // share a single distinct rounded y (the center-y of the ELK position + half
  // the node height, which is the node center in ELK's top-left coordinate system).
  //
  // ELK returns the top-left corner of each node. The "y row" of a node in a
  // band is the rounded top-left y (not center-y): all nodes in the same ELK
  // layer share the same top-left y since they're placed in the same partition row.
  const bandYs = new Map<number, Set<number>>();
  const bandNodeIds = new Map<number, string[]>();

  for (const node of nodes) {
    const elkPos = result.positions[node.id];
    if (elkPos === undefined) {
      console.error(`FAIL [${targetId}]: node "${node.id}" has no ELK position`);
      process.exit(1);
    }

    const band = bandOf(node, srcSet);
    const ry = roundY(elkPos.y);

    let ySet = bandYs.get(band);
    if (ySet === undefined) { ySet = new Set(); bandYs.set(band, ySet); }
    ySet.add(ry);

    let ids = bandNodeIds.get(band);
    if (ids === undefined) { ids = []; bandNodeIds.set(band, ids); }
    ids.push(node.id);
  }

  let allSingleRow = true;
  for (const [band, ySet] of bandYs) {
    const ids = bandNodeIds.get(band) ?? [];
    if (ySet.size !== 1) {
      allSingleRow = false;
      console.error(
        `FAIL [${targetId}]: band ${band} has ${ySet.size} distinct y values ` +
        `[${[...ySet].join(', ')}] across nodes: ${ids.join(', ')}`,
      );
    } else {
      const [y] = ySet;
      console.log(`  PASS band ${band}: ${ids.length} node(s) all at y≈${y}`);
    }
  }

  assert(
    allSingleRow,
    `[${targetId}] Not all bands are single-row — see FAIL lines above (C16)`,
  );

  // Print node+size summary for traceability
  console.log(`  Band y-sets: ${[...bandYs.entries()].map(([b, ys]) => `band${b}={${[...ys].join(',')}}`).join(' ')}`);
  console.log(`PASS C16 [${targetId}]: each occupied band has exactly one distinct y`);
}

console.log('\nAll C16 assertions passed.');
process.exit(0);
