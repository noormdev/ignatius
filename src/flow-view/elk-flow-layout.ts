/**
 * elk-flow-layout.ts — async ELK positions module for DFD diagrams.
 *
 * Accepts a FlowDiagram, runs elkjs Layered headlessly with 5-band partitioning
 * (source-ext=0, input-store=1, process-row=2, output-store=3, sink-ext=4),
 * and returns node positions keyed by node id.
 *
 * Browser + Bun dual-env:
 *   - Browser: default new ELK() works via built-in Web Worker.
 *   - Bun: pass opts.workerFactory pointing at the resolved elk-worker.min.js
 *     (Bun's global Worker handles it; verified in tmp/elk-spike/smoke2.ts).
 *     The caller is responsible for calling process.exit() because the worker
 *     keeps the Bun event loop alive.
 *
 * No Bun/Node-only APIs at module top level — this file is browser-safe.
 *
 * Scope: CP1 + CP2 — node positions for all nodes; label positions for short
 * inline labels only (ext:/kind: payload phrases where neither endpoint is db:).
 * Full db: column-list labels are NOT laid out inline — their data contract
 * is available on hover/click of the edge in FlowDiagramSvg (CP2).
 */

// elkjs main entry (lib/main.js) is used instead of elk.bundled.js:
//   - In Bun/Node (test scripts): a workerFactory must be passed explicitly (e.g. by
//     test/checks/test-elk-flow-positions.ts) because Bun has no ambient Worker shim
//     when running scripts directly.
//   - In the browser bundle: elkjs/lib/main.js detects the installed `web-worker`
//     package and uses it as a Worker shim — the shim resolves to the browser's
//     native Worker in the Bun-compiled bundle. No workerFactory arg is needed;
//     ELK runs via the Worker shim, not on the main thread.
// DFDs are small (< 50 nodes); the async layout call resolves quickly from the
// caller's view regardless of threading model.
import ELK from 'elkjs';
import type { ELKConstructorArguments, ElkNode, ElkPoint } from 'elkjs/lib/elk-api.js';
import type { FlowDiagram } from '../flows/flow-parse';
import { buildFlowData } from './flow-layout';
import type { FlowElementData } from './flow-layout';

// ── Types ────────────────────────────────────────────────────────────────────

type NodeElement = Extract<FlowElementData, { kind: 'node' }>;
type EdgeElement = Extract<FlowElementData, { kind: 'edge' }>;

export type ElkLayoutResult = {
  /** Node id → absolute {x, y} top-left corner. */
  positions: Record<string, { x: number; y: number }>;
  /**
   * Edge id → label position for SHORT inline labels only (CP2).
   * Populated for ext:/kind: payload phrases where neither endpoint is db:.
   * db: column-list edges are absent — their contract is on-demand (hover/click).
   */
  labelPositions: Record<string, { x: number; y: number }>;
  /**
   * Edge id → routed polyline points from ELK's `sections[0]` (CP4b).
   * Each entry is the full routed geometry: [startPoint, ...bendPoints, endPoint].
   * Coordinates are in the same absolute space as `positions` (no offset needed).
   * Edges that ELK did not route (e.g. produced no sections) are absent.
   */
  edgeRoutes: Record<string, Array<{ x: number; y: number }>>;
};

export type ComputeElkLayoutOpts = {
  /**
   * Override the ELK instance factory. Use in Bun/Node environments:
   *   opts.workerFactory = () => new Worker(<resolved elk-worker.min.js>)
   * In browsers, omit this — the default ELK() constructor works.
   */
  workerFactory?: ELKConstructorArguments['workerFactory'];
};

// ── Node sizing ──────────────────────────────────────────────────────────────

const estW = (text: string, px = 6.6, pad = 24, min = 80) =>
  Math.max(min, Math.round(text.length * px + pad));

/**
 * nodeSize — canonical width/height for a node element.
 *
 * Exported so test helpers can compute bounding-box extents (y + height) using
 * the same sizes that are fed to ELK, keeping the C4 band-ordering check
 * consistent with the actual layout.
 */
export function nodeSize(n: NodeElement): { width: number; height: number } {
  if (n.nodeType === 'process') return { width: 130, height: 64 };
  if (n.nodeType === 'external') return { width: estW(n.label, 6.6, 28, 110), height: 52 };
  // store — prefix with D# if present
  const label = `D${n.storeNum ?? ''} ${n.label}`;
  return { width: estW(label, 6.6, 30, 150), height: 44 };
}

// ── Band assignment ───────────────────────────────────────────────────────────

/**
 * bandOf — assign a partition band index to a node.
 *
 * Bands (matches the 5-band layout contract in docs/spec/dfd-overhaul.md C4):
 *   0 — source-ext  (externals that feed into processes)
 *   1 — input-store (stores processes read)
 *   2 — process-row (all processes)
 *   3 — output-store (stores processes write)
 *   4 — sink-ext    (externals that receive output)
 *
 * Split-store ids carry a `--read` or `--write` suffix (from buildFlowData).
 * External copy ids carry a `--src` or `--snk` marker (from buildFlowData).
 *
 * The rule mirrors the harness bandOf in tmp/elk-spike/harness.ts (proven).
 * Exported so the test can re-derive bands for the ordering invariant check.
 */
export function bandOf(
  n: NodeElement,
  srcSet: Set<string>,
): number {
  if (n.nodeType === 'process') return 2;

  if (n.nodeType === 'external') {
    // buildFlowData encodes role in the id suffix (CP4a: at most two copies):
    //   ext:<id>--snk  → sink (band 4, aggregates all sink partners)
    //   ext:<id>--src  → source (band 0, aggregates all source partners)
    if (n.id.includes('--snk')) return 4;
    if (n.id.includes('--src')) return 0;
    // Fallback: use edge membership to decide role.
    return srcSet.has(n.id) ? 0 : 4;
  }

  // Store — split copies carry explicit suffix.
  if (n.id.endsWith('--read')) return 1;
  if (n.id.endsWith('--write')) return 3;
  // Unsplit store: in srcSet → it is a source of data to some process → input band.
  if (srcSet.has(n.id)) return 1;
  // Isolated store — not in srcSet, no --read/--write suffix, not a split copy.
  // buildFlowData's split-copy strategy means such a node should not occur in a
  // well-formed diagram; band 3 (output-store) is the safe defensive default.
  return 3;
}

// ── Label classification ──────────────────────────────────────────────────────

/**
 * isDbEdge — true when either endpoint of an edge is a `db:` entity node.
 *
 * `db:` entity edges carry full column-list data contracts. These are NOT
 * rendered as always-on inline canvas labels: the contract is available on
 * hover/click instead.
 *
 * Split-store ids carry a `--read` or `--write` suffix (from buildFlowData).
 * An endpoint like `db:Payment--write` is still a db: edge — the suffix is
 * stripped before the prefix check so split copies are correctly classified.
 *
 * Exported so the SVG renderer can apply the same classification rule (single
 * source of truth — no duplicate in FlowDiagramSvg).
 */
export function isDbEdge(sourceId: string, targetId: string): boolean {
  const srcBase = sourceId.includes('--') ? sourceId.slice(0, sourceId.indexOf('--')) : sourceId;
  const tgtBase = targetId.includes('--') ? targetId.slice(0, targetId.indexOf('--')) : targetId;
  return srcBase.startsWith('db:') || tgtBase.startsWith('db:');
}

/**
 * Maximum label character length for an inline canvas chip (CP4a).
 *
 * Labels longer than this threshold inflate diagram width as badly as `db:`
 * column lists. They are rendered on-demand (hover/click) instead of inline.
 * The gate is label *length*, not endpoint kind.
 */
export const SHORT_LABEL_MAX = 22;

/**
 * isInlineLabel — true when a label is short enough to render as an inline
 * canvas chip (CP4a length gate).
 *
 * Returns false for undefined, empty, or any string longer than SHORT_LABEL_MAX.
 * Exported as the single source of truth used by buildElkGraph (label-dummy
 * reservation) and FlowDiagramSvg (inline chip rendering).
 */
export function isInlineLabel(label: string | undefined): boolean {
  return !!label && label.length <= SHORT_LABEL_MAX;
}

/**
 * Measure the pixel width of a short label string.
 * Uses the same approximation as the renderer (~6.6px per char at the chip
 * font size, plus padding). Minimum 40px; used to size ELK label dummies.
 */
function measureLabelWidth(text: string, minW = 40): number {
  return Math.max(minW, Math.round(text.length * 6.6 + 16));
}

/** Height of an inline edge label chip (matches CHIP_LINE_H + 2×CHIP_PAD_Y). */
const LABEL_CHIP_H = 21;

// ── ELK graph construction ────────────────────────────────────────────────────

function buildElkGraph(
  nodes: NodeElement[],
  edges: EdgeElement[],
): ElkNode {
  const srcSet = new Set(edges.map(e => e.source));

  const layoutOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.partitioning.activate': 'true',
    'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    'elk.spacing.nodeNode': '40',
    'elk.spacing.edgeNode': '20',
    'elk.layered.spacing.edgeNodeBetweenLayers': '20',
    // Enable ELK center-placement for inline short labels.
    'elk.edgeLabels.placement': 'CENTER',
    // CP4b: request orthogonal edge routing so ELK returns sections with
    // start, optional bend points, and end — producing crossing-minimised
    // routed geometry instead of center-to-center trunks.
    'elk.edgeRouting': 'ORTHOGONAL',
  };

  const children: ElkNode[] = nodes.map(n => {
    const { width, height } = nodeSize(n);
    const band = bandOf(n, srcSet);
    return {
      id: n.id,
      width,
      height,
      layoutOptions: {
        'elk.partitioning.partition': String(band),
      },
    };
  });

  const elkEdges = edges.map(e => {
    const base = { id: e.id, sources: [e.source], targets: [e.target] };
    // Only short labels get an ELK label dummy (CP4a length gate).
    // Long labels — db: column lists AND long ext:/kind: payload phrases alike —
    // contribute NO label entry: ELK reserves no space for them. Their data
    // contract is available on hover/click in the renderer.
    if (isInlineLabel(e.label)) {
      return {
        ...base,
        labels: [{
          text: e.label,
          width: measureLabelWidth(e.label),
          height: LABEL_CHIP_H,
        }],
      };
    }
    return base;
  });

  return {
    id: 'root',
    layoutOptions,
    children,
    edges: elkEdges,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * computeElkLayout — async ELK positions for a FlowDiagram (CP1 + CP2).
 *
 * Internally calls buildFlowData(diagram) for nodes/edges/storeNums, assigns
 * each node a band partition by role, runs elkjs Layered with DOWN direction +
 * partitioning + nodeNodeBetweenLayers/nodeNode spacing, and maps the ELK
 * output to node-id → position.
 *
 * CP4a length gate: an ELK label dummy is provided only for short labels
 * (isInlineLabel — ≤ SHORT_LABEL_MAX chars). Long labels — db: column lists
 * and long ext:/kind: payload phrases alike — have no label dummy and produce
 * no labelPositions entry. Their data contract is available on hover/click.
 */
export async function computeElkLayout(
  diagram: FlowDiagram,
  opts?: ComputeElkLayoutOpts,
): Promise<ElkLayoutResult> {
  const { nodes, edges } = buildFlowData(diagram);
  const graph = buildElkGraph(nodes, edges);

  const elkArgs: ELKConstructorArguments = {};
  if (opts?.workerFactory) {
    elkArgs.workerFactory = opts.workerFactory;
  }

  const elk = new ELK(elkArgs);

  let result: ElkNode;
  try {
    result = await elk.layout(graph);
  } catch (err) {
    elk.terminateWorker();
    throw new Error(
      `ELK layout failed for diagram "${diagram.id}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  elk.terminateWorker();

  const positions: Record<string, { x: number; y: number }> = {};

  for (const child of result.children ?? []) {
    if (child.id !== undefined && child.x !== undefined && child.y !== undefined) {
      positions[child.id] = { x: child.x, y: child.y };
    }
  }

  // Extract label positions for short inline labels (non-db: edges only).
  // ELK returns x/y on the first label of each edge when label dummies were
  // provided. db: edges had no label entry, so they produce no labelPosition.
  const labelPositions: Record<string, { x: number; y: number }> = {};

  // Extract routed edge geometry from ELK's sections (CP4b).
  // With elk.edgeRouting: ORTHOGONAL, each laid-out edge carries sections[0]
  // with startPoint, optional bendPoints, and endPoint. The polyline is the
  // concatenation: [startPoint, ...bendPoints, endPoint].
  // Coordinates are in the same absolute space as node positions — no offset needed.
  const edgeRoutes: Record<string, Array<{ x: number; y: number }>> = {};

  for (const edge of result.edges ?? []) {
    const lbl = edge.labels?.[0];
    if (
      edge.id !== undefined &&
      lbl !== undefined &&
      lbl.x !== undefined &&
      lbl.y !== undefined
    ) {
      labelPositions[edge.id] = { x: lbl.x, y: lbl.y };
    }

    // Route extraction: use sections[0] if present.
    if (edge.id !== undefined) {
      const section = edge.sections?.[0];
      if (section !== undefined) {
        const pts: Array<ElkPoint> = [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ];
        edgeRoutes[edge.id] = pts.map(p => ({ x: p.x, y: p.y }));
      }
    }
  }

  return {
    positions,
    labelPositions,
    edgeRoutes,
  };
}
