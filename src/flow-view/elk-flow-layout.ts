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
 * Scope: CP1 + CP2 + CP4c — node positions for all nodes and routed edge
 * geometry. ELK is handed node+edge geometry only — no label dummy nodes.
 * Label dummies split a band across two sub-layers (proven in
 * tmp/dfd-compare/layer-exp.ts); removing them yields single-row bands (C16).
 * The renderer places short labels in the inter-band channel itself (CP4c).
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
import { buildFlowData, processNodeSize } from './flow-layout';
import type { FlowElementData } from './flow-layout';

// ── Types ────────────────────────────────────────────────────────────────────

type NodeElement = Extract<FlowElementData, { kind: 'node' }>;
type EdgeElement = Extract<FlowElementData, { kind: 'edge' }>;

export type ElkLayoutResult = {
  /** Node id → absolute {x, y} node CENTER (ELK top-left + half size). */
  positions: Record<string, { x: number; y: number }>;
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
  if (n.nodeType === 'process') {
    // #5: size the process to its wrapped label via the shared pure helper so
    // ELK lays out with the TRUE box (long names grow, short names floor) and
    // band spacing/edge routing reflect the rendered size. Same helper drives
    // the renderer (FlowDiagramSvg.ProcessNode) — one source of truth, no more
    // 130×64-vs-120×68 mismatch.
    const { width, height } = processNodeSize(n.label);
    return { width, height };
  }
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
 * Exported as the single source of truth used by FlowDiagramSvg (inline chip
 * rendering). ELK no longer receives label dummies — the renderer owns all label
 * placement (CP4c).
 */
export function isInlineLabel(label: string | undefined): boolean {
  return !!label && label.length <= SHORT_LABEL_MAX;
}

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
    // CP4b: request orthogonal edge routing so ELK returns sections with
    // start, optional bend points, and end — producing crossing-minimised
    // routed geometry instead of center-to-center trunks.
    // CP4c: elk.edgeLabels.placement is NOT set — ELK is handed geometry
    // only (no label dummy nodes). Label dummies split bands across sub-layers;
    // omitting them yields single-row bands (C16).
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

  // CP4c: no label entries on any edge — ELK is handed node+edge geometry only.
  // Label dummy nodes split a band across sub-layers (proven in
  // tmp/dfd-compare/layer-exp.ts); removing them yields single-row bands (C16).
  // The renderer places short inline labels in the inter-band channel itself.
  const elkEdges = edges.map(e => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  return {
    id: 'root',
    layoutOptions,
    children,
    edges: elkEdges,
  };
}

/**
 * Terminate ELK's worker without ever throwing.
 *
 * Worker cleanup must NEVER discard a successful layout. In Bun (real Worker)
 * `terminateWorker()` frees the worker so the process can exit. In the browser
 * bundle ELK runs on the main thread via the `web-worker` shim, whose fake
 * worker has no `terminate()` — calling it throws `this.worker.terminate is not
 * a function`. If that exception escaped `computeElkLayout`, the caller
 * (`FlowsView.renderDiagram`) would treat the (actually successful) layout as a
 * failure and silently fall back to the banded positioner — which is exactly the
 * regression this guard exists to prevent. Swallow the error: the layout already
 * succeeded and there is no worker to free on the main thread.
 *
 * Exported so the regression is unit-testable (the browser path can't run in Bun).
 */
export function terminateQuietly(elk: { terminateWorker: () => void }): void {
  try {
    elk.terminateWorker();
  } catch {
    // main-thread shim (browser): no worker to terminate — cleanup is a no-op.
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * computeElkLayout — async ELK positions for a FlowDiagram (CP1 + CP2 + CP4c).
 *
 * Internally calls buildFlowData(diagram) for nodes/edges/storeNums, assigns
 * each node a band partition by role, runs elkjs Layered with DOWN direction +
 * partitioning + nodeNodeBetweenLayers/nodeNode spacing, and maps the ELK
 * output to node-id → position and edge-id → routed polyline.
 *
 * CP4c: ELK receives no label dummy nodes (geometry only). The renderer places
 * short labels in the inter-band channel via nodeBounds/basePositions lookups.
 * No labelPositions output — callers should not reference it.
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
    terminateQuietly(elk);
    throw new Error(
      `ELK layout failed for diagram "${diagram.id}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  terminateQuietly(elk);

  const positions: Record<string, { x: number; y: number }> = {};

  // O(1) lookup for the size fallback below (avoids nodes.find per child).
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  for (const child of result.children ?? []) {
    if (child.id !== undefined && child.x !== undefined && child.y !== undefined) {
      // CP4d: return node CENTER (ELK top-left + half size) instead of top-left.
      // The SVG renderer (nodeBounds) is center-based: it draws nodes at pos.x ± w/2.
      // Returning centers aligns ELK positions with the renderer's coordinate convention
      // so that ELK edge routes (which stay in ELK/top-left absolute space) connect to
      // the rendered node boxes without the half-node offset that caused routes to pass
      // through or beside nodes (C17).
      //
      // Guard: ELK echoes width/height back on result children (we set them in
      // buildElkGraph). Fall back to nodeSize if absent to avoid dividing undefined.
      const inputNode = nodeById.get(child.id);
      const fallback = inputNode !== undefined ? nodeSize(inputNode) : { width: 0, height: 0 };
      const w = child.width ?? fallback.width;
      const h = child.height ?? fallback.height;
      positions[child.id] = { x: child.x + w / 2, y: child.y + h / 2 };
    }
  }

  // Extract routed edge geometry from ELK's sections (CP4b).
  // With elk.edgeRouting: ORTHOGONAL, each laid-out edge carries sections[0]
  // with startPoint, optional bendPoints, and endPoint. The polyline is the
  // concatenation: [startPoint, ...bendPoints, endPoint].
  // Coordinates are in the same absolute space as node positions — no offset needed.
  //
  // CP4c: no label positions extracted — ELK was not given label dummies, so
  // no label x/y is present on edges. The renderer owns all label placement.
  const edgeRoutes: Record<string, Array<{ x: number; y: number }>> = {};

  for (const edge of result.edges ?? []) {
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
    edgeRoutes,
  };
}
