/**
 * flow-layout.ts — renderer-agnostic DFD layout helpers.
 *
 * Extracted from App.tsx so the SVG renderer can import them without
 * pulling in Cytoscape. The element descriptor type uses a plain object
 * shape instead of cytoscape.ElementDefinition.
 *
 * Exports: assignStoreNumbers, buildFlowData, computeFlowLayout
 */

import type { FlowDiagram } from '../flows/flow-parse';
import type { FlowKindKey } from '../theme/theme-defaults';

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
      extKind?: FlowKindKey;
      storeKind?: FlowKindKey;
      /** True when this store is one of two copies of a read+write store. */
      duplicated?: boolean;
      storeNum?: number;
      storeName?: string;
    }
  | {
      kind: 'edge';
      id: string;
      source: string;
      target: string;
      label: string;
      /** Structured data items for the hover tooltip. Array passthrough when edge.data is already
       *  string[]; a non-empty string is split on the literal ", " separator; empty/undefined → []. */
      dataLines: string[];
    };

/**
 * Normalize edge data to a string array for structured hover display.
 *
 * - string[]             → returned as-is (passthrough; items may contain ", " without splitting).
 * - non-empty string     → split on the literal ", " separator, matching the existing inline-chip
 *                          join precedent (`edge.data.join(', ')`).
 * - empty string / undefined → [].
 *
 * Pure; no DOM/React imports.
 */
export function normalizeEdgeData(data: string | string[] | undefined): string[] {
  if (Array.isArray(data)) return data;
  if (!data) return [];
  return data.split(', ');
}

// ── Process node sizing ────────────────────────────────────────────────────────

/**
 * Process-node sizing constants (#5). The floor matches the historical look so
 * short names render identically; only long labels grow the box.
 *
 * Geometry mirrors the renderer (FlowDiagramSvg.ProcessNode):
 *   - PROC_MIN_W / PROC_MIN_H — the historical fixed rect (the floor).
 *   - PROC_TEXT_LEFT — left reserve for the circular number badge + gap. The
 *     renderer docks the badge at `x + BADGE_R + 10` (BADGE_R = 10) and starts
 *     the text area at `badgeCx + BADGE_R + 4` = `x + 34`.
 *   - PROC_TEXT_RIGHT_PAD — symmetric right padding so the label never touches
 *     the rounded corner or the ⓘ / ⤵ affordances.
 *   - PROC_LINE_H — vertical pitch per wrapped line (matches the renderer).
 *   - PROC_TEXT_PAD_Y — top+bottom vertical padding inside the box.
 *   - PROC_FONT — label font size; PROC_CHAR_PX — per-character width estimate.
 *
 * No DOM/React/Bun — headless ELK and Bun tests have no measureText, so width is
 * estimated from character count (the same approach externals/stores use).
 */
export const PROC_MIN_W = 120;
export const PROC_MIN_H = 68;
export const PROC_TEXT_LEFT = 34;
export const PROC_TEXT_RIGHT_PAD = 14;
export const PROC_LINE_H = 15;
/**
 * Vertical padding inside the box (top + bottom combined). Tuned so the floor
 * height (PROC_MIN_H = 68) holds up to 2 lines — the historical maximum the
 * renderer drew — while a 3rd line grows the box: 2·15 + 38 = 68 (floor),
 * 3·15 + 38 = 83 (grows). The extra padding also clears the top-left number
 * badge so text never collides with it.
 */
export const PROC_TEXT_PAD_Y = 38;
const PROC_FONT = 11.5;
/** Per-character width estimate for the process label font (system-ui ~0.55·fontSize). */
const PROC_CHAR_PX = PROC_FONT * 0.55;
/**
 * Hard cap on box width before a too-long single word is broken instead of
 * widening further. Keeps a pathological name from blowing out the diagram.
 */
const PROC_MAX_W = 320;

/** Estimated rendered pixel width of one process-label line. Pure; exported for tests. */
export function estProcessLineWidth(line: string): number {
  return line.length * PROC_CHAR_PX;
}

/** Max characters that fit on one line for a given inner text width. */
function maxCharsForWidth(innerWidth: number): number {
  return Math.max(1, Math.floor(innerWidth / PROC_CHAR_PX));
}

/** Break a word longer than `maxChars` into hard-wrapped chunks. */
function breakLongWord(word: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < word.length; i += maxChars) {
    chunks.push(word.slice(i, i + maxChars));
  }
  return chunks;
}

/**
 * Greedy word-wrap into lines no wider than `innerWidth`. A single word wider
 * than the line is hard-broken so it never overflows.
 */
function wrapLabelToWidth(label: string, innerWidth: number): string[] {
  const maxChars = maxCharsForWidth(innerWidth);
  const words = label.split(/\s+/).filter(w => w.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const pieces = word.length > maxChars ? breakLongWord(word, maxChars) : [word];
    for (const piece of pieces) {
      if (current === '') {
        current = piece;
      } else if (estProcessLineWidth(`${current} ${piece}`) <= innerWidth) {
        current = `${current} ${piece}`;
      } else {
        lines.push(current);
        current = piece;
      }
    }
  }
  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/**
 * processNodeSize — pure sizing helper for a DFD process node (#5).
 *
 * Given a process label, returns the wrapped lines and the box {width, height}.
 * Width fits the longest wrapped line PLUS the number-badge reserve PLUS right
 * padding; height fits the line count PLUS vertical padding. A MIN floor
 * (PROC_MIN_W × PROC_MIN_H) preserves the historical look for short names — only
 * long names grow the box.
 *
 * Single source of truth: consumed by elk-flow-layout.ts `nodeSize` (so ELK lays
 * out with the true size) AND by FlowDiagramSvg (so the rect drawn is the same
 * box). Pure — no DOM/React/Bun. Width is char-count estimated (no measureText).
 */
export function processNodeSize(label: string): { lines: string[]; width: number; height: number } {
  // First wrap against the floor's inner width; if any line overflows, the box
  // widens to fit the longest line, then we re-wrap at the wider inner width so
  // the layout is consistent with the final width.
  const floorInner = PROC_MIN_W - PROC_TEXT_LEFT - PROC_TEXT_RIGHT_PAD;
  let lines = wrapLabelToWidth(label, floorInner);

  const widest = lines.reduce((max, l) => Math.max(max, estProcessLineWidth(l)), 0);
  let width = PROC_MIN_W;
  if (widest > floorInner) {
    const needed = Math.ceil(widest + PROC_TEXT_LEFT + PROC_TEXT_RIGHT_PAD);
    width = Math.min(PROC_MAX_W, Math.max(PROC_MIN_W, needed));
    // Re-wrap at the final inner width so each line truly fits (a hard-broken
    // long word may now fit fewer/more chars per line).
    const finalInner = width - PROC_TEXT_LEFT - PROC_TEXT_RIGHT_PAD;
    lines = wrapLabelToWidth(label, finalInner);
  }

  const height = Math.max(PROC_MIN_H, Math.ceil(lines.length * PROC_LINE_H + PROC_TEXT_PAD_Y));
  return { lines, width, height };
}

/** Endpoint kinds that denote a data store (everything except `ext` and `proc`). */
const STORE_KINDS: Record<string, true> = { db: true, cache: true, queue: true, file: true, doc: true, manual: true };

/**
 * A store written by some process AND read by another is drawn twice — a read
 * copy in the input band (above its readers) and a write copy in the output band
 * (below its writers) — so reads never have to route up and over to reach it.
 * Keyed by the unsplit store id (`kind:name`); `readId`/`writeId` collapse to the
 * store id when it isn't split.
 */
export type StoreSplitMap = Map<string, { readId: string; writeId: string; isSplit: boolean }>;

/** Return type of buildFlowData — everything the SVG renderer needs. */
export type FlowRenderData = {
  nodes: Extract<FlowElementData, { kind: 'node' }>[];
  edges: Extract<FlowElementData, { kind: 'edge' }>[];
  positions: Map<string, NodePos>;
  storeNums: Map<string, number>;
};

// ── Process columns + external routing ───────────────────────────────────────

/** Horizontal spacing between process columns. */
const PROC_COL_W = 380;

/** Column x for each process (`proc:id` → x), in dottedNumber order. */
function processColumnX(processes: FlowDiagram['processes']): Map<string, number> {
  const sorted = [...processes].sort((a, b) => {
    const ap = a.dottedNumber.split('.').map(Number);
    const bp = b.dottedNumber.split('.').map(Number);
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
      const d = (ap[i] ?? 0) - (bp[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  const total = (sorted.length - 1) * PROC_COL_W;
  const start = -total / 2;
  const m = new Map<string, number>();
  sorted.forEach((p, i) => m.set(`proc:${p.id}`, start + i * PROC_COL_W));
  return m;
}

import type { FlowStoreRef } from '../flows/flow-parse';

type ExtCopy = { id: string; role: 'src' | 'snk'; label: string; extId: string; extKind?: FlowStoreRef['kind']; procs: string[] };
type ExternalRouting = {
  /** One node per external copy to render. */
  copies: ExtCopy[];
  /** Copy id for an edge endpoint: which copy of `extName` serves `procId` in `role`. */
  resolve: (extName: string, procId: string, role: 'src' | 'snk') => string;
};

/**
 * Decide how each external is drawn: at most two aggregated copies per external.
 *
 * Source copy `ext:<id>--src` (band 0 / top): aggregates ALL partner processes
 * that the external emits into. Sink copy `ext:<id>--snk` (band 4 / bottom):
 * aggregates ALL partner processes that emit into the external.
 *
 * An external with only one role gets a single copy. The old per-partner split
 * (`ext:<id>--src--<proc>`) is removed — it was the cause of the "LLM Agent
 * duplicated 5×" defect (C14).
 */
function buildExternalRouting(diagram: FlowDiagram, procX: Map<string, number>): ExternalRouting {
  const readers = new Map<string, Set<string>>(); // extId → reader proc ids
  const writers = new Map<string, Set<string>>(); // extId → writer proc ids
  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    const s = m.get(k);
    if (s) s.add(v); else m.set(k, new Set([v]));
  };
  for (const e of diagram.edges) {
    if (e.from.kind === 'ext' && e.to.kind === 'proc') add(readers, e.from.name, e.to.name);
    if (e.from.kind === 'proc' && e.to.kind === 'ext') add(writers, e.to.name, e.from.name);
  }

  const copies: ExtCopy[] = [];
  const resolveMap = new Map<string, string>(); // `${extId}|${role}` → copy id

  for (const ext of diagram.externals) {
    for (const role of ['src', 'snk'] as const) {
      const partners = [...((role === 'src' ? readers : writers).get(ext.id) ?? [])];
      if (partners.length === 0) continue;
      // One aggregated copy per role — all partners share the same node id.
      const id = `ext:${ext.id}--${role}`;
      copies.push({ id, role, label: ext.label, extId: ext.id, extKind: ext.kind, procs: partners });
      resolveMap.set(`${ext.id}|${role}`, id);
    }
  }

  const resolve = (extName: string, _procId: string, role: 'src' | 'snk') =>
    resolveMap.get(`${extName}|${role}`) ?? `ext:${extName}--${role}`;
  return { copies, resolve };
}

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

  // External routing: at most one aggregated copy per role — a source copy
  // (band 0) and/or a sink copy (band 4) per external (see buildExternalRouting).
  const procX = processColumnX(diagram.processes);
  const extRouting = buildExternalRouting(diagram, procX);

  // Store split detection: a store both written and read is drawn twice.
  const storeSplitMap: StoreSplitMap = new Map();
  for (const store of diagram.storeRefs) {
    const storeId = `${store.kind}:${store.name}`;
    const isSplit = (storeWriters.get(storeId)?.size ?? 0) > 0 && (storeReaders.get(storeId)?.size ?? 0) > 0;
    storeSplitMap.set(storeId, {
      readId: isSplit ? `${storeId}--read` : storeId,
      writeId: isSplit ? `${storeId}--write` : storeId,
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

  // External nodes (one per routing copy).
  for (const c of extRouting.copies) {
    nodes.push({ kind: 'node', id: c.id, nodeType: 'external', label: c.label, extId: c.extId, extKind: c.extKind });
  }

  // Store ref nodes. A read+write store is emitted as two duplicated copies
  // (read copy, write copy), both carrying the same D# number.
  for (const store of diagram.storeRefs) {
    const storeId = `${store.kind}:${store.name}`;
    const num = storeNums.get(storeId) ?? 0;
    const split = storeSplitMap.get(storeId)!;
    const base = {
      kind: 'node' as const,
      nodeType: 'store' as const,
      label: store.displayName,
      storeKind: store.kind,
      storeNum: num,
      storeName: store.name,
    };
    if (split.isSplit) {
      // Both copies share the D#; register the split ids so the renderer's
      // storeNums lookup resolves them.
      storeNums.set(split.readId, num);
      storeNums.set(split.writeId, num);
      nodes.push({ ...base, id: split.readId, duplicated: true });
      nodes.push({ ...base, id: split.writeId, duplicated: true });
    } else {
      nodes.push({ ...base, id: storeId });
    }
  }

  // Edges.
  for (let i = 0; i < diagram.edges.length; i++) {
    const edge = diagram.edges[i]!;
    let fromId = `${edge.from.kind}:${edge.from.name}`;
    let toId = `${edge.to.kind}:${edge.to.name}`;

    if (edge.from.kind === 'ext') {
      fromId = extRouting.resolve(edge.from.name, edge.to.name, 'src'); // reader = the proc end
    } else if (STORE_KINDS[edge.from.kind]) {
      const split = storeSplitMap.get(fromId);
      if (split?.isSplit) fromId = split.readId; // store as source = a read
    }
    if (edge.to.kind === 'ext') {
      toId = extRouting.resolve(edge.to.name, edge.from.name, 'snk'); // writer = the proc end
    } else if (STORE_KINDS[edge.to.kind]) {
      const split = storeSplitMap.get(toId);
      if (split?.isSplit) toId = split.writeId; // store as target = a write
    }

    const label = Array.isArray(edge.data) ? edge.data.join(', ') : (edge.data ?? '');
    const dataLines = normalizeEdgeData(edge.data);
    // Read vs write is not encoded on the edge: it is conveyed at render time by
    // arrow direction (store→process reads, process→store writes), per canonical
    // SSADM/Gane-Sarson notation. No line-style distinction.
    edges.push({
      kind: 'edge',
      id: `flow-edge-${i}`,
      source: fromId,
      target: toId,
      label,
      dataLines,
    });
  }

  // Build the set of all node ids for computeFlowLayout.
  const allNodeIds = new Set<string>(nodes.map(n => n.id));
  const positions = computeFlowLayout(diagram, extRouting, storeSplitMap, procX, allNodeIds);

  return { nodes, edges, positions, storeNums };
}

// ── Banded layout ────────────────────────────────────────────────────────────

/**
 * computeFlowLayout — produce banded preset positions for a DFD.
 *
 * Bands (top → bottom):
 *   source-external  y = SOURCE_Y   (externals feeding into processes)
 *   input-store      y = STORE_IN_Y (stores processes read — incl. read copies of split stores)
 *   process          y = PROC_Y     (horizontal row, one column per process)
 *   output-store     y = STORE_OUT_Y (stores processes write — incl. write copies of split stores)
 *   sink-external    y = SINK_Y     (externals that receive output from processes)
 */
export function computeFlowLayout(
  diagram: FlowDiagram,
  extRouting: ExternalRouting,
  storeSplitMap: StoreSplitMap,
  procX: Map<string, number>,
  allNodeIds: Set<string>,
): Map<string, NodePos> {
  const SOURCE_Y = 80;
  const STORE_IN_Y = 220;
  const PROC_Y = 370;
  const STORE_OUT_Y = 520;
  const SINK_Y = 680;
  const STORE_COL_W = 215;

  // Store participation (which processes read/write each store) drives the
  // store-band x positions. Externals are positioned directly, not here.
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
      if (e.from.kind === 'ext') continue;
      const id = `${e.from.kind}:${e.from.name}`;
      const split = storeSplitMap.get(id);
      getP(split?.isSplit ? split.readId : id).readBy.add(pid);
    }
    for (const e of proc.outputs) {
      if (e.to.kind === 'ext') continue;
      const id = `${e.to.kind}:${e.to.name}`;
      const split = storeSplitMap.get(id);
      getP(split?.isSplit ? split.writeId : id).writtenBy.add(pid);
    }
  }

  const avgProcX = (pids: Iterable<string>): number => {
    let sum = 0, n = 0;
    for (const pid of pids) { sum += procX.get(pid) ?? 0; n++; }
    return n === 0 ? 0 : sum / n;
  };

  const positions = new Map<string, NodePos>();

  // Processes.
  for (const proc of diagram.processes) {
    const pid = `proc:${proc.id}`;
    positions.set(pid, { x: procX.get(pid) ?? 0, y: PROC_Y });
  }

  // External copies — directly above their readers / below their writers.
  for (const c of extRouting.copies) {
    positions.set(c.id, { x: avgProcX(c.procs.map(p => `proc:${p}`)), y: c.role === 'src' ? SOURCE_Y : SINK_Y });
  }

  // Stores → input band (read) above, output band (write) below.
  const inputStores: string[] = [];
  const outputStores: string[] = [];
  for (const nodeId of allNodeIds) {
    if (nodeId.startsWith('proc:') || nodeId.startsWith('ext:')) continue;
    const input = nodeId.endsWith('--read') || (!nodeId.endsWith('--write') && getP(nodeId).readBy.size > 0);
    (input ? inputStores : outputStores).push(nodeId);
  }

  // A process with a source external above it (or a sink external below it)
  // keeps the centre column for that straight external drop; its stores in that
  // band get shoved off to the sides so no edge routes around a stacked store.
  const procHasSrcExt = new Set<string>();
  const procHasSnkExt = new Set<string>();
  for (const c of extRouting.copies) {
    const target = c.role === 'src' ? procHasSrcExt : procHasSnkExt;
    for (const p of c.procs) target.add(`proc:${p}`);
  }

  const STORE_SIDE_OFFSET = 250;
  const sideSlot = (i: number) => (i % 2 === 0 ? -(i / 2 + 1) : (i + 1) / 2);        // -1,+1,-2,+2
  const centreSlot = (i: number) => (i === 0 ? 0 : i % 2 === 1 ? -((i + 1) / 2) : i / 2); // 0,-1,+1,-2,+2

  // Input stores cluster under their single reader (shared reads stay at the
  // centroid).
  const inputByReader = new Map<string, string[]>();
  for (const id of inputStores) {
    const readers = getP(id).readBy;
    if (readers.size === 1) {
      const r = [...readers][0]!;
      const list = inputByReader.get(r);
      if (list) list.push(id); else inputByReader.set(r, [id]);
    } else {
      positions.set(id, { x: avgProcX(readers), y: STORE_IN_Y });
    }
  }
  for (const [readerPid, ids] of inputByReader) {
    const px = procX.get(readerPid) ?? 0;
    const slotOf = procHasSrcExt.has(readerPid) ? sideSlot : centreSlot;
    ids.forEach((id, i) => positions.set(id, { x: px + slotOf(i) * STORE_SIDE_OFFSET, y: STORE_IN_Y }));
  }

  // Output stores grouped under their writer.
  const byWriter = new Map<string, string[]>();
  for (const id of outputStores) {
    const writerPid = [...getP(id).writtenBy][0] ?? '';
    const list = byWriter.get(writerPid);
    if (list) list.push(id); else byWriter.set(writerPid, [id]);
  }
  const writerGroups = [...byWriter.entries()].sort((a, b) =>
    (procX.get(a[0]) ?? 0) - (procX.get(b[0]) ?? 0),
  );
  for (const [writerPid, storeIds] of writerGroups) {
    const px = procX.get(writerPid) ?? avgProcX(getP(storeIds[0]!).writtenBy);
    if (procHasSnkExt.has(writerPid)) {
      // Sink external takes the centre drop → push output stores to the sides.
      storeIds.forEach((id, i) => positions.set(id, { x: px + sideSlot(i) * STORE_SIDE_OFFSET, y: STORE_OUT_Y }));
    } else {
      const groupW = (storeIds.length - 1) * STORE_COL_W;
      const startX = px - groupW / 2;
      storeIds.forEach((id, i) => positions.set(id, { x: startX + i * STORE_COL_W, y: STORE_OUT_Y }));
    }
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
