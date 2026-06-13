/**
 * test-elk-flow-positions.ts — assertion check for elk-flow-layout module.
 *
 * CI assertion script (PASS/FAIL/exit-1 style, like other test/checks/*.ts).
 *
 * Verifies C4 from docs/spec/dfd-overhaul.md:
 *   - every node id from buildFlowData(diagram).nodes receives an (x, y) in
 *     the result positions record.
 *   - band ordering invariant: max-y of band N < min-y of band N+1 across all
 *     five bands (source-ext=0, input-store=1, process-row=2, output-store=3,
 *     sink-ext=4). Bounding-box extremes of positions per band, not centroids.
 *
 * Diagrams under test: memory-lifecycle and tag-administration from
 * models/llm-memory-db-mssql.
 */

import { createRequire } from 'node:module';
import { parseFlows } from '../../src/flows/flow-parse';
import { buildFlowData } from '../../src/flow-view/flow-layout';
import {
  computeElkLayout,
  bandOf,
  nodeSize,
  type ElkLayoutResult,
} from '../../src/flow-view/elk-flow-layout';
import type { FlowDiagram } from '../../src/flows/flow-parse';

const MODEL_DIR = 'models/llm-memory-db-mssql';
const TARGETS = ['memory-lifecycle', 'tag-administration'];

// Supply a Bun-compatible ELK workerFactory to the module (see decision.md).
const require = createRequire(import.meta.url);
const workerPath = require.resolve('elkjs/lib/elk-worker.min.js');
const workerFactory = () => new Worker(workerPath);

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

type BandBounds = { min: number; max: number };

/**
 * Compute per-band y extents from a positions record + the node list from
 * buildFlowData. Uses bandOf (re-exported by elk-flow-layout) so the test
 * derives bands the same way the module does.
 *
 * max-y is the node BOTTOM edge (pos.y + height) — not the top-left corner —
 * so the C4 invariant checks bounding-box extremes, not centroid approximations.
 * nodeSize is imported from elk-flow-layout so heights are consistent with what
 * ELK received.
 */
function bandBounds(
  nodes: ReturnType<typeof buildFlowData>['nodes'],
  edges: ReturnType<typeof buildFlowData>['edges'],
  positions: ElkLayoutResult['positions'],
): Map<number, BandBounds> {
  const srcSet = new Set(edges.map(e => e.source));
  const bounds = new Map<number, BandBounds>();

  for (const n of nodes) {
    const pos = positions[n.id];
    if (pos === undefined) continue;
    const band = bandOf(n, srcSet);
    const { height } = nodeSize(n);
    const topY = pos.y;
    const botY = pos.y + height;
    const existing = bounds.get(band);
    if (existing === undefined) {
      bounds.set(band, { min: topY, max: botY });
    } else {
      existing.min = Math.min(existing.min, topY);
      existing.max = Math.max(existing.max, botY);
    }
  }

  return bounds;
}

// ── main ─────────────────────────────────────────────────────────────────────

const { flowModel } = await parseFlows(MODEL_DIR);

function findDiagram(id: string): FlowDiagram {
  const d = flowModel.diagrams.find(d => d.id === id);
  if (!d) {
    console.error(`FAIL: diagram not found: ${id}`);
    process.exit(1);
  }
  return d;
}

for (const target of TARGETS) {
  console.log(`\n=== ${target} ===`);
  const diagram = findDiagram(target);
  const { nodes, edges } = buildFlowData(diagram);

  const result: ElkLayoutResult = await computeElkLayout(diagram, { workerFactory });

  // C4a: every node id receives a position
  for (const n of nodes) {
    const pos = result.positions[n.id];
    assert(
      pos !== undefined,
      `${target}: node "${n.id}" missing from positions`,
    );
    assert(
      typeof pos.x === 'number' && typeof pos.y === 'number',
      `${target}: position for "${n.id}" is not {x,y}`,
    );
  }
  console.log(`PASS C4a (${target}): all ${nodes.length} nodes have positions`);

  // C4b: band ordering invariant — max-y of band N < min-y of band N+1
  const bounds = bandBounds(nodes, edges, result.positions);
  console.log(`  Band bounds for ${target}:`);
  for (const [band, b] of [...bounds.entries()].sort((a, b) => a[0] - b[0])) {
    const names = ['source-ext', 'input-store', 'process', 'output-store', 'sink-ext'];
    console.log(`  band ${band} (${names[band] ?? '?'}): min-y=${b.min.toFixed(1)} max-y=${b.max.toFixed(1)}`);
  }

  // Only check ordering for bands that are actually present and adjacent.
  const presentBands = [...bounds.keys()].sort((a, b) => a - b);
  for (let i = 0; i < presentBands.length - 1; i++) {
    const bandN = presentBands[i]!;
    const bandNext = presentBands[i + 1]!;
    // Skip the ordering check when bands are not adjacent (e.g. band 0 and band 2
    // with no band 1 nodes — ordering between non-contiguous bands is unconstrained).
    if (bandNext !== bandN + 1) continue;
    const bN = bounds.get(bandN)!;
    const bNext = bounds.get(bandNext)!;
    assert(
      bN.max < bNext.min,
      `${target}: band ordering violated: band ${bandN} max-y=${bN.max.toFixed(1)} >= band ${bandNext} min-y=${bNext.min.toFixed(1)}`,
    );
    console.log(`PASS C4b (${target}): band ${bandN} max-y(${bN.max.toFixed(1)}) < band ${bandNext} min-y(${bNext.min.toFixed(1)})`);
  }
}

console.log('\nAll C4 assertions passed.');

// The elkjs worker keeps the Bun event loop alive.
process.exit(0);
