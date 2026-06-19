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
 *
 * Single-row criterion (updated for viewer-ux-polish #5): process nodes now size
 * to their wrapped label, so a band's nodes no longer share one EXACT center-y —
 * a 3-line process is taller than a 2-line one, and ELK staggers their centers by
 * a few px. "Single row" is therefore checked as a structural property: every
 * node in a band must vertically overlap a COMMON horizontal strip (there exists
 * a y inside every node's [top, bottom] extent), AND no band's strip bleeds into
 * an adjacent band's. This proves the band is one ELK layer (the C16 intent — no
 * label-dummy sub-layer split) without assuming uniform node heights.
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

  // Group nodes by band, recording each node's vertical extent [top, bottom].
  // result.positions[id].y is the node CENTER (ELK top-left + height/2, per
  // computeElkLayout's center convention), so top = cy - h/2, bottom = cy + h/2.
  // A band is one row iff there is a y inside EVERY node's extent — i.e.
  // max(top) < min(bottom). With variable process heights (#5) the centers no
  // longer coincide, but a true single layer still overlaps a common strip.
  type Extent = { id: string; top: number; bottom: number };
  const bandExtents = new Map<number, Extent[]>();

  for (const node of nodes) {
    const elkPos = result.positions[node.id];
    if (elkPos === undefined) {
      console.error(`FAIL [${targetId}]: node "${node.id}" has no ELK position`);
      process.exit(1);
    }

    const band = bandOf(node, srcSet);
    const { height } = nodeSize(node);
    const top = elkPos.y - height / 2;
    const bottom = elkPos.y + height / 2;

    const list = bandExtents.get(band);
    if (list === undefined) bandExtents.set(band, [{ id: node.id, top, bottom }]);
    else list.push({ id: node.id, top, bottom });
  }

  // Common strip per band: [maxTop, minBottom]. Valid (single row) iff maxTop < minBottom.
  type Strip = { band: number; maxTop: number; minBottom: number; ids: string[] };
  const strips: Strip[] = [];
  let allSingleRow = true;
  for (const [band, extents] of [...bandExtents.entries()].sort((a, b) => a[0] - b[0])) {
    const maxTop = Math.max(...extents.map(e => e.top));
    const minBottom = Math.min(...extents.map(e => e.bottom));
    const ids = extents.map(e => e.id);
    strips.push({ band, maxTop, minBottom, ids });
    if (maxTop >= minBottom) {
      allSingleRow = false;
      console.error(
        `FAIL [${targetId}]: band ${band} nodes do not share a common horizontal strip ` +
        `(maxTop=${roundY(maxTop)} ≥ minBottom=${roundY(minBottom)}) across nodes: ${ids.join(', ')}`,
      );
    } else {
      console.log(`  PASS band ${band}: ${ids.length} node(s) share a strip y∈[${roundY(maxTop)}, ${roundY(minBottom)}]`);
    }
  }

  assert(
    allSingleRow,
    `[${targetId}] Not all bands are single-row — see FAIL lines above (C16)`,
  );

  // Bands must not bleed into each other: each band's strip sits strictly below
  // the previous band's (top edge of band N below the bottom edge of band N-1's
  // tallest overlap). Checks the 5-band vertical separation survives variable heights.
  for (let i = 1; i < strips.length; i++) {
    const prev = strips[i - 1]!;
    const cur = strips[i]!;
    if (cur.maxTop <= prev.minBottom) {
      console.error(
        `FAIL [${targetId}]: band ${cur.band} strip top (${roundY(cur.maxTop)}) ` +
        `overlaps band ${prev.band} strip bottom (${roundY(prev.minBottom)}) — bands bleed together`,
      );
      process.exit(1);
    }
  }

  console.log(`  Band strips: ${strips.map(s => `band${s.band}=[${roundY(s.maxTop)},${roundY(s.minBottom)}]`).join(' ')}`);
  console.log(`PASS C16 [${targetId}]: each occupied band is one row (common strip) and bands stay separated`);
}

console.log('\nAll C16 assertions passed.');
process.exit(0);
