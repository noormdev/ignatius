/**
 * flow-layout.ts — renderer-agnostic DFD layout helpers.
 *
 * Extracted from App.tsx so the SVG renderer can import them without
 * pulling in Cytoscape. The element descriptor type uses a plain object
 * shape instead of cytoscape.ElementDefinition.
 *
 * Exports: assignStoreNumbers, buildFlowData, computeFlowLayout
 */

import type { FlowDiagram, FlowEdge } from '../flows/flow-parse';
import type { FlowKindKey } from '../theme/theme-defaults';
import type { FlowCluster } from '../flows/flow-clusters';
import type { SubtypeCluster, GroupConfig } from '../model/parse';

// ── Types ────────────────────────────────────────────────────────────────────

export type NodePos = { x: number; y: number };

/** Minimal element descriptor — no Cytoscape dep. */
/** One store inside a stack node's `members`. */
export type StackMember = {
  storeId: string;
  kind: FlowKindKey;
  displayName: string;
  storeNum: number;
  /** True when this store also appears in another stack (or plain node) in the same band. */
  duplicated: boolean;
};

/**
 * One row in a stack's dialog breakdown (StackDialog), at the current
 * collapse level (see buildStackRows). A `store` row is a single table,
 * capped by its own D# (`storeNum`) — D means data store, and a store row is
 * the only kind that is one. A `cluster`/`subtype`/`group` row aggregates 2+
 * members sharing that grouping and caps with a plain letter instead — `C`
 * for cluster/subtype, `G` for group, never a D# — a `group` row nests its
 * cluster and table rows as `children`.
 */
export type StackRow =
  | { kind: 'store'; storeId: string; displayName: string; storeNum: number }
  | {
      kind: 'cluster' | 'subtype';
      label: string;
      count: number;
      cap: 'C';
      memberIds: string[];
      children?: StackRow[];
    }
  | {
      kind: 'group';
      label: string;
      count: number;
      cap: 'G';
      memberIds: string[];
      children?: StackRow[];
    };

/**
 * The four node shapes, discriminated on `nodeType` — each carries only the
 * fields that kind of node has. `Extract<FlowElementData, { nodeType: 'stack' }>`
 * (etc.) narrows to exactly one of these; a single merged object with every
 * field optional would make that Extract resolve to `never`, since `nodeType`
 * itself would still be the wide `'process' | 'external' | 'store' | 'stack'`
 * union rather than a per-branch literal.
 */
export type ProcessNodeData = { kind: 'node'; id: string; nodeType: 'process'; label: string; hasSubDfd: boolean; processId: string };
export type ExternalNodeData = { kind: 'node'; id: string; nodeType: 'external'; label: string; extId: string; extKind?: FlowKindKey };
export type StoreNodeData = {
  kind: 'node';
  id: string;
  nodeType: 'store';
  label: string;
  storeKind: FlowKindKey;
  /** True when this store is one of two copies of a read+write store, or
   *  otherwise present elsewhere in the same band. */
  duplicated?: boolean;
  storeNum: number;
  storeName: string;
};
export type StackNodeData = {
  kind: 'node';
  id: string;
  nodeType: 'stack';
  label: string;
  /** Which band the stack belongs to. */
  direction: 'read' | 'write';
  /** The stores it aggregates. */
  members: StackMember[];
  /** Its dialog rows at the current collapse level. */
  rows: StackRow[];
  /** Which grouping pass produced it. */
  source: 'per-process' | 'cluster' | 'subtype' | 'group' | 'adjacency';
  /** Adjacency stacks only: the process ids that read / wrote every member. */
  adjacencyReaders?: string[];
  adjacencyWriters?: string[];
};
export type FlowNodeData = ProcessNodeData | ExternalNodeData | StoreNodeData | StackNodeData;

export type FlowElementData =
  | FlowNodeData
  | {
      kind: 'edge';
      id: string;
      source: string;
      target: string;
      label: string;
      /** True when `label` is an authored `label:` (never truncated/hidden on the
       *  canvas) rather than the column-preview fallback (subject to the chip
       *  length gate). */
      hasAuthoredLabel: boolean;
      /** Structured data items for the hover tooltip. Array passthrough when edge.data is already
       *  string[]; a non-empty string is split on the literal ", " separator; empty/undefined → []. */
      dataLines: string[];
      /** Set on an edge into/out of a stack node: the parsed edges it aggregates,
       *  so the contract dialog can list every member's columns. */
      memberEdges?: FlowEdge[];
      /** Set on a mixed stack edge (some members labelled, some not): the exact
       *  chip lines to render, already split and gated — the renderer must use
       *  these verbatim rather than re-splitting `label` on ", ", which would
       *  fragment a multi-column unlabelled-member preview into indistinguishable
       *  lines (see resolveStackEdgeLabel). */
      chipLines?: string[];
    };

/**
 * Normalize edge data to a string array for structured hover display.
 *
 * - string[]             → returned as-is (passthrough; items may contain ", " without splitting).
 * - non-empty string     → split on the literal ", " separator at paren depth 0, matching the
 *                          existing inline-chip join precedent (`edge.data.join(', ')`) while
 *                          keeping a prose item's own parenthesized list — e.g.
 *                          "new tag (name, description)" — on one line.
 * - empty string / undefined → [].
 *
 * Pure; no DOM/React imports.
 */
export function normalizeEdgeData(data: string | string[] | undefined): string[] {
  if (Array.isArray(data)) return data;
  if (!data) return [];
  const lines: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === ',' && data[i + 1] === ' ') {
      lines.push(data.slice(start, i));
      i++;
      start = i + 1;
    }
  }
  lines.push(data.slice(start));
  return lines;
}

// The chip length gate. Applies to the column-preview fallback only; an
// authored label is never truncated (see resolveChipLines). elk-flow-layout.ts's
// legacy SHORT_LABEL_MAX derives from this constant rather than redeclaring it.
export const CHIP_TRUNCATE_MAX = 22;

function truncateChipLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  return line.slice(0, maxChars - 1) + '…';
}

/**
 * resolveChipLines — pure: turns an edge's resolved chip label into the lines
 * the SVG renderer draws.
 *
 * An authored `label:` (`hasAuthoredLabel`) is never truncated or hidden — it
 * renders in full, breaking into one line per ", "-separated item (the
 * hand-drawn-DFD convention for a multi-item flow).
 *
 * A column-preview fallback keeps the historical length gate: a short preview
 * (≤ CHIP_TRUNCATE_MAX) renders full inline, split by item; a long preview
 * collapses to a single truncated chip ending in '…' so the canvas always
 * shows a "more data here" marker — the full contract is still reachable via
 * data-contract and the hover tooltip. Empty label → no chip (lines: []).
 */
export function resolveChipLines(label: string, hasAuthoredLabel: boolean): { lines: string[]; hasHiddenLabel: boolean } {
  if (hasAuthoredLabel) {
    return { lines: label.split(', '), hasHiddenLabel: false };
  }
  const isInline = !!label && label.length <= CHIP_TRUNCATE_MAX;
  const lines = isInline
    ? label.split(', ').map(l => truncateChipLine(l, CHIP_TRUNCATE_MAX))
    : label
      ? [truncateChipLine(label, CHIP_TRUNCATE_MAX)]
      : [];
  const hasHiddenLabel = !!label && !isInline;
  return { lines, hasHiddenLabel };
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

/** Height of one store box — a one-row stack sizes to exactly this, matching
 *  FlowDiagramSvg's drawn store height exactly (not just ELK's reservation
 *  for it), so a one-row stack is visually identical to a plain store box.
 *  The single canonical value: elk-flow-layout.ts's nodeSize and
 *  FlowDiagramSvg's store/stack drawing code both import this constant
 *  rather than redeclaring it. */
export const STORE_ROW_H = 34;

/** Fixed width of the D# cap column, left of a store/stack row's name — the
 *  single canonical value FlowDiagramSvg's cap-column drawing and
 *  stackNodeSize's width estimate both use. */
export const STORE_CAP_W = 34;

/** Stroke width of a store/stack box's outline and dividers — the single
 *  canonical value FlowDiagramSvg's StoreNode/StackNode drawing and
 *  STACK_ROW_PEEK_RESERVE's clearance derivation both use, so the reserve
 *  that keeps a grouped row's peek marks from fusing with the next row's
 *  divider can never drift out of sync with the line width it has to clear. */
export const STORE_STROKE_W = 1.4;

const STORE_BODY_MIN_W = 136;
// Right-side slot reserved for the ⓘ doc badge, so it never overlaps the name.
const STORE_INFO_PAD = 22;

/**
 * measureText — estimated rendered pixel width of one line of text at a given
 * font size (~0.55×fontSize per character for system-ui, +12 padding). No
 * DOM/canvas measureText call — headless ELK and Bun tests have none, so
 * every width in this module is an estimate from character count, same
 * approach processNodeSize uses. Shared by storeBodyWidth (below) and
 * FlowDiagramSvg's edge-chip sizing, so one formula backs every text-width
 * estimate in the flow view.
 */
export function measureText(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55 + 12;
}

/**
 * storeBodyWidth — a store's body-column width (name only, the cap column is
 * fixed-width and sized separately). Shared by FlowDiagramSvg's storeWidth
 * (a plain store box) and stackNodeSize (below), so a stacked and a plain box
 * with the same member name always come out the same width.
 */
export function storeBodyWidth(name: string): number {
  return Math.max(STORE_BODY_MIN_W, measureText(name, 11.5) + STORE_INFO_PAD);
}

/**
 * Down-right offset (px) of a grouped (cluster/subtype/group) row's "more
 * inside" stacked-paper peek marker's furthest (back) copy — drawn by
 * FlowDiagramSvg's StackNode. Deliberately NOT part of stackNodeSize's
 * reported height (see below) — it is bottom padding on the drawn box,
 * invisible to ELK and to nodeBounds.
 */
export const STACK_ROW_PEEK_GAP = 6;

/**
 * Extra clearance (px) reserved beyond STACK_ROW_PEEK_GAP after a grouped
 * row — without it, the next row's own top divider lands exactly on the back
 * copy's bottom mark (both at the same y) and the two fuse into what reads
 * as one line instead of three distinct ones. Derived from STORE_STROKE_W
 * (the actual line width that must clear) plus 1px of visible gap, so a
 * future stroke-width change can't silently reopen the fusion this exists to
 * prevent.
 */
const STACK_ROW_PEEK_CLEARANCE = STORE_STROKE_W + 2;

/** Total space stackRowLayout reserves after a grouped row: room for the
 *  back copy's peek marks plus STACK_ROW_PEEK_CLEARANCE of clear space
 *  before the next row's own divider. */
export const STACK_ROW_PEEK_RESERVE = STACK_ROW_PEEK_GAP + STACK_ROW_PEEK_CLEARANCE;

/**
 * stackRowLayout — each row's top offset from the stack's own top edge, plus
 * the stack's total DRAWN content height (rows plus STACK_ROW_PEEK_RESERVE
 * after every grouped row). Used only by FlowDiagramSvg's StackNode to place
 * rows and draw the box — never by stackNodeSize/ELK/nodeBounds (see below):
 * a grouped row's peek reserve is bottom padding on the drawn box, not part
 * of the node's official size, so it never inflates a stack past a
 * same-row-count plain stack for layout/alignment/hit-testing purposes.
 */
export function stackRowLayout(rows: StackRow[]): { offsets: number[]; height: number } {
  const offsets: number[] = [];
  let y = 0;
  for (const row of rows) {
    offsets.push(y);
    y += STORE_ROW_H + (row.kind !== 'store' ? STACK_ROW_PEEK_RESERVE : 0);
  }
  // The clearance only keeps a grouped row's back sheet off the NEXT row's
  // divider; after the last row there is no divider, so the drawn box ends
  // on the back sheet's bottom edge and an edge docking there meets it.
  if (rows.length > 0 && rows[rows.length - 1]!.kind !== 'store') y -= STACK_ROW_PEEK_CLEARANCE;
  return { offsets, height: Math.max(STORE_ROW_H, y) };
}

/** The text StackNode actually renders for one row's body column — a store
 *  row shows its display name, a grouped row its label plus the `(N)` count
 *  (see FlowDiagramSvg's StackNode `bodyLabel`). Exported so width sizing and
 *  the renderer can never drift onto two different formulas for the same text. */
export function stackRowBodyText(row: StackRow): string {
  return row.kind === 'store' ? row.displayName : `${row.label} (${row.count})`;
}

/**
 * stackNodeSize — pure sizing helper for a stack node's OFFICIAL size: what
 * ELK lays out against and what nodeBounds reports for edge anchors, chip
 * placement, and the viewBox. Shared by elk-flow-layout.ts's nodeSize and
 * FlowDiagramSvg's nodeBounds.
 *
 * Height: one row per member, STORE_ROW_H each — never inflated by a grouped
 * row's peek gap, so two stacks with the same row count always share the
 * same official height (and, once ELK aligns them within a band, the same
 * top edge) regardless of whether one of them has a grouped row. The peek
 * gap is drawn padding only — see stackRowLayout, used solely by StackNode.
 * Width: the fixed cap column plus the widest RENDERED ROW's body width — a
 * grouped row's `<label> (<N>)` text can outrun every member's own display
 * name (e.g. "BuildingPart subtypes (2)"), so width must be measured from
 * rows, not members, or the badge overlaps the row text (docs/spec/dfd-store-clusters.md).
 */
export function stackNodeSize(members: StackMember[], rows: StackRow[]): { width: number; height: number } {
  const height = STORE_ROW_H * Math.max(1, rows.length);
  const widestBody = rows.reduce((max, r) => Math.max(max, storeBodyWidth(stackRowBodyText(r))), 0);
  return { width: STORE_CAP_W + widestBody, height };
}

/**
 * A store written by some process AND read by another is drawn twice — a read
 * copy in the input band (above its readers) and a write copy in the output band
 * (below its writers) — so reads never have to route up and over to reach it.
 * Keyed by the unsplit store id (`kind:name`); `readId`/`writeId` collapse to the
 * store id when it isn't split.
 */
export type StoreSplitMap = Map<string, { readId: string; writeId: string; isSplit: boolean }>;

/** Return type of buildFlowData — everything the SVG renderer needs. Every
 *  node already carries its own resolved D# (StoreNodeData.storeNum /
 *  StackMember.storeNum) — there is no separate store-number map to key by
 *  a rendered (possibly split `--read`/`--write`) node id. */
export type FlowRenderData = {
  nodes: Extract<FlowElementData, { kind: 'node' }>[];
  edges: Extract<FlowElementData, { kind: 'edge' }>[];
  positions: Map<string, NodePos>;
};

/**
 * buildFlowData's optional grouping argument. Omitting it (or `view` inside
 * it) keeps today's per-store output — every existing call site is
 * unaffected. `collapseLevel`/`clusters`/`subtypeClusters`/`groups` are
 * accepted here as hooks for the connected view's cluster/subtype/group
 * grouping, which reads them; the per-process view only reads `view` and
 * `adjacencyStacks`.
 */
export type BuildFlowDataOpts = {
  view?: 'per-process' | 'connected';
  collapseLevel?: 'stores' | 'clusters' | 'groups';
  clusters?: FlowCluster[];
  subtypeClusters?: SubtypeCluster[];
  groups?: Record<string, GroupConfig>;
  /** Entity id → group name, e.g. `Model.nodes` reduced to `{ id: group }`.
   *  Drives the connected view's groups-level grouping (step 3) and the
   *  groups-level row breakdown (buildStackRows) — `groups` alone only has
   *  the group's label/color, not which entities belong to it. */
  entityGroups?: Record<string, string>;
  adjacencyStacks?: boolean;
};

/**
 * Appends the active view name to a diagram's fingerprint-derived layout key,
 * so a drag saved in the per-process view never applies to the connected view
 * (or vice versa) — collapse level is excluded since it changes rows, not
 * node ids. `baseKey` empty (diagram not found in the fingerprint map) stays
 * empty rather than producing a key with no fingerprint behind it.
 */
export function layoutKeyForView(baseKey: string, view: BuildFlowDataOpts['view']): string {
  return baseKey ? `${baseKey}::${view}` : '';
}

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

// ── Per-process stacks (default view) ──────────────────────────────────────

const STACK_THRESHOLD = 2;

type StackDirection = 'read' | 'write';

/** One process's touched stores in one direction, deduped in authored order. */
type ProcSide = {
  processId: string;
  direction: StackDirection;
  memberIds: string[];
  edgesByMember: Map<string, FlowEdge[]>;
};

function collectProcSides(diagram: FlowDiagram): ProcSide[] {
  const sides: ProcSide[] = [];
  for (const proc of diagram.processes) {
    for (const direction of ['read', 'write'] as const) {
      const flowEdges = direction === 'read' ? proc.inputs : proc.outputs;
      const memberIds: string[] = [];
      const seen = new Set<string>();
      const edgesByMember = new Map<string, FlowEdge[]>();
      for (const e of flowEdges) {
        const endpoint = direction === 'read' ? e.from : e.to;
        if (!STORE_KINDS[endpoint.kind]) continue;
        const id = `${endpoint.kind}:${endpoint.name}`;
        if (!seen.has(id)) { seen.add(id); memberIds.push(id); }
        const list = edgesByMember.get(id);
        if (list) list.push(e); else edgesByMember.set(id, [e]);
      }
      sides.push({ processId: proc.id, direction, memberIds, edgesByMember });
    }
  }
  return sides;
}

function stackIdFor(memberIds: string[], direction: StackDirection): string {
  return `stack:${[...memberIds].sort().join('+')}--${direction}`;
}

/** The entity name backing a store id (`db:HubStoreA` → `HubStoreA`). */
function bareEntityName(storeId: string): string {
  return storeId.slice(storeId.indexOf(':') + 1);
}

/** A member fed into buildStackRows: enough to build a store row and test
 *  cluster/subtype/group membership. `clusterTag` is the explicit `cluster:`
 *  tag carried by an edge that touched this member, if any. */
type RowMember = {
  storeId: string;
  displayName: string;
  storeNum: number;
  clusterTag?: { slug: string; label: string };
};

/**
 * buildStackRows — a stack's dialog rows at the current collapse level,
 * scoped to exactly the members handed in (never re-derives membership from
 * a wider set of stores).
 *
 * "stores": one row per member.
 * "clusters": one row per explicit-tag/author cluster and per subtype family
 *   with 2+ members in this stack, then one row per loose table.
 * "groups": one row per group with 2+ members in this stack (nesting its
 *   cluster/subtype and table rows as children), then a cluster/subtype
 *   spanning 2+ groups as its own row, then loose tables.
 */
function buildStackRows(
  members: RowMember[],
  collapseLevel: BuildFlowDataOpts['collapseLevel'],
  clusters: FlowCluster[],
  subtypeClusters: SubtypeCluster[],
  groups: Record<string, GroupConfig>,
  entityGroups: Record<string, string>,
): StackRow[] {
  const storeRow = (m: RowMember): StackRow => ({ kind: 'store', storeId: m.storeId, displayName: m.displayName, storeNum: m.storeNum });

  if (!collapseLevel || collapseLevel === 'stores') return members.map(storeRow);

  const claimed = new Set<string>();

  // Explicit `cluster:` tags — no member-count threshold, the author asked for it.
  const bySlug = new Map<string, { label: string; ms: RowMember[] }>();
  for (const m of members) {
    if (!m.clusterTag) continue;
    const entry = bySlug.get(m.clusterTag.slug) ?? { label: m.clusterTag.label, ms: [] };
    entry.ms.push(m);
    bySlug.set(m.clusterTag.slug, entry);
  }
  const clusterRows: StackRow[] = [];
  for (const { label, ms } of bySlug.values()) {
    clusterRows.push({ kind: 'cluster', label, count: ms.length, cap: 'C', memberIds: ms.map(m => m.storeId) });
    for (const m of ms) claimed.add(m.storeId);
  }

  // Author clusters, over members no explicit tag already claimed.
  for (const C of clusters) {
    const ms = members.filter(m => !claimed.has(m.storeId) && C.entities.includes(bareEntityName(m.storeId)));
    if (ms.length < 2) continue;
    clusterRows.push({ kind: 'cluster', label: C.label, count: ms.length, cap: 'C', memberIds: ms.map(m => m.storeId) });
    for (const m of ms) claimed.add(m.storeId);
  }

  // Subtype families.
  const subtypeRows: StackRow[] = [];
  for (const SC of subtypeClusters) {
    const family = new Set([SC.basetype, ...SC.members]);
    const ms = members.filter(m => !claimed.has(m.storeId) && family.has(bareEntityName(m.storeId)));
    if (ms.length < 2) continue;
    const hasBasetype = ms.some(m => bareEntityName(m.storeId) === SC.basetype);
    subtypeRows.push({
      kind: 'subtype',
      label: hasBasetype ? SC.basetype : `${SC.basetype} subtypes`,
      count: ms.length,
      cap: 'C',
      memberIds: ms.map(m => m.storeId),
    });
    for (const m of ms) claimed.add(m.storeId);
  }

  const looseTables = members.filter(m => !claimed.has(m.storeId)).map(storeRow);

  if (collapseLevel === 'clusters') return [...clusterRows, ...subtypeRows, ...looseTables];

  // Groups: group rows (2+ members in this stack) nest their cluster/subtype
  // and table rows; a cluster/subtype spanning 2+ groups stays its own row.
  const groupedRows = [...clusterRows, ...subtypeRows];
  const groupOf = (storeId: string) => entityGroups[bareEntityName(storeId)];

  const byGroupName = new Map<string, RowMember[]>();
  for (const m of members) {
    const g = groupOf(m.storeId);
    if (!g) continue;
    const list = byGroupName.get(g) ?? [];
    list.push(m);
    byGroupName.set(g, list);
  }

  const groupRows: StackRow[] = [];
  const consumedRows = new Set<StackRow>();
  const groupedMemberIds = new Set<string>();
  for (const [groupName, ms] of byGroupName) {
    if (ms.length < 2) continue;
    const memberIdSet = new Set(ms.map(m => m.storeId));
    const childRows = groupedRows.filter(row => row.kind !== 'store' && row.memberIds.every(id => memberIdSet.has(id)));
    const childRowIds = new Set(childRows.flatMap(row => (row.kind === 'store' ? [] : row.memberIds)));
    const childTables = ms.filter(m => !childRowIds.has(m.storeId)).map(storeRow);
    for (const row of childRows) consumedRows.add(row);
    for (const id of memberIdSet) groupedMemberIds.add(id);
    groupRows.push({
      kind: 'group',
      label: groups[groupName]?.label ?? groupName,
      count: ms.length,
      cap: 'G',
      memberIds: ms.map(m => m.storeId),
      children: [...childRows, ...childTables],
    });
  }

  const spanningRows = groupedRows.filter(row => !consumedRows.has(row));
  const looseAtGroups = members.filter(m => !claimed.has(m.storeId) && !groupedMemberIds.has(m.storeId)).map(storeRow);

  return [...groupRows, ...spanningRows, ...looseAtGroups];
}

/**
 * Chip lines for a stack edge.
 *
 * No member carries a label: — the deduplicated union of every member's
 * columns as a single column-preview line, subject to the same length gate
 * as an unauthored plain edge (never the members' display names, which
 * merely repeat text the stack's own rows already show); falls back to
 * display names only when no member carries column data at all. `chipLines`
 * is omitted here — the renderer's existing resolveChipLines(label, false)
 * path already produces the right single-line-or-split rendering.
 *
 * At least one member carries a label: — the distinct authored labels one
 * per line (never truncated), followed by ONE gated column-preview line
 * covering every unlabelled member — the deduplicated union of their columns,
 * truncated to CHIP_TRUNCATE_MAX — so an unlabelled member is still
 * represented, not silently dropped, without repeating a line per member.
 * Returned as `chipLines`: the renderer must render these lines verbatim,
 * since resolveChipLines' `label.split(', ')` would re-fragment a
 * multi-column preview line at its own internal comma.
 */
function resolveStackEdgeLabel(
  memberEdges: FlowEdge[],
  members: StackMember[],
): { label: string; hasAuthoredLabel: boolean; chipLines?: string[] } {
  const authored = [...new Set(memberEdges.map(e => e.label).filter((l): l is string => l !== undefined))];
  if (authored.length === 0) {
    const columns = new Set<string>();
    for (const e of memberEdges) for (const col of normalizeEdgeData(e.data)) columns.add(col);
    const preview = columns.size > 0 ? [...columns].join(', ') : members.map(m => m.displayName).join(', ');
    return { label: preview, hasAuthoredLabel: false };
  }
  const unlabelledColumns = new Set<string>();
  for (const e of memberEdges) {
    if (e.label !== undefined) continue;
    for (const col of normalizeEdgeData(e.data)) unlabelledColumns.add(col);
  }
  const unlabelledPreview = unlabelledColumns.size > 0
    ? truncateChipLine([...unlabelledColumns].join(', '), CHIP_TRUNCATE_MAX)
    : undefined;
  const chipLines = unlabelledPreview ? [...authored, unlabelledPreview] : authored;
  return { label: chipLines.join(', '), hasAuthoredLabel: true, chipLines };
}

/**
 * buildPerProcessStores — the default (per-process) view's grouping.
 *
 * For each process and direction, two or more touched stores become one
 * stack node (id `stack:<sorted member ids>--<direction>`); a single touched
 * store stays the plain store node it is today. Two processes with the
 * identical member set converge on the same stack id and share the node. A
 * store present in more than one stack (or a stack and a plain node) in the
 * same band carries the duplicate marker on every occurrence.
 *
 * `positionInputs` maps every emitted node id to the split store ids whose
 * position computeFlowLayout would assign them today — the caller averages
 * those into the stack's position rather than teaching the banded fallback
 * layout about stack participation.
 */
function buildPerProcessStores(
  diagram: FlowDiagram,
  storeNums: Map<string, number>,
  storeSplitMap: StoreSplitMap,
  opts: BuildFlowDataOpts,
): {
  nodes: Extract<FlowElementData, { kind: 'node' }>[];
  edges: Extract<FlowElementData, { kind: 'edge' }>[];
  positionInputs: Map<string, string[]>;
} {
  const storeInfo = new Map<string, { kind: FlowKindKey; displayName: string }>();
  for (const store of diagram.storeRefs) {
    storeInfo.set(`${store.kind}:${store.name}`, { kind: store.kind, displayName: store.displayName });
  }

  const procSides = collectProcSides(diagram);
  const clusters = opts.clusters ?? [];
  const subtypeClusters = opts.subtypeClusters ?? [];
  const groups = opts.groups ?? {};
  const entityGroups = opts.entityGroups ?? {};

  const stacksById = new Map<string, { direction: StackDirection; memberIds: string[] }>();
  // A stack's members' `cluster:`-tagged edges, unioned across every process
  // that shares this stack id — feeds buildStackRows' explicit-tag pass.
  const stackClusterTagByMember = new Map<string, Map<string, { slug: string; label: string }>>();
  for (const side of procSides) {
    if (side.memberIds.length < STACK_THRESHOLD) continue;
    const id = stackIdFor(side.memberIds, side.direction);
    if (!stacksById.has(id)) stacksById.set(id, { direction: side.direction, memberIds: [...side.memberIds].sort() });
    const tagByMember = stackClusterTagByMember.get(id) ?? new Map<string, { slug: string; label: string }>();
    for (const [memberId, memberEdges] of side.edgesByMember) {
      const tag = memberEdges.find(e => e.cluster)?.cluster;
      if (tag) tagByMember.set(memberId, tag);
    }
    stackClusterTagByMember.set(id, tagByMember);
  }

  // Where each store appears within a band: distinct stack ids, plus one
  // `plain:<processId>` marker per process that renders it as a plain node.
  const placesByStore = new Map<string, Set<string>>();
  const addPlace = (direction: StackDirection, storeId: string, place: string) => {
    const key = `${direction}:${storeId}`;
    const set = placesByStore.get(key) ?? new Set<string>();
    set.add(place);
    placesByStore.set(key, set);
  };
  for (const [stackId, info] of stacksById) {
    for (const m of info.memberIds) addPlace(info.direction, m, stackId);
  }
  for (const side of procSides) {
    if (side.memberIds.length === 1) addPlace(side.direction, side.memberIds[0]!, `plain:${side.processId}`);
  }
  const isDuplicated = (direction: StackDirection, storeId: string): boolean =>
    (placesByStore.get(`${direction}:${storeId}`)?.size ?? 0) > 1;

  const nodes: Extract<FlowElementData, { kind: 'node' }>[] = [];
  const edges: Extract<FlowElementData, { kind: 'edge' }>[] = [];
  const positionInputs = new Map<string, string[]>();
  const stackMembersById = new Map<string, StackMember[]>();

  for (const [stackId, info] of stacksById) {
    const members: StackMember[] = info.memberIds.map(id => {
      const meta = storeInfo.get(id)!;
      return {
        storeId: id,
        kind: meta.kind,
        displayName: meta.displayName,
        storeNum: storeNums.get(id) ?? 0,
        duplicated: isDuplicated(info.direction, id),
      };
    });
    stackMembersById.set(stackId, members);
    const tagByMember = stackClusterTagByMember.get(stackId);
    const rowMembers: RowMember[] = members.map(m => ({
      storeId: m.storeId,
      displayName: m.displayName,
      storeNum: m.storeNum,
      clusterTag: tagByMember?.get(m.storeId),
    }));
    nodes.push({
      kind: 'node',
      id: stackId,
      nodeType: 'stack',
      label: `${members.length} stores`,
      direction: info.direction,
      members,
      rows: buildStackRows(rowMembers, opts.collapseLevel, clusters, subtypeClusters, groups, entityGroups),
      source: 'per-process',
    });
    positionInputs.set(
      stackId,
      info.memberIds.map(id => {
        const split = storeSplitMap.get(id)!;
        return info.direction === 'read' ? split.readId : split.writeId;
      }),
    );
  }

  const plainNodeIds = new Set<string>();
  let edgeSeq = 0;
  for (const side of procSides) {
    if (side.memberIds.length === 0) continue;
    const procNodeId = `proc:${side.processId}`;

    if (side.memberIds.length >= STACK_THRESHOLD) {
      const stackId = stackIdFor(side.memberIds, side.direction);
      const info = stacksById.get(stackId)!;
      const memberEdges = info.memberIds.flatMap(id => side.edgesByMember.get(id) ?? []);
      const { label, hasAuthoredLabel, chipLines } = resolveStackEdgeLabel(memberEdges, stackMembersById.get(stackId)!);
      edges.push({
        kind: 'edge',
        id: `stack-edge:${side.processId}:${side.direction}:${edgeSeq++}`,
        source: side.direction === 'read' ? stackId : procNodeId,
        target: side.direction === 'read' ? procNodeId : stackId,
        label,
        hasAuthoredLabel,
        dataLines: memberEdges.flatMap(e => normalizeEdgeData(e.data)),
        memberEdges,
        chipLines,
      });
      continue;
    }

    // Single member — the plain store node it is today.
    const storeId = side.memberIds[0]!;
    const split = storeSplitMap.get(storeId)!;
    const splitId = side.direction === 'read' ? split.readId : split.writeId;
    if (!plainNodeIds.has(splitId)) {
      plainNodeIds.add(splitId);
      const meta = storeInfo.get(storeId)!;
      nodes.push({
        kind: 'node',
        id: splitId,
        nodeType: 'store',
        label: meta.displayName,
        storeKind: meta.kind,
        storeNum: storeNums.get(storeId) ?? 0,
        storeName: storeId.slice(storeId.indexOf(':') + 1),
        // Split (read+write two copies) OR present elsewhere in the same
        // band (another process's stack, or another process's own plain
        // node) — either makes this the same store rendered more than once.
        duplicated: split.isSplit || isDuplicated(side.direction, storeId),
      });
      positionInputs.set(splitId, [splitId]);
    }
    for (const e of side.edgesByMember.get(storeId) ?? []) {
      const previewLabel = Array.isArray(e.data) ? e.data.join(', ') : (e.data ?? '');
      edges.push({
        kind: 'edge',
        id: `stack-edge:${side.processId}:${side.direction}:${edgeSeq++}`,
        source: side.direction === 'read' ? splitId : procNodeId,
        target: side.direction === 'read' ? procNodeId : splitId,
        label: e.label ?? previewLabel,
        hasAuthoredLabel: e.label !== undefined,
        dataLines: normalizeEdgeData(e.data),
        // Single member, but still carried so the click handler can open
        // EdgeContractDialog the same way it does for an aggregated stack
        // edge — every per-process-view edge id is `stack-edge:...`, none
        // index back into diagram.edges by position.
        memberEdges: [e],
      });
    }
  }

  return { nodes, edges, positionInputs };
}

/**
 * resolveEdgeEndpoints — an authored edge's source/target node ids: an `ext:`
 * endpoint resolves to its aggregated routing copy, a split store resolves to
 * its read or write copy, everything else is its bare `kind:name` id. Shared
 * by the default per-store edge loop and the per-process view's ext-only pass.
 */
function resolveEdgeEndpoints(
  edge: FlowEdge,
  extRouting: ExternalRouting,
  storeSplitMap: StoreSplitMap,
): { source: string; target: string } {
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
  return { source: fromId, target: toId };
}

/**
 * renderExtEdges — the external-facing edges of a diagram, unaggregated by
 * store. Shared by the per-process and connected views: externals stay at
 * buildExternalRouting's one source/sink copy per external regardless of
 * grouping.
 */
function renderExtEdges(
  diagram: FlowDiagram,
  extRouting: ExternalRouting,
  storeSplitMap: StoreSplitMap,
): Extract<FlowElementData, { kind: 'edge' }>[] {
  const edges: Extract<FlowElementData, { kind: 'edge' }>[] = [];
  for (let i = 0; i < diagram.edges.length; i++) {
    const edge = diagram.edges[i]!;
    if (edge.from.kind !== 'ext' && edge.to.kind !== 'ext') continue;
    const { source, target } = resolveEdgeEndpoints(edge, extRouting, storeSplitMap);
    const previewLabel = Array.isArray(edge.data) ? edge.data.join(', ') : (edge.data ?? '');
    edges.push({
      kind: 'edge',
      id: `flow-edge-${i}`,
      source,
      target,
      label: edge.label ?? previewLabel,
      hasAuthoredLabel: edge.label !== undefined,
      dataLines: normalizeEdgeData(edge.data),
    });
  }
  return edges;
}

/** One process's contribution to a connected-view group: which of its own
 *  touched members qualified it in. */
type GroupContribution = { processId: string; memberIds: string[] };

/** One connected-view group node in progress: its final member union plus
 *  the per-process contributions that fed it (used to build one edge per
 *  qualifying process and to detect which members are also plain elsewhere). */
type ConnectedGroup = {
  id: string;
  kind: 'cluster' | 'subtype' | 'group' | 'adjacency';
  label: string;
  memberIds: string[];
  contributions: GroupContribution[];
};

/**
 * buildConnectedViewGrouping — the connected view's grouping: today's
 * one-node-per-store model, with 2+ touched stores collapsing into one
 * cluster/subtype/group/adjacency node per band. Grouping order, each step
 * consuming what the previous left ungrouped:
 *   0. an edge's explicit `cluster:` tag — whatever the member count, claims
 *      the store for every process that touches it (an authoring choice, not
 *      a per-process threshold)
 *   1. author clusters (opts.clusters) — per process: joins only when that
 *      process itself touches 2+ of the cluster's members
 *   2. subtype families (opts.subtypeClusters) — per process, same rule
 *   3. groups (opts.entityGroups), only when collapseLevel is "groups" — per
 *      process, same rule
 *   4. adjacency — identical (readers, writers, kind) across the whole
 *      diagram, 2+, unless opts.adjacencyStacks is false; stays diagram-wide
 *      by definition, so no per-process threshold applies
 *
 * Sources 1–3 decide per (process, direction): a store joins the group only
 * for a process that itself touches 2+ of that source's members. A process
 * touching just one member of a cluster/family/group that a DIFFERENT
 * process pulled in renders its own edge to a plain copy of that store,
 * marked `duplicated: true` — the same store can be a group member for one
 * process and a plain node for another in the same band. `positionInputs`
 * mirrors buildPerProcessStores: every emitted node id maps to the split
 * store ids whose banded-fallback position the caller averages into place.
 */
function buildConnectedViewGrouping(
  diagram: FlowDiagram,
  storeNums: Map<string, number>,
  storeSplitMap: StoreSplitMap,
  storeReaders: Map<string, Set<string>>,
  storeWriters: Map<string, Set<string>>,
  opts: BuildFlowDataOpts,
): {
  nodes: Extract<FlowElementData, { kind: 'node' }>[];
  edges: Extract<FlowElementData, { kind: 'edge' }>[];
  positionInputs: Map<string, string[]>;
  /** storeId (bare `kind:name`) that still needs a plain node in this
   *  direction — at least one process routes there instead of a group. */
  stillPlain: Record<StackDirection, Set<string>>;
  /** `${processId}|${storeId}` pairs that still need a plain edge in this
   *  direction — the rest are folded into a group's aggregated edge. */
  stillPlainPairs: Record<StackDirection, Set<string>>;
  /** storeId that appears in more than one place (a group and a plain node,
   *  or a plain node for 2+ processes) in this direction. */
  duplicatedStores: Record<StackDirection, Set<string>>;
} {
  const storeInfo = new Map<string, { kind: FlowKindKey; displayName: string }>();
  for (const store of diagram.storeRefs) {
    storeInfo.set(`${store.kind}:${store.name}`, { kind: store.kind, displayName: store.displayName });
  }

  const clusters = opts.clusters ?? [];
  const subtypeClusters = opts.subtypeClusters ?? [];
  const groups = opts.groups ?? {};
  const entityGroups = opts.entityGroups ?? {};
  const procSides = collectProcSides(diagram);

  const nodes: Extract<FlowElementData, { kind: 'node' }>[] = [];
  const edges: Extract<FlowElementData, { kind: 'edge' }>[] = [];
  const positionInputs = new Map<string, string[]>();
  const stillPlain: Record<StackDirection, Set<string>> = { read: new Set(), write: new Set() };
  const stillPlainPairs: Record<StackDirection, Set<string>> = { read: new Set(), write: new Set() };
  const duplicatedStores: Record<StackDirection, Set<string>> = { read: new Set(), write: new Set() };
  let edgeSeq = 0;

  for (const direction of ['read', 'write'] as const) {
    const sides = procSides.filter(s => s.direction === direction);

    // Per-process leftover pool — steps 1–3 read and shrink this per process,
    // not globally, so one process's qualification never consumes a member
    // out from under a process that didn't itself qualify.
    const remainingByProcess = new Map<string, Set<string>>();
    const edgesByStoreProcess = new Map<string, FlowEdge[]>();
    for (const side of sides) {
      remainingByProcess.set(side.processId, new Set(side.memberIds));
      for (const [id, memberEdges] of side.edgesByMember) edgesByStoreProcess.set(`${side.processId}|${id}`, memberEdges);
    }

    const groupList: ConnectedGroup[] = [];

    // 0. Explicit `cluster:` tags — claims the store for every process that
    // touches it, whatever the count.
    const bySlug = new Map<string, { label: string; contributions: Map<string, string[]> }>();
    for (const side of sides) {
      for (const id of side.memberIds) {
        const tag = side.edgesByMember.get(id)?.find(e => e.cluster)?.cluster;
        if (!tag) continue;
        const entry = bySlug.get(tag.slug) ?? { label: tag.label, contributions: new Map<string, string[]>() };
        const list = entry.contributions.get(side.processId) ?? [];
        list.push(id);
        entry.contributions.set(side.processId, list);
        bySlug.set(tag.slug, entry);
      }
    }
    for (const [slug, { label, contributions }] of bySlug) {
      const memberIds = [...new Set([...contributions.values()].flat())].sort();
      const groupContributions = [...contributions].map(([processId, memberIds]) => ({ processId, memberIds }));
      groupList.push({ id: `cluster:${slug}--${direction}`, kind: 'cluster', label, memberIds, contributions: groupContributions });
      for (const { processId, memberIds: ids } of groupContributions) {
        const set = remainingByProcess.get(processId);
        if (set) for (const id of ids) set.delete(id);
      }
    }

    /** Runs one per-process-threshold step: a process joins a source only
     *  when its own remaining touches include 2+ of that source's members. */
    function qualifyPerProcess(candidatesOf: (remaining: Set<string>) => string[]): GroupContribution[] {
      const contributions: GroupContribution[] = [];
      for (const [processId, remaining] of remainingByProcess) {
        const candidates = candidatesOf(remaining);
        if (candidates.length < STACK_THRESHOLD) continue;
        contributions.push({ processId, memberIds: candidates });
      }
      return contributions;
    }

    // 1. Author clusters — merges into an already explicit-tagged cluster
    // node with no threshold; else per-process 2+ members forms a new one.
    for (const C of clusters) {
      const groupId = `cluster:${C.slug}--${direction}`;
      const existing = groupList.find(g => g.id === groupId);
      const contributions = qualifyPerProcess(remaining => [...remaining].filter(id => C.entities.includes(bareEntityName(id))));
      if (contributions.length === 0) continue;
      const qualified = [...new Set(contributions.flatMap(c => c.memberIds))].sort();
      if (existing) {
        existing.memberIds = [...new Set([...existing.memberIds, ...qualified])].sort();
        existing.contributions.push(...contributions);
      } else {
        groupList.push({ id: groupId, kind: 'cluster', label: C.label, memberIds: qualified, contributions });
      }
      for (const { processId, memberIds: ids } of contributions) {
        const set = remainingByProcess.get(processId)!;
        for (const id of ids) set.delete(id);
      }
    }

    // 2. Subtype families — per process, 2+ touched family members.
    for (const SC of subtypeClusters) {
      const family = new Set([SC.basetype, ...SC.members]);
      const contributions = qualifyPerProcess(remaining => [...remaining].filter(id => family.has(bareEntityName(id))));
      if (contributions.length === 0) continue;
      const qualified = [...new Set(contributions.flatMap(c => c.memberIds))].sort();
      const hasBasetype = qualified.some(id => bareEntityName(id) === SC.basetype);
      groupList.push({
        id: `subtype:${SC.basetype}--${direction}`,
        kind: 'subtype',
        label: hasBasetype ? SC.basetype : `${SC.basetype} subtypes`,
        memberIds: qualified,
        contributions,
      });
      for (const { processId, memberIds: ids } of contributions) {
        const set = remainingByProcess.get(processId)!;
        for (const id of ids) set.delete(id);
      }
    }

    // 3. Groups — only at the "groups" collapse level, per process, 2+
    // touched members sharing a group.
    if (opts.collapseLevel === 'groups') {
      const candidateGroupNames = new Set<string>();
      for (const remaining of remainingByProcess.values()) {
        for (const id of remaining) {
          const g = entityGroups[bareEntityName(id)];
          if (g) candidateGroupNames.add(g);
        }
      }
      for (const g of candidateGroupNames) {
        const contributions = qualifyPerProcess(remaining => [...remaining].filter(id => entityGroups[bareEntityName(id)] === g));
        if (contributions.length === 0) continue;
        const qualified = [...new Set(contributions.flatMap(c => c.memberIds))].sort();
        groupList.push({ id: `group:${g}--${direction}`, kind: 'group', label: groups[g]?.label ?? g, memberIds: qualified, contributions });
        for (const { processId, memberIds: ids } of contributions) {
          const set = remainingByProcess.get(processId)!;
          for (const id of ids) set.delete(id);
        }
      }
    }

    // 4. Adjacency — diagram-wide signature equality among stores no process
    // has claimed yet; stays diagram-wide by definition, so every process
    // still touching a member joins, no 2-per-process threshold.
    if (opts.adjacencyStacks !== false) {
      const claimedAnywhere = new Set(groupList.flatMap(g => g.memberIds));
      const eligible = new Set<string>();
      for (const remaining of remainingByProcess.values()) {
        for (const id of remaining) if (!claimedAnywhere.has(id)) eligible.add(id);
      }
      const bySig = new Map<string, string[]>();
      for (const id of eligible) {
        const kind = storeInfo.get(id)?.kind ?? 'db';
        const readers = [...(storeReaders.get(id) ?? [])].sort().join(',');
        const writers = [...(storeWriters.get(id) ?? [])].sort().join(',');
        const sig = `${kind}|${readers}|${writers}`;
        const list = bySig.get(sig) ?? [];
        list.push(id);
        bySig.set(sig, list);
      }
      for (const ids of bySig.values()) {
        if (ids.length < 2) continue;
        const contributions: GroupContribution[] = [];
        for (const [processId, remaining] of remainingByProcess) {
          const touched = ids.filter(id => remaining.has(id));
          if (touched.length > 0) contributions.push({ processId, memberIds: touched });
        }
        groupList.push({ id: stackIdFor(ids, direction), kind: 'adjacency', label: `${ids.length} stores`, memberIds: [...ids].sort(), contributions });
        for (const { processId, memberIds: touchedIds } of contributions) {
          const set = remainingByProcess.get(processId)!;
          for (const id of touchedIds) set.delete(id);
        }
      }
    }

    // Everywhere a store ends up in this band — a group's member list, or a
    // plain touch some process still owns — decides the duplicate marker.
    const placesByStore = new Map<string, Set<string>>();
    const addPlace = (storeId: string, place: string) => {
      const set = placesByStore.get(storeId) ?? new Set<string>();
      set.add(place);
      placesByStore.set(storeId, set);
    };
    for (const g of groupList) for (const id of g.memberIds) addPlace(id, g.id);
    for (const [processId, remaining] of remainingByProcess) {
      for (const id of remaining) {
        addPlace(id, `plain:${processId}`);
        stillPlain[direction].add(id);
        stillPlainPairs[direction].add(`${processId}|${id}`);
      }
    }
    for (const [storeId, places] of placesByStore) {
      if (places.size > 1) duplicatedStores[direction].add(storeId);
    }

    for (const g of groupList) {
      const members: StackMember[] = g.memberIds.map(id => {
        const meta = storeInfo.get(id)!;
        return { storeId: id, kind: meta.kind, displayName: meta.displayName, storeNum: storeNums.get(id) ?? 0, duplicated: duplicatedStores[direction].has(id) };
      });

      const edgesForMember = (id: string): FlowEdge[] =>
        g.contributions.filter(c => c.memberIds.includes(id)).flatMap(c => edgesByStoreProcess.get(`${c.processId}|${id}`) ?? []);
      const rowMembers: RowMember[] = members.map(m => ({
        storeId: m.storeId,
        displayName: m.displayName,
        storeNum: m.storeNum,
        clusterTag: edgesForMember(m.storeId).find(e => e.cluster)?.cluster,
      }));

      nodes.push({
        kind: 'node',
        id: g.id,
        nodeType: 'stack',
        label: g.label,
        direction,
        members,
        rows: buildStackRows(rowMembers, opts.collapseLevel, clusters, subtypeClusters, groups, entityGroups),
        source: g.kind,
        ...(g.kind === 'adjacency'
          ? {
              adjacencyReaders: [...new Set(g.memberIds.flatMap(id => [...(storeReaders.get(id) ?? [])]))].sort(),
              adjacencyWriters: [...new Set(g.memberIds.flatMap(id => [...(storeWriters.get(id) ?? [])]))].sort(),
            }
          : {}),
      });

      positionInputs.set(
        g.id,
        g.memberIds.map(id => {
          const split = storeSplitMap.get(id)!;
          return direction === 'read' ? split.readId : split.writeId;
        }),
      );

      // One aggregated edge per process that qualified for this group.
      for (const { processId, memberIds: touchedHere } of g.contributions) {
        const procNodeId = `proc:${processId}`;
        const memberEdges = touchedHere.flatMap(id => edgesByStoreProcess.get(`${processId}|${id}`) ?? []);
        const memberSubset = members.filter(m => touchedHere.includes(m.storeId));
        const { label, hasAuthoredLabel, chipLines } = resolveStackEdgeLabel(memberEdges, memberSubset);
        edges.push({
          kind: 'edge',
          id: `connected-edge:${processId}:${direction}:${edgeSeq++}`,
          source: direction === 'read' ? g.id : procNodeId,
          target: direction === 'read' ? procNodeId : g.id,
          label,
          hasAuthoredLabel,
          dataLines: memberEdges.flatMap(e => normalizeEdgeData(e.data)),
          memberEdges,
          chipLines,
        });
      }
    }
  }

  return { nodes, edges, positionInputs, stillPlain, stillPlainPairs, duplicatedStores };
}

// ── Element builder ──────────────────────────────────────────────────────────

/**
 * buildFlowData — produce the full render data for one FlowDiagram.
 *
 * Builds nodes + edges, computes the ext split map, store numbers, and runs
 * computeFlowLayout. Returns everything the SVG renderer needs in one call.
 *
 * `opts` is optional; omitting it (or `opts.view`) keeps today's per-store
 * output byte-for-byte. Passing `{ view: 'per-process' }` groups each
 * process's reads and writes into stacks (see buildPerProcessStores);
 * `{ view: 'connected' }` groups the per-store model by cluster tag, author
 * cluster, subtype family, group, then adjacency (see
 * buildConnectedViewGrouping). Both views apply `opts.collapseLevel` to
 * every stack's dialog rows (see buildStackRows).
 */
export function buildFlowData(diagram: FlowDiagram, opts?: BuildFlowDataOpts): FlowRenderData {
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

  let positionInputs: Map<string, string[]> | undefined;

  if (opts?.view === 'per-process') {
    const stacked = buildPerProcessStores(diagram, storeNums, storeSplitMap, opts);
    nodes.push(...stacked.nodes);
    edges.push(...stacked.edges);
    positionInputs = stacked.positionInputs;

    // Externals are unaffected by the view: draw the same source/sink copies
    // and edges buildExternalRouting always draws, unaggregated by store.
    edges.push(...renderExtEdges(diagram, extRouting, storeSplitMap));
  } else if (opts?.view === 'connected') {
    const connected = buildConnectedViewGrouping(diagram, storeNums, storeSplitMap, storeReaders, storeWriters, opts);
    nodes.push(...connected.nodes);
    edges.push(...connected.edges);
    positionInputs = connected.positionInputs;

    // Plain stores + their edges: today's per-store rendering, minus every
    // (process, store) pair a group's aggregated edge already covers. A
    // store can still need a plain copy in one direction even though some
    // OTHER process pulled it into a group — buildConnectedViewGrouping's
    // stillPlain/stillPlainPairs say exactly which.
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
        storeNums.set(split.readId, num);
        storeNums.set(split.writeId, num);
        if (connected.stillPlain.read.has(storeId)) {
          nodes.push({ ...base, id: split.readId, duplicated: true });
          positionInputs.set(split.readId, [split.readId]);
        }
        if (connected.stillPlain.write.has(storeId)) {
          nodes.push({ ...base, id: split.writeId, duplicated: true });
          positionInputs.set(split.writeId, [split.writeId]);
        }
      } else if (connected.stillPlain.read.has(storeId) || connected.stillPlain.write.has(storeId)) {
        const duplicated = connected.duplicatedStores.read.has(storeId) || connected.duplicatedStores.write.has(storeId);
        nodes.push(duplicated ? { ...base, id: storeId, duplicated: true } : { ...base, id: storeId });
        positionInputs.set(storeId, [storeId]);
      }
    }

    for (let i = 0; i < diagram.edges.length; i++) {
      const edge = diagram.edges[i]!;
      if (edge.from.kind === 'ext' || edge.to.kind === 'ext') continue;
      const isRead = STORE_KINDS[edge.from.kind];
      const direction: StackDirection = isRead ? 'read' : 'write';
      const storeBareId = isRead ? `${edge.from.kind}:${edge.from.name}` : `${edge.to.kind}:${edge.to.name}`;
      const processId = isRead ? edge.to.name : edge.from.name;
      if (!connected.stillPlainPairs[direction].has(`${processId}|${storeBareId}`)) continue; // folded into a group edge

      const { source, target } = resolveEdgeEndpoints(edge, extRouting, storeSplitMap);
      const previewLabel = Array.isArray(edge.data) ? edge.data.join(', ') : (edge.data ?? '');
      edges.push({
        kind: 'edge',
        id: `flow-edge-${i}`,
        source,
        target,
        label: edge.label ?? previewLabel,
        hasAuthoredLabel: edge.label !== undefined,
        dataLines: normalizeEdgeData(edge.data),
      });
    }

    edges.push(...renderExtEdges(diagram, extRouting, storeSplitMap));
  } else {
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
      const { source, target } = resolveEdgeEndpoints(edge, extRouting, storeSplitMap);

      const previewLabel = Array.isArray(edge.data) ? edge.data.join(', ') : (edge.data ?? '');
      const label = edge.label ?? previewLabel;
      const dataLines = normalizeEdgeData(edge.data);
      // Read vs write is not encoded on the edge: it is conveyed at render time by
      // arrow direction (store→process reads, process→store writes), per canonical
      // SSADM/Gane-Sarson notation. No line-style distinction.
      edges.push({
        kind: 'edge',
        id: `flow-edge-${i}`,
        source,
        target,
        label,
        hasAuthoredLabel: edge.label !== undefined,
        dataLines,
      });
    }
  }

  let positions: Map<string, NodePos>;
  if (positionInputs) {
    // Per-process view: derive each stack/plain node's position by averaging
    // the positions computeFlowLayout would assign the stores it aggregates —
    // reuses the banded fallback layout unchanged rather than teaching it
    // about stack participation.
    const fullStoreIds = new Set<string>();
    for (const store of diagram.storeRefs) {
      const storeId = `${store.kind}:${store.name}`;
      const split = storeSplitMap.get(storeId)!;
      if (split.isSplit) { fullStoreIds.add(split.readId); fullStoreIds.add(split.writeId); }
      else fullStoreIds.add(storeId);
    }
    const procExtIds = nodes.filter(n => n.nodeType === 'process' || n.nodeType === 'external').map(n => n.id);
    const fullNodeIds = new Set<string>([...procExtIds, ...fullStoreIds]);
    const fullPositions = computeFlowLayout(diagram, extRouting, storeSplitMap, procX, fullNodeIds);

    positions = new Map();
    for (const id of procExtIds) positions.set(id, fullPositions.get(id) ?? { x: 0, y: 0 });
    for (const [nodeId, memberSplitIds] of positionInputs) {
      const pts = memberSplitIds.map(id => fullPositions.get(id)).filter((p): p is NodePos => p !== undefined);
      positions.set(
        nodeId,
        pts.length === 0
          ? { x: 0, y: 0 }
          : { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length },
      );
    }
  } else {
    // Build the set of all node ids for computeFlowLayout.
    const allNodeIds = new Set<string>(nodes.map(n => n.id));
    positions = computeFlowLayout(diagram, extRouting, storeSplitMap, procX, allNodeIds);
  }

  return { nodes, edges, positions };
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
