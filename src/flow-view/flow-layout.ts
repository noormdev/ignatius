/**
 * flow-layout.ts — renderer-agnostic DFD layout helpers.
 *
 * Extracted from App.tsx so the SVG renderer can import them without
 * pulling in Cytoscape. The element descriptor type uses a plain object
 * shape instead of cytoscape.ElementDefinition.
 *
 * Exports: assignStoreNumbers, buildFlowData, computeFlowLayout
 */

import type { FlowDiagram } from '../flow-parse';

// ── Types ────────────────────────────────────────────────────────────────────

export type NodePos = { x: number; y: number };

/** Minimal element descriptor — no Cytoscape dep. */
export type FlowElementData =
  | {
      kind: 'node';
      id: string;
      nodeType: 'process' | 'external' | 'store';
      label: string;
      hasSubDfd?: boolean;
      processId?: string;
      extId?: string;
      storeKind?: string;
      shared?: boolean;
      storeNum?: number;
      storeName?: string;
    }
  | {
      kind: 'edge';
      id: string;
      source: string;
      target: string;
      label: string;
      isRead: boolean;
    };

export type ExtSplitMap = Map<string, { srcId: string; snkId: string; isSplit: boolean }>;

/** Return type of buildFlowData — everything the SVG renderer needs. */
export type FlowRenderData = {
  nodes: Extract<FlowElementData, { kind: 'node' }>[];
  edges: Extract<FlowElementData, { kind: 'edge' }>[];
  positions: Map<string, NodePos>;
  extSplitMap: ExtSplitMap;
  storeNums: Map<string, number>;
};

// ── Store numbering ──────────────────────────────────────────────────────────

/**
 * assignStoreNumbers — assign a stable D# to each unique store in a diagram.
 * Numbering order: processes in dottedNumber order, inputs first then outputs.
 */
export function assignStoreNumbers(diagram: FlowDiagram): Map<string, number> {
  const sortedProcs = [...diagram.processes].sort((a, b) => {
    const aParts = a.dottedNumber.split('.').map(Number);
    const bParts = b.dottedNumber.split('.').map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  const order: string[] = [];
  const seen = new Set<string>();

  function visit(kind: string, name: string) {
    if (kind === 'proc' || kind === 'ext') return;
    const id = `${kind}:${name}`;
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
  }

  for (const proc of sortedProcs) {
    for (const e of proc.inputs) visit(e.from.kind, e.from.name);
    for (const e of proc.outputs) visit(e.to.kind, e.to.name);
  }
  for (const s of diagram.storeRefs) visit(s.kind, s.name);

  const map = new Map<string, number>();
  order.forEach((id, i) => map.set(id, i + 1));
  return map;
}

// ── Element builder ──────────────────────────────────────────────────────────

/**
 * buildFlowData — produce the full render data for one FlowDiagram.
 *
 * Builds nodes + edges, computes the ext split map, store numbers, and runs
 * computeFlowLayout. Returns everything the SVG renderer needs in one call.
 */
export function buildFlowData(diagram: FlowDiagram): FlowRenderData {
  const storeNums = assignStoreNumbers(diagram);
  const nodes: Extract<FlowElementData, { kind: 'node' }>[] = [];
  const edges: Extract<FlowElementData, { kind: 'edge' }>[] = [];

  // Shared store detection: written by some process AND read by another.
  const storeWriters = new Map<string, Set<string>>();
  const storeReaders = new Map<string, Set<string>>();
  for (const proc of diagram.processes) {
    for (const e of proc.outputs) {
      const tid = `${e.to.kind}:${e.to.name}`;
      if (!storeWriters.has(tid)) storeWriters.set(tid, new Set());
      storeWriters.get(tid)!.add(proc.id);
    }
    for (const e of proc.inputs) {
      const fid = `${e.from.kind}:${e.from.name}`;
      if (!storeReaders.has(fid)) storeReaders.set(fid, new Set());
      storeReaders.get(fid)!.add(proc.id);
    }
  }

  // External split detection.
  const extAsSource = new Set<string>();
  const extAsSink = new Set<string>();
  for (const edge of diagram.edges) {
    if (edge.from.kind === 'ext') extAsSource.add(edge.from.name);
    if (edge.to.kind === 'ext') extAsSink.add(edge.to.name);
  }

  const extSplitMap: ExtSplitMap = new Map();
  for (const ext of diagram.externals) {
    const isSource = extAsSource.has(ext.id);
    const isSink = extAsSink.has(ext.id);
    const isSplit = isSource && isSink;
    extSplitMap.set(ext.id, {
      srcId: isSplit ? `ext:${ext.id}--src` : `ext:${ext.id}`,
      snkId: isSplit ? `ext:${ext.id}--snk` : `ext:${ext.id}`,
      isSplit,
    });
  }

  // Process nodes.
  for (const proc of diagram.processes) {
    nodes.push({
      kind: 'node',
      id: `proc:${proc.id}`,
      nodeType: 'process',
      label: proc.label,
      hasSubDfd: proc.hasSubDfd,
      processId: proc.id,
    });
  }

  // External nodes (split when needed).
  for (const ext of diagram.externals) {
    const split = extSplitMap.get(ext.id)!;
    if (split.isSplit) {
      nodes.push({ kind: 'node', id: split.srcId, nodeType: 'external', label: ext.label, extId: ext.id });
      nodes.push({ kind: 'node', id: split.snkId, nodeType: 'external', label: ext.label, extId: ext.id });
    } else {
      nodes.push({ kind: 'node', id: split.srcId, nodeType: 'external', label: ext.label });
    }
  }

  // Store ref nodes.
  for (const store of diagram.storeRefs) {
    const storeId = `${store.kind}:${store.name}`;
    const num = storeNums.get(storeId) ?? 0;
    const writers = storeWriters.get(storeId) ?? new Set();
    const readers = storeReaders.get(storeId) ?? new Set();
    const isShared = writers.size > 0 && readers.size > 0;
    nodes.push({
      kind: 'node',
      id: storeId,
      nodeType: 'store',
      label: store.name,
      storeKind: store.kind,
      shared: isShared,
      storeNum: num,
      storeName: store.name,
    });
  }

  // Edges.
  for (let i = 0; i < diagram.edges.length; i++) {
    const edge = diagram.edges[i]!;
    let fromId = `${edge.from.kind}:${edge.from.name}`;
    let toId = `${edge.to.kind}:${edge.to.name}`;

    if (edge.from.kind === 'ext') {
      const split = extSplitMap.get(edge.from.name);
      if (split?.isSplit) fromId = split.srcId;
    }
    if (edge.to.kind === 'ext') {
      const split = extSplitMap.get(edge.to.name);
      if (split?.isSplit) toId = split.snkId;
    }

    const label = Array.isArray(edge.data) ? edge.data.join(', ') : (edge.data ?? '');
    // Read semantics (canonical rule): isRead is true ONLY when a db: store feeds
    // data INTO a process (store→proc). This produces the dashed amber line.
    // External inputs (ext→proc) and all process outputs (proc→store, proc→ext,
    // proc→proc) are solid writes. Non-db stores (cache/queue/file/doc/manual)
    // are always writes — only db: stores carry the read/write distinction.
    edges.push({
      kind: 'edge',
      id: `flow-edge-${i}`,
      source: fromId,
      target: toId,
      label,
      isRead: edge.from.kind === 'db',
    });
  }

  // Build the set of all node ids for computeFlowLayout.
  const allNodeIds = new Set<string>(nodes.map(n => n.id));
  const positions = computeFlowLayout(diagram, extSplitMap, allNodeIds);

  return { nodes, edges, positions, extSplitMap, storeNums };
}

// ── Banded layout ────────────────────────────────────────────────────────────

/**
 * computeFlowLayout — produce banded preset positions for a DFD.
 *
 * Bands (top → bottom):
 *   source-external  y = SOURCE_Y   (externals feeding into processes)
 *   input-store      y = STORE_IN_Y (stores that processes read)
 *   process          y = PROC_Y     (horizontal row, one column per process)
 *   output-store     y = STORE_OUT_Y (stores that processes write; shared stores here too)
 *   sink-external    y = SINK_Y     (externals that receive output from processes)
 */
export function computeFlowLayout(
  diagram: FlowDiagram,
  extSplitMap: ExtSplitMap,
  allNodeIds: Set<string>,
): Map<string, NodePos> {
  const SOURCE_Y = 80;
  const STORE_IN_Y = 220;
  const PROC_Y = 370;
  const STORE_OUT_Y = 520;
  const SINK_Y = 680;

  const PROC_COL_W = 380;
  const STORE_COL_W = 215;
  const EXT_COL_W = 260;

  type Participants = { writtenBy: Set<string>; readBy: Set<string> };
  const participation = new Map<string, Participants>();

  function getP(id: string): Participants {
    let p = participation.get(id);
    if (!p) { p = { writtenBy: new Set(), readBy: new Set() }; participation.set(id, p); }
    return p;
  }

  for (const proc of diagram.processes) {
    const pid = `proc:${proc.id}`;
    for (const e of proc.inputs) {
      let fromId = `${e.from.kind}:${e.from.name}`;
      if (e.from.kind === 'ext') {
        const split = extSplitMap.get(e.from.name);
        if (split?.isSplit) fromId = split.srcId;
      }
      getP(fromId).readBy.add(pid);
    }
    for (const e of proc.outputs) {
      let toId = `${e.to.kind}:${e.to.name}`;
      if (e.to.kind === 'ext') {
        const split = extSplitMap.get(e.to.name);
        if (split?.isSplit) toId = split.snkId;
      }
      getP(toId).writtenBy.add(pid);
    }
  }

  const procs = [...diagram.processes].sort((a, b) => {
    const aParts = a.dottedNumber.split('.').map(Number);
    const bParts = b.dottedNumber.split('.').map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  const procXByPid = new Map<string, number>();
  const totalProcWidth = (procs.length - 1) * PROC_COL_W;
  const procStartX = -totalProcWidth / 2;
  procs.forEach((proc, i) => {
    procXByPid.set(`proc:${proc.id}`, procStartX + i * PROC_COL_W);
  });

  function avgProcX(pids: Set<string>): number {
    if (pids.size === 0) return 0;
    let sum = 0;
    for (const pid of pids) sum += (procXByPid.get(pid) ?? 0);
    return sum / pids.size;
  }

  const positions = new Map<string, NodePos>();
  for (const proc of procs) {
    const pid = `proc:${proc.id}`;
    positions.set(pid, { x: procXByPid.get(pid)!, y: PROC_Y });
  }

  type Band = 'source' | 'input' | 'output' | 'shared' | 'sink';
  const bandOf = new Map<string, Band>();

  for (const nodeId of allNodeIds) {
    if (nodeId.startsWith('proc:')) continue;

    const p = getP(nodeId);
    const isSrcExt = nodeId.endsWith('--src') || (nodeId.startsWith('ext:') && !nodeId.endsWith('--snk'));
    const isSnkExt = nodeId.endsWith('--snk');

    if (isSnkExt) {
      bandOf.set(nodeId, 'sink');
    } else if (isSrcExt) {
      bandOf.set(nodeId, 'source');
    } else {
      const isShared = p.writtenBy.size > 0 && p.readBy.size > 0;
      if (isShared) {
        bandOf.set(nodeId, 'shared');
      } else if (p.readBy.size > 0) {
        bandOf.set(nodeId, 'input');
      } else {
        bandOf.set(nodeId, 'output');
      }
    }
  }

  const bands: Record<Band, string[]> = { source: [], input: [], output: [], shared: [], sink: [] };
  for (const [id, band] of bandOf) bands[band].push(id);

  function sortByProcX(ids: string[]) {
    ids.sort((a, b) => {
      const pa = getP(a);
      const pb = getP(b);
      const xa = avgProcX(new Set([...pa.writtenBy, ...pa.readBy]));
      const xb = avgProcX(new Set([...pb.writtenBy, ...pb.readBy]));
      return xa - xb;
    });
  }

  const BAND_ORDER = ['source', 'input', 'output', 'shared', 'sink'] satisfies readonly Band[];
  for (const band of BAND_ORDER) {
    sortByProcX(bands[band]);
  }

  function placeRowEven(ids: string[], y: number, colW: number) {
    const total = (ids.length - 1) * colW;
    const startX = -total / 2;
    ids.forEach((id, i) => positions.set(id, { x: startX + i * colW, y }));
  }

  placeRowEven(bands.source, SOURCE_Y, EXT_COL_W);
  placeRowEven(bands.sink, SINK_Y, EXT_COL_W);

  for (const id of bands.input) {
    const px = avgProcX(getP(id).readBy);
    positions.set(id, { x: px, y: STORE_IN_Y });
  }

  for (const id of bands.shared) {
    const p = getP(id);
    const x = avgProcX(new Set([...p.writtenBy, ...p.readBy]));
    positions.set(id, { x, y: STORE_OUT_Y });
  }

  const byWriter = new Map<string, string[]>();
  for (const id of bands.output) {
    const writerPid = [...getP(id).writtenBy][0] ?? '';
    if (!byWriter.has(writerPid)) byWriter.set(writerPid, []);
    byWriter.get(writerPid)!.push(id);
  }

  const writerGroups = [...byWriter.entries()].sort((a, b) =>
    (procXByPid.get(a[0]) ?? 0) - (procXByPid.get(b[0]) ?? 0),
  );

  for (const [writerPid, storeIds] of writerGroups) {
    const cx = procXByPid.get(writerPid) ?? avgProcX(getP(storeIds[0]!).writtenBy);
    const groupW = (storeIds.length - 1) * STORE_COL_W;
    const startX = cx - groupW / 2;
    storeIds.forEach((id, i) => positions.set(id, { x: startX + i * STORE_COL_W, y: STORE_OUT_Y }));
  }

  // De-collision pass: push apart nodes in the same row that are too close.
  const byY = new Map<number, Array<{ id: string; x: number }>>();
  for (const [id, pos] of positions) {
    let row = byY.get(pos.y);
    if (!row) { row = []; byY.set(pos.y, row); }
    row.push({ id, x: pos.x });
  }
  const MIN_GAP = 205;
  for (const row of byY.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1]!;
      const cur = row[i]!;
      if (cur.x - prev.x < MIN_GAP) {
        cur.x = prev.x + MIN_GAP;
        positions.set(cur.id, { x: cur.x, y: positions.get(cur.id)!.y });
      }
    }
  }

  return positions;
}
