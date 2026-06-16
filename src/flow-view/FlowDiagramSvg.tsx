/**
 * FlowDiagramSvg.tsx — custom SVG renderer for a single FlowDiagram.
 *
 * Matches the approved mock-e.html design exactly:
 *   - process  = blue numbered rounded-rect hub with optional ⤵ affordance
 *   - external = green rectangle
 *   - store    = open-ended rectangle (left cap-bar + D# + name, right edge open)
 *   - edges    = orthogonal paths (vertical trunks + right-angle elbows)
 *               solid grey for writes (proc→store, ext→proc, proc→ext)
 *               dashed amber for reads (store→proc only)
 *   - labels   = small dark rounded-chip on each edge, placed near destination node
 *
 * Layout coordinates come from buildFlowData (flow-layout.ts). The SVG viewBox
 * is computed from the bounding box of all node positions.
 *
 * Interactions:
 *   - Pan:  pointer-down on the SVG background + drag → translate the viewport
 *   - Zoom: wheel on the SVG → zoom toward the cursor (clamped to MIN/MAX_SCALE)
 *   - Drag: pointer-down on a node → drag to reposition; edges re-route live.
 *           A move < DRAG_THRESHOLD pixels is treated as a click (fires onDrill).
 *   - Persistence: on pointer-up after a node drag, saves all positions via
 *     the LayoutStoreHandle (if layoutKey and onPositionsChange are provided).
 *
 * Props:
 *   diagram          — the FlowDiagram to render
 *   onDrill          — called with processId when user clicks a drillable process
 *   onReady          — called once after first render
 *   savedPositions   — pre-loaded position map; overrides banded layout when present
 *   layoutKey        — fingerprint for this diagram; used for persistence save
 *   onPositionsChange — called with the new full position map after a drag ends
 *   onViewChange     — called with minimap data whenever pan/zoom/positions change
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { buildFlowData } from './flow-layout';
import { isInlineLabel } from './elk-flow-layout';
import type { FlowDiagram } from '../flows/flow-parse';
import type { NodePos, FlowElementData } from './flow-layout';
import type { PositionMap } from '../app/views/graph/layout-store';
import type { FlowKindEntry, FlowKindKey } from '../theme/theme-defaults';

// ── Visual palettes — theme-aware ─────────────────────────────────────────────

/** All color roles used by the flow SVG renderer. */
export type FlowPalette = {
  canvas: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  procFill: string;
  procBorder: string;
  procText: string;
  /** Fill for the stacked-card elevation shadow drawn under drillable processes. */
  procElevation: string;
  extFill: string;
  extBorder: string;
  extText: string;
  storeFill: string;
  storeBorder: string;
  storeText: string;
  edge: string;
  chipBg: string;
};

export const DARK_PALETTE: FlowPalette = {
  canvas: '#0e1116',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#8b949e',
  accent: '#58a6ff',

  procFill: '#0d419d',
  procBorder: '#58a6ff',
  procText: '#cfe2ff',
  procElevation: '#0a2d6b',

  extFill: '#1a3a1a',
  extBorder: '#3fb950',
  extText: '#b7f0c4',

  storeFill: '#3d2e00',
  storeBorder: '#d29922',
  storeText: '#f2d49b',

  edge: '#8b949e',
  chipBg: '#161b22',
};

export const LIGHT_PALETTE: FlowPalette = {
  canvas: '#f6f8fa',
  border: '#d0d7de',
  text: '#1f2328',
  muted: '#57606a',
  accent: '#0969da',

  procFill: '#dbeafe',
  procBorder: '#2563eb',
  procText: '#1e3a8a',
  procElevation: '#93c5fd',

  extFill: '#dcfce7',
  extBorder: '#16a34a',
  extText: '#14532d',

  storeFill: '#fef9c3',
  storeBorder: '#ca8a04',
  storeText: '#713f12',

  edge: '#57606a',
  chipBg: '#eaeef2',
};

// Bright highlight for the line being dragged. Themeable: override the CSS
// custom property `--flow-edge-highlight` to recolour it.
const EDGE_HIGHLIGHT = 'var(--flow-edge-highlight, #f0883e)';
// Opacity applied to everything outside the hovered element's connected set.
const DIM_OPACITY = 0.3;

// Node geometry constants
const PROC_W = 120;
const PROC_H = 68;
const PROC_RX = 10;
const BADGE_R = 10;

const EXT_W = 120;
const EXT_H = 50;
const EXT_RX = 5;

const STORE_H = 34;
const STORE_CAP_W = 34;
const STORE_BODY_W = 136; // minimum body width; expands for long names
const STORE_INFO_PAD = 22; // right-side slot reserved for the ⓘ doc badge

const EDGE_SW = 1.6;
// How far short of the node boundary to stop the path, so the arrowhead
// (markerUnits=userSpaceOnUse, refX=7.5) sits flush against the node edge.
const ARROW_MARGIN = 8;
// Distance outside the target boundary where the horizontal channel sits, so the
// edge's final segment is always a vertical stub into the node (arrow points in).
// Must exceed ARROW_MARGIN so that stub has length and direction.
const EDGE_APPROACH = 26;

const CHIP_RX = 4;
const CHIP_FONT = 10.5;
const CHIP_LINE_H = 13;  // vertical pitch per data line in a multi-line chip
const CHIP_PAD_Y = 4;    // top/bottom padding inside a chip
const CHIP_MAX_CHARS = 22; // truncate a single long data line to keep chips compact

const PADDING = 80; // canvas padding around content

// Interaction constants
const MIN_SCALE = 0.2;
const MAX_SCALE = 4.0;
// Pointer move < this viewBox-unit threshold on pointerdown → treated as click, not drag
const DRAG_THRESHOLD_VB = 4;

// ── Minimap data ──────────────────────────────────────────────────────────────

export type MinimapData = {
  /** Bounding box of all nodes in world space */
  worldBounds: { x: number; y: number; w: number; h: number };
  /** All node positions (world coords) and their dimensions */
  nodeBoxes: Array<{ x: number; y: number; w: number; h: number; type: string }>;
  /** Current viewport: pan offset (world coords top-left) and scale */
  viewport: { tx: number; ty: number; scale: number; svgW: number; svgH: number };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function measureText(text: string, fontSize: number): number {
  // Approximation: ~0.55 × font-size per character for system-ui
  return text.length * fontSize * 0.55 + 12;
}

function truncateLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  return label.slice(0, maxChars - 1) + '…';
}

function storeWidth(name: string): number {
  // Reserve a right-side slot for the ⓘ badge so it never overlaps the name.
  const bodyW = Math.max(STORE_BODY_W, measureText(name, 11.5) + STORE_INFO_PAD);
  return STORE_CAP_W + bodyW;
}

/**
 * Split a label into at most 2 lines for the process box.
 * Keeps the last word(s) together on line 2 if the label has 3+ words.
 */
function splitProcessLabel(label: string): [string, string | undefined] {
  const words = label.split(' ');
  if (words.length <= 2) return [words[0] ?? label, words[1]];
  // 3+ words: put first word on line 1, rest on line 2
  return [words[0] ?? label, words.slice(1).join(' ')];
}

/** Bounds of a node — used for edge attachment point calculation. */
function nodeBounds(pos: NodePos, nodeType: string, storeName?: string): {
  x: number; y: number; w: number; h: number; cx: number; cy: number;
} {
  if (nodeType === 'process') {
    const w = PROC_W; const h = PROC_H;
    return { x: pos.x - w / 2, y: pos.y - h / 2, w, h, cx: pos.x, cy: pos.y };
  }
  if (nodeType === 'external') {
    const w = EXT_W; const h = EXT_H;
    return { x: pos.x - w / 2, y: pos.y - h / 2, w, h, cx: pos.x, cy: pos.y };
  }
  // store — center x is at middle of entire store width
  const sw = storeWidth(storeName ?? '');
  return { x: pos.x - sw / 2, y: pos.y - STORE_H / 2, w: sw, h: STORE_H, cx: pos.x, cy: pos.y };
}

type FlowNode = Extract<FlowElementData, { kind: 'node' }>;
type FlowEdge = Extract<FlowElementData, { kind: 'edge' }>;

/** Per-edge horizontal attachment points after fan-out (world x). */
type EdgeAnchors = { fromX: number; toX: number };

/** Spacing (world px) between adjacent fan-out anchors on one node side. */
const FANOUT_GAP = 5;

/**
 * Which side (top/bottom) of a node an edge endpoint attaches to.
 *
 * Processes follow the read/output rule: an edge *into* a process (the process
 * is the edge target, `role === 'to'`) is a read and docks at the TOP; an edge
 * *out of* a process (`role === 'from'`) is an output and docks at the BOTTOM —
 * regardless of where the other node sits. Stores and externals have no such
 * rule, so they attach on whichever side faces the other endpoint.
 */
function endpointSide(
  nodeType: string, role: 'from' | 'to', selfY: number, otherY: number,
): 'top' | 'bottom' {
  if (nodeType === 'process') {
    return role === 'to' ? 'top' : 'bottom';
  }
  return selfY <= otherY ? 'bottom' : 'top';
}

/**
 * Fan-out edge anchors. By default every edge would attach to its node's
 * center-x (top or bottom), so all edges touching one node stack on a single
 * point and become impossible to trace. Instead, for each node *side* (top or
 * bottom) we spread the attachment x-positions of its edges evenly across that
 * side. Within a side the edges are ordered by the x of their opposite endpoint
 * so the fan-out doesn't cross itself. A side with one edge keeps the center.
 *
 * Recomputed each render against live `positions`, so anchors re-balance as
 * nodes are dragged.
 */
function computeEdgeAnchors(
  edges: FlowEdge[],
  nodeById: Map<string, FlowNode>,
  positions: Map<string, NodePos>,
): Map<string, EdgeAnchors> {
  type Slot = { edgeId: string; role: 'from' | 'to'; otherX: number };
  const groups = new Map<string, Slot[]>();
  const pushSlot = (key: string, slot: Slot) => {
    const list = groups.get(key);
    if (list) list.push(slot);
    else groups.set(key, [slot]);
  };

  // Group edges by the node side they attach to (same side rule as the router),
  // so a process's reads fan out across its top edge and its outputs across the
  // bottom edge.
  for (const edge of edges) {
    const fromPos = positions.get(edge.source);
    const toPos = positions.get(edge.target);
    const fromNode = nodeById.get(edge.source);
    const toNode = nodeById.get(edge.target);
    if (!fromPos || !toPos || !fromNode || !toNode) continue;
    const fromSide = endpointSide(fromNode.nodeType, 'from', fromPos.y, toPos.y);
    const toSide = endpointSide(toNode.nodeType, 'to', toPos.y, fromPos.y);
    pushSlot(`${edge.source}|${fromSide}`, { edgeId: edge.id, role: 'from', otherX: toPos.x });
    pushSlot(`${edge.target}|${toSide}`, { edgeId: edge.id, role: 'to', otherX: fromPos.x });
  }

  const slotX = new Map<string, number>(); // `${edgeId}|${role}` → world x
  for (const [key, slots] of groups) {
    const nodeId = key.slice(0, key.lastIndexOf('|'));
    const node = nodeById.get(nodeId);
    const pos = positions.get(nodeId);
    if (!node || !pos) continue;
    const storeName = node.nodeType === 'store' ? (node.label ?? node.storeName ?? '') : undefined;
    const { cx } = nodeBounds(pos, node.nodeType, storeName);
    slots.sort((a, b) => a.otherX - b.otherX);
    const k = slots.length;
    const span = FANOUT_GAP * (k - 1);
    slots.forEach((slot, i) => {
      const offset = k === 1 ? 0 : -span / 2 + FANOUT_GAP * i;
      slotX.set(`${slot.edgeId}|${slot.role}`, cx + offset);
    });
  }

  const result = new Map<string, EdgeAnchors>();
  for (const edge of edges) {
    const fromPos = positions.get(edge.source);
    const toPos = positions.get(edge.target);
    if (!fromPos || !toPos) continue;
    result.set(edge.id, {
      fromX: slotX.get(`${edge.id}|from`) ?? fromPos.x,
      toX: slotX.get(`${edge.id}|to`) ?? toPos.x,
    });
  }
  return result;
}

type Box = { x: number; y: number; w: number; h: number };
type Pt = [number, number];

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function pointsToD(pts: Pt[]): string {
  return `M${pts[0]![0]},${pts[0]![1]} ` + pts.slice(1).map(p => `L${p[0]},${p[1]}`).join(' ');
}

/** Closest point to (px,py) on a polyline, used to slide a dragged label along its edge. */
function projectOntoPolyline(pts: Pt[], px: number, py: number): NodePos {
  let best: NodePos = { x: pts[0]![0], y: pts[0]![1] };
  let bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const x = ax + t * dx, y = ay + t * dy;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}

/**
 * Nudge chips vertically so they don't sit on top of node boxes or each other.
 * A chip rides a (near-)vertical part of its edge, so moving it up or down keeps
 * it on its line while clearing obstacles. For each chip we scan outward from its
 * natural y in growing steps and take the nearest slot that's fully clear — this
 * finds the closest gap without the oscillation a greedy "nearer side" pass hits
 * when a chip is sandwiched between two obstacles. Mutates `chip` in place.
 */
function deoverlapChips(
  renders: Array<{ chip: NodePos; lines: string[] }>,
  nodeBoxes: Box[],
): void {
  const STEP = 8;
  const MAX_STEPS = 24; // ±192px of search before giving up
  const placed: Box[] = [];
  for (const r of renders) {
    if (r.lines.length === 0) continue;
    const { w, h } = chipDims(r.lines);
    const baseY = r.chip.y;
    const isClear = (cy: number): boolean => {
      const rect = { x: r.chip.x - w / 2, y: cy - h / 2, w, h };
      return !nodeBoxes.some(o => boxesOverlap(rect, o)) && !placed.some(o => boxesOverlap(rect, o));
    };
    let bestY = baseY;
    outer: for (let k = 0; k <= MAX_STEPS; k++) {
      for (const cy of k === 0 ? [baseY] : [baseY + k * STEP, baseY - k * STEP]) {
        if (isClear(cy)) { bestY = cy; break outer; }
      }
    }
    r.chip = { x: r.chip.x, y: bestY };
    placed.push({ x: r.chip.x - w / 2, y: bestY - h / 2, w, h });
  }
}

/**
 * Y of the edge's horizontal channel. For a normal down-jog (source above the
 * target) it sits at the midpoint, so the run — and the label that rides it —
 * lands halfway between the two nodes, well clear of the arrowheads. Only when a
 * read has to route up and over (source below the target) does the channel sit
 * just outside the target instead, so the path still ends in a clean stub.
 */
function edgeChannelY(fy: number, toSide: 'top' | 'bottom', toBoundary: number): number {
  const goingDown = fy <= toBoundary;
  if (goingDown) return (fy + toBoundary) / 2;
  return toSide === 'top' ? toBoundary - EDGE_APPROACH : toBoundary + EDGE_APPROACH;
}

/**
 * Compute an orthogonal edge path between two nodes. `fromX`/`toX` are the
 * fan-out attachment points; the attach *sides* follow the read/output rule
 * (see endpointSide). Plain orthogonal trunk — it passes behind any node in the
 * way, which reads fine because lines render under the nodes. Returns an SVG
 * path `d` string.
 */
function orthogonalPath(
  fromPos: NodePos, fromType: string, fromStoreName: string | undefined,
  toPos: NodePos, toType: string, toStoreName: string | undefined,
  fromX: number, toX: number,
): Pt[] {
  const fb = nodeBounds(fromPos, fromType, fromStoreName);
  const tb = nodeBounds(toPos, toType, toStoreName);

  const fromSide = endpointSide(fromType, 'from', fromPos.y, toPos.y);
  const toSide = endpointSide(toType, 'to', toPos.y, fromPos.y);

  const fy = fromSide === 'bottom' ? fb.y + fb.h : fb.y;
  const toBoundary = toSide === 'top' ? tb.y : tb.y + tb.h;
  const ty = toSide === 'top' ? toBoundary - ARROW_MARGIN : toBoundary + ARROW_MARGIN;
  const channelY = edgeChannelY(fy, toSide, toBoundary);

  if (Math.abs(fromX - toX) < 2) {
    return [[fromX, fy], [fromX, ty]];
  }
  return [[fromX, fy], [fromX, channelY], [toX, channelY], [toX, ty]];
}

/**
 * Pick a point along an orthogonal path for the data-label chip. The chip sits
 * on the horizontal channel (mid-line, off the arrows), biased to the
 * store/external end's x — those nodes are spread out, so chips don't pile up
 * the way they would at a process that carries many edges.
 */
function chipAnchor(
  fromPos: NodePos, fromType: string, fromStoreName: string | undefined,
  toPos: NodePos, toType: string, toStoreName: string | undefined,
  fromX: number, toX: number,
): NodePos {
  const fb = nodeBounds(fromPos, fromType, fromStoreName);
  const tb = nodeBounds(toPos, toType, toStoreName);
  const fromSide = endpointSide(fromType, 'from', fromPos.y, toPos.y);
  const toSide = endpointSide(toType, 'to', toPos.y, fromPos.y);
  const fy = fromSide === 'bottom' ? fb.y + fb.h : fb.y;
  const toBoundary = toSide === 'top' ? tb.y : tb.y + tb.h;
  const channelY = edgeChannelY(fy, toSide, toBoundary);

  let chipX: number;
  if (Math.abs(fromX - toX) < 2) {
    chipX = fromX;
  } else if (fromType !== 'process') {
    chipX = fromX; // store/external source (a read) — bias to the source end
  } else if (toType !== 'process') {
    chipX = toX; // store/external target (a write) — bias to the target end
  } else {
    chipX = (fromX + toX) / 2; // process → process
  }

  return { x: chipX, y: channelY };
}

// ── Sub-components ───────────────────────────────────────────────────────────

// Radius of the ⓘ "open docs" badge drawn on every node.
const INFO_R = 7;

/**
 * A small ⓘ badge that opens the node's documentation dialog. Its pointerdown
 * stops propagation so it never starts a node drag or a sub-DFD drill — the
 * badge is a dedicated affordance, separate from the node body's click.
 *
 * Drawn as the Unicode ⓘ glyph (U+24D8), matching the app's icon convention
 * (the FAB / theme / nav chrome are all single glyphs — no icon library). A
 * dark backing disc keeps the glyph legible on the saturated process / external
 * fills, the same way the process number badge backs its text.
 */
function InfoBadge({ cx, cy, color, c, onOpen }: {
  cx: number; cy: number; color: string; c: FlowPalette; onOpen?: () => void;
}) {
  if (!onOpen) return null;
  return (
    <g
      data-ignatius="flow-info"
      style={{ cursor: 'pointer' }}
      onPointerDown={e => { e.stopPropagation(); e.preventDefault(); onOpen(); }}
    >
      {/* Generous transparent hit target around the glyph. */}
      <circle cx={cx} cy={cy} r={INFO_R + 4} fill="transparent" />
      {/* Backing disc for contrast against any node fill. */}
      <circle cx={cx} cy={cy} r={INFO_R - 0.5} fill={c.canvas} />
      <text
        x={cx} y={cy + 5.6} fill={color}
        fontSize={16.5} textAnchor="middle"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >{'ⓘ'}</text>
    </g>
  );
}

function ProcessNode({
  id, label, pos, num, hasSubDfd, c, onOpenDoc,
}: {
  id: string; label: string; pos: NodePos; num: string;
  hasSubDfd: boolean; c: FlowPalette; onOpenDoc?: () => void;
}) {
  const x = pos.x - PROC_W / 2;
  const y = pos.y - PROC_H / 2;

  const badgeCx = x + BADGE_R + 10;
  const badgeCy = y + BADGE_R + 10;

  const textAreaX = badgeCx + BADGE_R + 4;
  const textAreaW = (x + PROC_W) - textAreaX;
  const textCenterX = textAreaX + textAreaW / 2;

  const [line1, line2] = splitProcessLabel(label);
  const lineH = 15;
  const totalTextH = line2 ? lineH * 2 : lineH;
  const textStartY = pos.y - totalTextH / 2 + lineH / 2;

  return (
    <g
      data-node-type="process"
      data-node-id={id}
      data-has-sub-dfd={hasSubDfd ? 'true' : undefined}
      style={{ cursor: hasSubDfd ? 'pointer' : 'move' }}
    >
      {/* Stacked-card elevation: two offset rects behind the main shape signal
          drill-down. Rendered before the main rect so they sit under it. The
          offsets are purely decorative — nodeBounds() still uses the unshifted
          PROC_W/PROC_H, so edge anchoring is unaffected (CP6 invariant). */}
      {hasSubDfd && (
        <>
          <rect
            x={x + 8} y={y + 8} width={PROC_W} height={PROC_H} rx={PROC_RX}
            fill={c.procElevation} stroke={c.procBorder} strokeWidth={1}
            opacity={0.6}
          />
          <rect
            x={x + 4} y={y + 4} width={PROC_W} height={PROC_H} rx={PROC_RX}
            fill={c.procElevation} stroke={c.procBorder} strokeWidth={1.2}
            opacity={0.8}
          />
        </>
      )}
      <rect
        x={x} y={y} width={PROC_W} height={PROC_H} rx={PROC_RX}
        fill={c.procFill} stroke={c.procBorder} strokeWidth={1.6}
      />
      <circle cx={badgeCx} cy={badgeCy} r={BADGE_R} fill={c.canvas} stroke={c.procBorder} strokeWidth={1.3} />
      <text x={badgeCx} y={badgeCy + 4} fill={c.procText} fontSize={11} fontWeight={700} textAnchor="middle">{num}</text>
      <text
        x={textCenterX}
        y={textStartY}
        fill={c.procText}
        fontSize={11.5}
        fontWeight={600}
        textAnchor="middle"
      >
        {line1}
      </text>
      {line2 && (
        <text
          x={textCenterX}
          y={textStartY + lineH}
          fill={c.procText}
          fontSize={11.5}
          fontWeight={600}
          textAnchor="middle"
        >
          {line2}
        </text>
      )}
      {hasSubDfd && (
        <text x={x + PROC_W - 10} y={y + PROC_H - 6} fill={c.procBorder} fontSize={12} textAnchor="middle">⤵</text>
      )}
      <InfoBadge cx={x + PROC_W - INFO_R - 5} cy={y + INFO_R + 5} color={c.procBorder} c={c} onOpen={onOpenDoc} />
    </g>
  );
}

function ExternalNode({ label, pos, c, kindColors, onOpenDoc }: {
  label: string; pos: NodePos; c: FlowPalette;
  /** When the external carries a `kind:`, override its fill/border/text. Absent → conventional green. */
  kindColors?: FlowKindEntry;
  onOpenDoc?: () => void;
}) {
  const x = pos.x - EXT_W / 2;
  const y = pos.y - EXT_H / 2;
  const fill = kindColors ? kindColors.bg : c.extFill;
  const stroke = kindColors ? kindColors.border : c.extBorder;
  const textFill = kindColors ? kindColors.fg : c.extText;

  return (
    <g data-node-type="external" style={{ cursor: 'move' }}>
      <rect x={x} y={y} width={EXT_W} height={EXT_H} rx={EXT_RX}
        fill={fill} stroke={stroke} strokeWidth={1.4} />
      <text x={pos.x} y={pos.y + 4} fill={textFill} fontSize={12.5} fontWeight={600} textAnchor="middle">
        {label}
      </text>
      <InfoBadge cx={x + EXT_W - INFO_R - 5} cy={y + INFO_R + 5} color={stroke} c={c} onOpen={onOpenDoc} />
    </g>
  );
}

function StoreNode({
  storeNum, storeName, pos, duplicated, c, kindColors, onOpenDoc,
}: {
  storeNum: number; storeName: string; pos: NodePos; duplicated: boolean; c: FlowPalette;
  /** When set, overrides the store's fill/border/text with kind-specific colors. */
  kindColors?: FlowKindEntry;
  onOpenDoc?: () => void;
}) {
  const sw = storeWidth(storeName);
  const x = pos.x - sw / 2;
  const y = pos.y - STORE_H / 2;
  const bodyX = x + STORE_CAP_W;
  const bodyW = sw - STORE_CAP_W;
  const dLabel = `D${storeNum}`;
  const strokeW = 1.4;
  const rightX = x + sw;
  const fill = kindColors ? kindColors.bg : c.storeFill;
  const stroke = kindColors ? kindColors.border : c.storeBorder;
  const textFill = kindColors ? kindColors.fg : c.storeText;

  return (
    <g data-node-type="store" style={{ cursor: 'move' }}>
      <rect x={bodyX} y={y} width={bodyW} height={STORE_H} fill={fill} />
      <rect x={x} y={y} width={STORE_CAP_W} height={STORE_H}
        fill={fill} stroke={stroke} strokeWidth={strokeW} />
      <path
        d={`M${x},${y} H${rightX} M${x},${y} V${y + STORE_H} H${rightX}`}
        fill="none" stroke={stroke} strokeWidth={strokeW}
      />
      {/* Duplicate-store marker: a thicker left border (canonical DFD notation
          for a store drawn more than once) painted in the border colour, so it
          reads as a doubled edge rather than carving a sub-cell — the D# cap
          keeps the same fixed width as a single store's. Inset to the border's
          *outer* edge (strokeW/2 beyond the box) so it bleeds like the border. */}
      {duplicated && (
        <rect
          x={x - strokeW / 2} y={y - strokeW / 2}
          width={3 + strokeW / 2} height={STORE_H + strokeW}
          fill={stroke}
        />
      )}
      <line x1={bodyX} y1={y} x2={bodyX} y2={y + STORE_H} stroke={stroke} strokeWidth={strokeW} />
      <text
        x={x + STORE_CAP_W / 2} y={y + STORE_H / 2 + 4}
        fill={textFill} fontSize={11} fontWeight={700} textAnchor="middle"
      >
        {dLabel}
      </text>
      <text
        x={bodyX + 6} y={y + STORE_H / 2 + 4}
        fill={textFill} fontSize={11.5} textAnchor="start"
      >
        {storeName}
      </text>
      {/* Badge sits inside the body at the right edge (a slot reserved by
          STORE_INFO_PAD), vertically centred — on the store's own fill so the
          click always lands, and visibly part of the container. */}
      <InfoBadge cx={rightX - INFO_R - 4} cy={pos.y} color={stroke} c={c} onOpen={onOpenDoc} />
    </g>
  );
}

// All data flows render identically (solid arrow). Read vs write is conveyed by
// arrow direction — store→process is a read, process→store a write — per
// canonical SSADM/Gane-Sarson notation, not by line style or colour. Paths and
// chips render as two separate layers (all paths under the nodes, all chips
// above everything) so a line never draws over another edge's label.

function EdgePath({
  d, label, hasHiddenLabel, opacity, highlighted, c, onHoverChange,
}: {
  d: string;
  label: string;
  /** When true, the label is too long for an inline chip — it is on-demand only. */
  hasHiddenLabel: boolean;
  opacity: number;
  highlighted: boolean;
  c: FlowPalette;
  onHoverChange: (entering: boolean, clientX?: number, clientY?: number) => void;
}) {
  return (
    <g
      opacity={opacity}
      style={{ transition: 'opacity 0.12s' }}
      onPointerEnter={e => onHoverChange(true, e.clientX, e.clientY)}
      onPointerLeave={() => onHoverChange(false)}
      onPointerMove={e => onHoverChange(true, e.clientX, e.clientY)}
      // data-contract is present on ALL labelled edges so the contract text is
      // reachable via the DOM for on-demand hover/click disclosure.
      data-contract={label || undefined}
      data-contract-type={hasHiddenLabel ? 'hidden' : 'inline'}
    >
      {/* Background-coloured casing drawn under the line. Edge groups render in
          order, so where a later edge crosses an earlier one this halo masks the
          line beneath — giving an over/under read at crossings. ~3px each side. */}
      <path
        d={d} fill="none"
        stroke={c.canvas}
        strokeWidth={(highlighted ? EDGE_SW + 1 : EDGE_SW) + 6}
        strokeLinecap="round"
      />
      <path
        d={d} fill="none"
        stroke={highlighted ? EDGE_HIGHLIGHT : c.edge}
        strokeWidth={highlighted ? EDGE_SW + 1 : EDGE_SW}
        markerEnd={highlighted ? 'url(#arrowHi)' : 'url(#arrow)'}
      />
      {/* Transparent wide stroke so the thin line is easy to hover. */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: 'stroke' }} />
    </g>
  );
}

/** Box dimensions of a multi-line chip. */
function chipDims(lines: string[]): { w: number; h: number } {
  return {
    w: Math.max(...lines.map(l => measureText(l, CHIP_FONT)), 40),
    h: lines.length * CHIP_LINE_H + CHIP_PAD_Y * 2,
  };
}

/** A data-flow label, one column per line, centred on `pos`. Draggable: it
 *  slides along its edge path via `onPointerDown`. Hovering it focuses its edge. */
function EdgeChip({
  pos, lines, opacity, c, onPointerDown, onHoverChange,
}: {
  pos: NodePos;
  lines: string[];
  opacity: number;
  c: FlowPalette;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onHoverChange: (entering: boolean, clientX?: number, clientY?: number) => void;
}) {
  const { w: chipW, h: chipH } = chipDims(lines);
  const topY = pos.y - chipH / 2;
  return (
    <g
      data-ignatius="flow-chip"
      opacity={opacity}
      style={{ cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none', transition: 'opacity 0.12s' }}
      onPointerDown={onPointerDown}
      onPointerEnter={e => onHoverChange(true, e.clientX, e.clientY)}
      onPointerLeave={() => onHoverChange(false)}
      onPointerMove={e => onHoverChange(true, e.clientX, e.clientY)}
    >
      <rect
        x={pos.x - chipW / 2} y={topY}
        width={chipW} height={chipH} rx={CHIP_RX}
        fill={c.chipBg} stroke={c.border}
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={pos.x} y={topY + CHIP_PAD_Y + CHIP_LINE_H * i + CHIP_LINE_H / 2 + CHIP_FONT * 0.34}
          fill={c.text} fontSize={CHIP_FONT} textAnchor="middle"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export type ElkPositionMap = Record<string, { x: number; y: number }>;

export type FlowDiagramSvgProps = {
  diagram: FlowDiagram;
  /** Current app theme. Selects the flow palette — 'dark' (default) or 'light'. */
  themeMode?: 'dark' | 'light';
  /** Resolved per-kind color palette for the current mode. When provided, stores
   *  and externals are colored by their `kind` rather than the uniform palette fill. */
  kindPalette?: Record<FlowKindKey, FlowKindEntry>;
  onDrill?: (processId: string) => void;
  /** Called with a node's canonical doc token (`proc:id` / `ext:Name` / `kind:name`)
   *  when the user clicks its ⓘ badge — opens the documentation dialog. */
  onOpenDoc?: (docToken: string) => void;
  onReady?: () => void;
  /**
   * ELK-computed node positions, keyed by node id (from computeElkLayout).
   * When provided, this is the primary layout source — overrides the synchronous
   * banded positions from computeFlowLayout. savedPositions drag overrides still
   * win over both ELK positions and banded positions (same priority as before).
   * Shape is a plain Record (not Map) matching ElkLayoutResult.positions.
   */
  elkPositions?: ElkPositionMap;
  /**
   * ELK-routed edge geometry, keyed by edge id (from computeElkLayout).
   * Each entry is the full routed polyline: [startPoint, ...bendPoints, endPoint].
   * When provided for an edge, the renderer draws the ELK polyline instead of
   * self-routing via orthogonalPath — but ONLY when neither of the edge's
   * endpoints has been dragged off its ELK base position. If a node is dragged,
   * edges touching it revert to orthogonalPath (the live drag-time router).
   * Absent or undefined: orthogonalPath is used for all edges (no regression).
   */
  elkEdgeRoutes?: Record<string, Array<{ x: number; y: number }>>;
  /** Pre-loaded positions from persistence; overrides computed banded layout */
  savedPositions?: PositionMap;
  /** Fingerprint key for this diagram, used to scope saves */
  layoutKey?: string;
  /** Called after a drag-end with the complete updated position map */
  onPositionsChange?: (positions: PositionMap) => void;
  /** Called whenever pan, zoom, or node positions change (for minimap) */
  onViewChange?: (data: MinimapData) => void;
  /**
   * Called once on mount with a `panTo(worldX, worldY)` function so external
   * callers (e.g. the minimap) can pan the main viewport without a ref.
   * Called with null on unmount to clear the registration.
   */
  onRegisterPanTo?: (fn: ((worldX: number, worldY: number) => void) | null) => void;
  /**
   * Called whenever the scale changes (wheel, zoom-control buttons, reset).
   * Used by the app-level ZoomControl readout to stay in sync.
   * The value is the raw SVG scale factor (1 = fit baseline).
   */
  onZoomChange?: (scale: number) => void;
  /**
   * Called once on mount with zoom-control imperative operations, and with null
   * on unmount. Allows app-level ZoomControl handlers to drive the SVG zoom
   * without coupling the component to the control.
   */
  onRegisterZoomControl?: (ctrl: {
    zoomTo(scale: number): void;
    resetFit(): void;
  } | null) => void;
};

export function FlowDiagramSvg({
  diagram,
  themeMode = 'dark',
  kindPalette,
  onDrill,
  onOpenDoc,
  onReady,
  elkPositions,
  elkEdgeRoutes,
  savedPositions,
  onPositionsChange,
  onViewChange,
  onRegisterPanTo,
  onZoomChange,
  onRegisterZoomControl,
}: FlowDiagramSvgProps) {
  // Select palette based on current theme.
  const c = themeMode === 'light' ? LIGHT_PALETTE : DARK_PALETTE;

  const { nodes, edges, positions: bandedPositions, storeNums } = buildFlowData(diagram);

  // Build a quick lookup: nodeId → node metadata. Memoized so it only
  // rebuilds when the diagram (and thus `nodes`) changes, not every render.
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // Position source priority (highest → lowest):
  //   1. savedPositions drag overrides (user dragged a node — always wins)
  //   2. elkPositions (ELK-computed via computeElkLayout, when wired in FlowsView)
  //   3. bandedPositions (synchronous fallback from computeFlowLayout)
  //
  // When elkPositions is provided, it replaces bandedPositions as the base.
  // savedPositions always overrides whichever base is active, as before.
  const basePositions: Map<string, NodePos> = elkPositions !== undefined
    ? new Map(Object.entries(elkPositions))
    : new Map(bandedPositions);

  // Merge base positions with any saved drag overrides. savedPositions holds node
  // positions keyed by node id, and dragged-label positions keyed `chip:<edgeId>`.
  const initialPositions: Map<string, NodePos> = new Map(basePositions);
  const initialChipOverrides = new Map<string, NodePos>();
  if (savedPositions) {
    for (const [id, saved] of Object.entries(savedPositions)) {
      if (id.startsWith('chip:')) {
        initialChipOverrides.set(id.slice('chip:'.length), { x: saved.x, y: saved.y });
      } else if (initialPositions.has(id)) {
        initialPositions.set(id, { x: saved.x, y: saved.y });
      }
    }
  }

  // ── State ────────────────────────────────────────────────────────────────

  // Node positions (world space). Mutable during drag; triggers re-render on change.
  const [positions, setPositions] = useState<Map<string, NodePos>>(initialPositions);
  // User-dragged label positions, keyed by edge id (slid along the edge path).
  const [chipOverrides, setChipOverrides] = useState<Map<string, NodePos>>(initialChipOverrides);
  // Mirror of chipOverrides for the debounced save (avoids a stale closure).
  const chipOverridesRef = useRef(chipOverrides);
  useEffect(() => { chipOverridesRef.current = chipOverrides; }, [chipOverrides]);

  // Hover focus: dim everything except the hovered node/edge and what it connects
  // to. `kind` distinguishes a node id from an edge id.
  const [hover, setHover] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  // Edge whose label is being dragged — its line shows the bright highlight.
  const [draggingEdge, setDraggingEdge] = useState<string | null>(null);

  // HTML tooltip for edge hover: shows full dataLines content at pointer coords.
  // Separate from `hover` so the tooltip can carry pointer screen coords without
  // triggering the SVG dim/highlight mechanism on every mousemove.
  const [edgeTooltip, setEdgeTooltip] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  // Flicker guard: delay clearing the tooltip so that crossing from the edge path
  // layer to the chip layer (two separate <g> elements) does not flash it off.
  const tooltipClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pan: world-space translate applied as CSS transform on the inner <g>.
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  // Zoom: scale factor
  const [scale, setScale] = useState(1);

  // SVG element ref — for getBoundingClientRect and coordinate transforms.
  const svgRef = useRef<SVGSVGElement>(null);

  // ── World bounding box (from all node positions + padding) ────────────────

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [id, pos] of positions) {
    const node = nodeById.get(id);
    if (!node) continue;
    const storeName = node.nodeType === 'store' ? (node.label ?? node.storeName ?? '') : undefined;
    const bounds = nodeBounds(pos, node.nodeType, storeName);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 400; maxY = 300; }

  const vbX = minX - PADDING;
  const vbY = minY - PADDING;
  const vbW = maxX - minX + PADDING * 2;
  const vbH = maxY - minY + PADDING * 2;

  // ── Minimap data emission ────────────────────────────────────────────────

  const emitViewChange = useCallback(() => {
    if (!onViewChange || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgW = rect.width || vbW;
    const svgH = rect.height || vbH;

    const worldBounds = { x: vbX, y: vbY, w: vbW, h: vbH };

    const nodeBoxes: MinimapData['nodeBoxes'] = [];
    for (const [id, pos] of positions) {
      const node = nodeById.get(id);
      if (!node) continue;
      const storeName = node.nodeType === 'store' ? (node.label ?? node.storeName ?? '') : undefined;
      const b = nodeBounds(pos, node.nodeType, storeName);
      nodeBoxes.push({ x: b.x, y: b.y, w: b.w, h: b.h, type: node.nodeType });
    }

    onViewChange({ worldBounds, nodeBoxes, viewport: { tx, ty, scale, svgW, svgH } });
  }, [onViewChange, positions, tx, ty, scale, vbX, vbY, vbW, vbH]);

  // Emit minimap data whenever relevant state changes.
  useEffect(() => { emitViewChange(); }, [emitViewChange]);

  // ── Ready signal ─────────────────────────────────────────────────────────

  const readyRef = useRef(false);
  useEffect(() => {
    if (!readyRef.current) {
      readyRef.current = true;
      onReady?.();
    }
  }, []);

  // ── Minimap pan registration ──────────────────────────────────────────────

  // Expose a panTo(worldX, worldY) function so the minimap can drive pan.
  // When the user clicks world coords (worldX, worldY), we center the viewport
  // on that point by adjusting tx/ty in vb space:
  //   tx = (vbX + vbW/2) - worldX * scale
  //   ty = (vbY + vbH/2) - worldY * scale
  // We capture scale/tx/ty via refs so closures always have the latest values.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const txRef = useRef(tx);
  txRef.current = tx;
  const tyRef = useRef(ty);
  tyRef.current = ty;

  useEffect(() => {
    if (!onRegisterPanTo) return;
    function panTo(worldX: number, worldY: number) {
      const s = scaleRef.current;
      setTx((vbX + vbW / 2) - worldX * s);
      setTy((vbY + vbH / 2) - worldY * s);
    }
    onRegisterPanTo(panTo);
    return () => { onRegisterPanTo(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRegisterPanTo, vbX, vbY, vbW, vbH]);

  // ── Zoom control registration ─────────────────────────────────────────────

  // Notify the app-level ZoomControl readout whenever scale changes.
  // This fires on wheel, pinch, button-driven zoom, and reset.
  useEffect(() => {
    onZoomChange?.(scale);
  }, [scale, onZoomChange]);

  // Expose imperative zoom operations so the app-level ZoomControl buttons can
  // drive the SVG zoom without the control knowing about SVG internals.
  // `zoomTo` zooms about the viewport center: adjust tx/ty so the center world
  // point stays fixed — same math as onWheel but targetted at vb center.
  useEffect(() => {
    if (!onRegisterZoomControl) return;
    function zoomTo(targetScale: number) {
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, targetScale));
      // Zoom about the vb center: keep the world point at the vb midpoint fixed.
      const centerVbX = vbX + vbW / 2;
      const centerVbY = vbY + vbH / 2;
      const s = scaleRef.current;
      const worldCenterX = (centerVbX - txRef.current) / s;
      const worldCenterY = (centerVbY - tyRef.current) / s;
      setTx(centerVbX - worldCenterX * clamped);
      setTy(centerVbY - worldCenterY * clamped);
      setScale(clamped);
    }
    function resetFit() {
      setTx(0);
      setTy(0);
      setScale(1);
    }
    onRegisterZoomControl({ zoomTo, resetFit });
    return () => { onRegisterZoomControl(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRegisterZoomControl, vbX, vbY, vbW, vbH]);

  // ── Interaction state (kept in refs, not state, to avoid re-renders) ──────

  // Pan gesture tracking
  const panActive = useRef(false);
  const panStart = useRef({ clientX: 0, clientY: 0, tx: 0, ty: 0 });

  // Drag gesture tracking
  const dragActive = useRef(false);
  const dragNodeId = useRef<string | null>(null);
  // Tracks whether the dragged node is a drillable process and what its processId is.
  // Stored in refs because onSvgPointerUp (which fires via pointer capture) needs
  // this info to fire the drill on a short click without movement.
  const dragNodeIsSubDfd = useRef(false);
  const dragNodeProcessId = useRef<string | null>(null);
  const dragStart = useRef({ clientX: 0, clientY: 0, worldX: 0, worldY: 0 });
  const dragMoved = useRef(false);

  // Label (chip) drag tracking — slides along the edge's path.
  const dragChipId = useRef<string | null>(null);
  const dragChipPoints = useRef<Pt[]>([]);

  // Save debounce timer
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Pan handlers ─────────────────────────────────────────────────────────

  function onSvgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    // Only start pan on background clicks (not on node elements).
    // Node pointer events are stopped by onNodePointerDown.
    if (dragActive.current) return;
    // Only primary button
    if (e.button !== 0) return;

    panActive.current = true;
    panStart.current = { clientX: e.clientX, clientY: e.clientY, tx, ty };
    svgRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  // Convert a client (screen) point to world coords, inverting the viewBox
  // mapping and the pan/zoom transform on the inner group.
  function clientToWorld(clientX: number, clientY: number): NodePos {
    const rect = svgRef.current!.getBoundingClientRect();
    const vbPx = vbX + ((clientX - rect.left) / rect.width) * vbW;
    const vbPy = vbY + ((clientY - rect.top) / rect.height) * vbH;
    return { x: (vbPx - tx) / scale, y: (vbPy - ty) / scale };
  }

  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (dragChipId.current) {
      if (!svgRef.current) return;
      const w = clientToWorld(e.clientX, e.clientY);
      const snapped = projectOntoPolyline(dragChipPoints.current, w.x, w.y);
      setChipOverrides(prev => {
        const next = new Map(prev);
        next.set(dragChipId.current!, snapped);
        return next;
      });
      return;
    }

    if (dragActive.current && dragNodeId.current) {
      // Node drag: compute delta in vb space
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const dx = (e.clientX - dragStart.current.clientX) / (rect.width / vbW);
      const dy = (e.clientY - dragStart.current.clientY) / (rect.height / vbH);

      if (!dragMoved.current && (Math.abs(dx) > DRAG_THRESHOLD_VB || Math.abs(dy) > DRAG_THRESHOLD_VB)) {
        dragMoved.current = true;
      }

      if (dragMoved.current) {
        const newX = dragStart.current.worldX + dx / scale;
        const newY = dragStart.current.worldY + dy / scale;
        setPositions(prev => {
          const next = new Map(prev);
          next.set(dragNodeId.current!, { x: newX, y: newY });
          return next;
        });
      }
      return;
    }

    if (!panActive.current) return;
    const dx = (e.clientX - panStart.current.clientX);
    const dy = (e.clientY - panStart.current.clientY);
    // Convert screen delta to vb-space delta
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const vbDx = (dx / rect.width) * vbW;
    const vbDy = (dy / rect.height) * vbH;
    setTx(panStart.current.tx + vbDx);
    setTy(panStart.current.ty + vbDy);
  }

  // Build the persisted map: node positions by id + dragged labels as `chip:<id>`.
  function buildPosMap(curPositions: Map<string, NodePos>): PositionMap {
    const map: PositionMap = {};
    for (const [id, pos] of curPositions) map[id] = { x: pos.x, y: pos.y };
    for (const [eid, p] of chipOverridesRef.current) map[`chip:${eid}`] = { x: p.x, y: p.y };
    return map;
  }

  function scheduleSave() {
    if (!onPositionsChange) return;
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      setPositions(current => { onPositionsChange(buildPosMap(current)); return current; });
    }, 400);
  }

  function onSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (dragChipId.current) {
      dragChipId.current = null;
      dragChipPoints.current = [];
      setDraggingEdge(null);
      scheduleSave();
      return;
    }

    if (dragActive.current) {
      const movedEnough = dragMoved.current;
      const nodeId = dragNodeId.current;
      const isSubDfd = dragNodeIsSubDfd.current;
      const processId = dragNodeProcessId.current;

      // Reset drag state before any callbacks (prevents re-entrancy).
      dragActive.current = false;
      dragNodeId.current = null;
      dragNodeIsSubDfd.current = false;
      dragNodeProcessId.current = null;
      dragMoved.current = false;

      if (!movedEnough && isSubDfd && processId) {
        // Short tap on a drillable node (no significant movement) → fire drill.
        onDrill?.(processId);
        return;
      }

      if (movedEnough && nodeId) {
        scheduleSave();
      }
      return;
    }
    panActive.current = false;
  }

  // Cancelled pointers (touch interrupted, pen lift, etc.) must run the same
  // cleanup as pointerup — otherwise dragActive/panActive stay true and the
  // next pointerdown early-returns, leaving the view permanently stuck.
  function onSvgPointerCancel(e: React.PointerEvent<SVGSVGElement>) {
    dragActive.current = false;
    dragNodeId.current = null;
    dragNodeIsSubDfd.current = false;
    dragNodeProcessId.current = null;
    dragMoved.current = false;
    dragChipId.current = null;
    dragChipPoints.current = [];
    setDraggingEdge(null);
    panActive.current = false;
    // Release pointer capture if still held (no-op if already released).
    try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  // ── Zoom handler ─────────────────────────────────────────────────────────

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    if (!svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    // Cursor in vb space (before any inner <g> transform)
    const cursorVbX = vbX + ((e.clientX - rect.left) / rect.width) * vbW;
    const cursorVbY = vbY + ((e.clientY - rect.top) / rect.height) * vbH;

    // Tamed wheel sensitivity: smaller step per notch so single-notch scrolls
    // are controllable (0.9/1.1 was too aggressive; 0.95/1.05 matches the graph).
    const delta = e.deltaY > 0 ? 0.95 : 1.05;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * delta));

    // Keep the cursor point fixed: adjust tx/ty so the world point under the
    // cursor stays at the same vb position.
    // Point in world space (before inner transform): worldPt = (cursorVb - pan) / scale
    // After zoom: newPan = cursorVb - worldPt * newScale
    const worldPtX = (cursorVbX - tx) / scale;
    const worldPtY = (cursorVbY - ty) / scale;
    setTx(cursorVbX - worldPtX * newScale);
    setTy(cursorVbY - worldPtY * newScale);
    setScale(newScale);
  }

  // ── Node drag start ──────────────────────────────────────────────────────

  function onNodePointerDown(
    e: React.PointerEvent<SVGGElement>,
    nodeId: string,
    hasSubDfd: boolean,
    processId: string,
  ) {
    // Prevent the SVG's pan handler from starting (stopPropagation on pointerdown).
    e.stopPropagation();
    if (e.button !== 0) return;

    dragActive.current = true;
    dragNodeId.current = nodeId;
    dragNodeIsSubDfd.current = hasSubDfd;
    dragNodeProcessId.current = processId;
    dragMoved.current = false;

    const currentPos = positions.get(nodeId) ?? { x: 0, y: 0 };
    dragStart.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      worldX: currentPos.x,
      worldY: currentPos.y,
    };

    // Capture pointer on the SVG so pointermove/pointerup reach onSvgPointerMove
    // and onSvgPointerUp even when the cursor leaves the node element.
    // WHY SVG (not the <g>): SVG is the event surface; capturing it ensures the
    // drag/drill cleanup always runs via onSvgPointerUp, regardless of stopPropagation
    // called on child elements. onNodePointerUp is NOT needed and is removed.
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  function onChipPointerDown(e: React.PointerEvent<SVGGElement>, edgeId: string, points: Pt[]) {
    e.stopPropagation(); // don't start a pan
    if (e.button !== 0) return;
    dragChipId.current = edgeId;
    dragChipPoints.current = points;
    setDraggingEdge(edgeId); // highlight the line while dragging its label
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  // ── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      if (tooltipClearTimer.current !== null) clearTimeout(tooltipClearTimer.current);
    };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  // Fan-out attachment points, recomputed against live positions so edges
  // re-balance their anchors as nodes are dragged.
  const edgeAnchors = computeEdgeAnchors(edges, nodeById, positions);

  // Node boxes, once — used as chip-collision targets (labels stay off nodes;
  // lines are allowed to pass behind them).
  const nodeBoxes: Box[] = [];
  for (const n of nodes) {
    const p = positions.get(n.id);
    if (!p) continue;
    const sn = n.nodeType === 'store' ? (n.label ?? n.storeName ?? '') : undefined;
    const b = nodeBounds(p, n.nodeType, sn);
    nodeBoxes.push({ x: b.x, y: b.y, w: b.w, h: b.h });
  }

  // Pre-resolve each edge's path and chip once, so they can be drawn in two
  // separate layers (paths under the nodes, chips above everything).
  type EdgeRender = {
    id: string;
    d: string;
    points: Pt[];
    label: string;
    chip: NodePos;
    lines: string[];
    /** True when the label is hidden (too long for an inline chip). */
    hasHiddenLabel: boolean;
    /** Structured data items for the hover tooltip (from CP1 dataLines). */
    dataLines: string[];
    /** Human-readable source node label for the tooltip header. */
    sourceLabel: string;
    /** Human-readable target node label for the tooltip header. */
    targetLabel: string;
  };
  const edgeRenders: EdgeRender[] = edges.flatMap(edge => {
    const fromNode = nodeById.get(edge.source);
    const toNode = nodeById.get(edge.target);
    const fromPos = positions.get(edge.source);
    const toPos = positions.get(edge.target);
    if (!fromNode || !toNode || !fromPos || !toPos) return [];
    const fromStoreName = fromNode.nodeType === 'store' ? (fromNode.label ?? fromNode.storeName) : undefined;
    const toStoreName = toNode.nodeType === 'store' ? (toNode.label ?? toNode.storeName) : undefined;

    // CP4b: use ELK's routed geometry when available and neither endpoint has
    // been dragged off its ELK base position. "Moved" = current position differs
    // from basePositions (a savedPositions override or a live drag). When a
    // node is moved, its edges revert to the live hand-router (orthogonalPath).
    const elkRoute = elkEdgeRoutes?.[edge.id];
    const fromBase = basePositions.get(edge.source);
    const toBase = basePositions.get(edge.target);
    const fromMoved = fromBase === undefined
      || fromPos.x !== fromBase.x
      || fromPos.y !== fromBase.y;
    const toMoved = toBase === undefined
      || toPos.x !== toBase.x
      || toPos.y !== toBase.y;
    // Use ELK's routed polyline when present and neither endpoint has been
    // dragged off its ELK base position; else hand-route. `elkPts` is non-null
    // exactly when the route is usable — which also narrows the chip branch.
    const elkPts: Pt[] | null =
      elkRoute !== undefined && elkRoute.length >= 2 && !fromMoved && !toMoved
        ? elkRoute.map((p): Pt => [p.x, p.y])
        : null;

    let points: Pt[];
    if (elkPts !== null) {
      points = elkPts;
    } else {
      const a = edgeAnchors.get(edge.id) ?? { fromX: fromPos.x, toX: toPos.x };
      points = orthogonalPath(fromPos, fromNode.nodeType, fromStoreName, toPos, toNode.nodeType, toStoreName, a.fromX, a.toX);
    }

    // A dragged label slides along the path: snap its saved point onto the
    // (possibly re-routed) polyline. Otherwise use the auto-placed anchor.
    const override = chipOverrides.get(edge.id);
    let chip: NodePos;
    if (override) {
      chip = projectOntoPolyline(points, override.x, override.y);
    } else if (elkPts !== null) {
      // CP4c: for ELK-routed edges, place the chip in the inter-band CHANNEL —
      // the y midway between source-bottom and target-top (whichever is "upper"
      // and "lower" in screen coordinates). The route midpoint lands on a node;
      // the channel point lands between them.
      //
      // 1. Determine the upper and lower node boxes.
      const fromSn = fromNode.nodeType === 'store' ? (fromNode.label ?? fromNode.storeName) : undefined;
      const toSn = toNode.nodeType === 'store' ? (toNode.label ?? toNode.storeName) : undefined;
      const fb = nodeBounds(fromPos, fromNode.nodeType, fromSn);
      const tb = nodeBounds(toPos, toNode.nodeType, toSn);
      // upper = whichever box has the smaller center-y; lower = the other.
      const upperBottom = fb.cy <= tb.cy ? fb.y + fb.h : tb.y + tb.h;
      const lowerTop    = fb.cy <= tb.cy ? tb.y : fb.y;
      const channelY = (upperBottom + lowerTop) / 2;

      // 2. Find the route's x at channelY by walking segments and interpolating
      //    on the segment that spans channelY. Fall back to nearest point if none
      //    spans it (guards against routes that don't cross the channel).
      let channelX: number = elkPts[0]?.[0] ?? fromPos.x;
      let foundSpan = false;
      for (let i = 1; i < elkPts.length; i++) {
        const prev = elkPts[i - 1];
        const curr = elkPts[i];
        if (prev === undefined || curr === undefined) continue;
        const [ax, ay] = prev;
        const [bx, by] = curr;
        const minY = Math.min(ay, by);
        const maxY = Math.max(ay, by);
        if (channelY >= minY && channelY <= maxY) {
          // Segment spans channelY; interpolate x.
          const span = by - ay;
          const t = span === 0 ? 0 : (channelY - ay) / span;
          channelX = ax + t * (bx - ax);
          foundSpan = true;
          break;
        }
      }
      if (!foundSpan) {
        // No segment spans channelY — use nearest point to channelY on the route.
        let nearestDist = Infinity;
        for (const pt of elkPts) {
          const d = Math.abs(pt[1] - channelY);
          if (d < nearestDist) { nearestDist = d; channelX = pt[0]; }
        }
      }

      chip = { x: channelX, y: channelY };
    } else {
      const a = edgeAnchors.get(edge.id) ?? { fromX: fromPos.x, toX: toPos.x };
      chip = chipAnchor(fromPos, fromNode.nodeType, fromStoreName, toPos, toNode.nodeType, toStoreName, a.fromX, a.toX);
    }

    // CP4a length gate: short labels (≤ SHORT_LABEL_MAX) render full inline,
    // split by item. Long labels (db: column lists and long payload phrases)
    // render a single truncated preview chip ending in '…' so the canvas always
    // shows a "more data here" marker; the full contract is still in data-contract
    // and the hover tooltip reveals it. Empty label → no chip (lines stays []).
    const lines = isInlineLabel(edge.label)
      ? edge.label.split(', ').map(l => truncateLabel(l, CHIP_MAX_CHARS))
      : edge.label
        ? [truncateLabel(edge.label, CHIP_MAX_CHARS)]
        : [];
    const hasHiddenLabel = !!edge.label && !isInlineLabel(edge.label);

    const sourceLabel = fromNode.label;
    const targetLabel = toNode.label;

    return [{ id: edge.id, d: pointsToD(points), points, label: edge.label, chip, lines, hasHiddenLabel, dataLines: edge.dataLines, sourceLabel, targetLabel }];
  });

  // Keep auto-placed labels off the node boxes and off each other; user-placed
  // (overridden) labels stay where they were dropped.
  const autoChips = edgeRenders.filter(e => !chipOverrides.has(e.id));
  deoverlapChips(autoChips, nodeBoxes);

  // Hover focus set: the hovered element plus everything it connects to. Null
  // means no hover → nothing dimmed.
  let focus: { nodes: Set<string>; edges: Set<string> } | null = null;
  if (hover) {
    const fNodes = new Set<string>();
    const fEdges = new Set<string>();
    if (hover.kind === 'node') {
      fNodes.add(hover.id);
      for (const e of edges) {
        if (e.source === hover.id || e.target === hover.id) {
          fEdges.add(e.id);
          fNodes.add(e.source);
          fNodes.add(e.target);
        }
      }
    } else {
      fEdges.add(hover.id);
      const e = edges.find(x => x.id === hover.id);
      if (e) { fNodes.add(e.source); fNodes.add(e.target); }
    }
    focus = { nodes: fNodes, edges: fEdges };
  }
  const nodeOpacity = (id: string) => (!focus || focus.nodes.has(id) ? 1 : DIM_OPACITY);
  const edgeOpacity = (id: string) => (!focus || focus.edges.has(id) ? 1 : DIM_OPACITY);

  // Resolve the hovered edge render for the tooltip.
  const tooltipEdge = edgeTooltip !== null
    ? edgeRenders.find(e => e.id === edgeTooltip.edgeId)
    : undefined;

  // Clamp a fixed-position tooltip so it stays within the viewport.
  // Offsets: 16px right + 12px below the pointer; flip left when near right edge.
  const TOOLTIP_OFFSET_X = 16;
  const TOOLTIP_OFFSET_Y = 12;
  const TOOLTIP_W_ESTIMATE = 220; // max expected tooltip width for right-edge clamp
  let tooltipLeft: number | undefined;
  let tooltipTop: number | undefined;
  if (edgeTooltip !== null && tooltipEdge !== undefined && tooltipEdge.dataLines.length > 0) {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    tooltipLeft = edgeTooltip.x + TOOLTIP_OFFSET_X;
    tooltipTop = edgeTooltip.y + TOOLTIP_OFFSET_Y;
    if (tooltipLeft + TOOLTIP_W_ESTIMATE > vw) {
      tooltipLeft = edgeTooltip.x - TOOLTIP_W_ESTIMATE - TOOLTIP_OFFSET_X;
    }
    if (tooltipTop + 40 > vh) {
      tooltipTop = edgeTooltip.y - 40 - TOOLTIP_OFFSET_Y;
    }
  }

  return (
    <>
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      style={{ display: 'block', background: c.canvas, touchAction: 'none' }}
      data-ignatius="flow-svg"
      onPointerDown={onSvgPointerDown}
      onPointerMove={onSvgPointerMove}
      onPointerUp={onSvgPointerUp}
      onPointerCancel={onSvgPointerCancel}
      onWheel={onWheel}
    >
      <defs>
        <marker id="arrow" markerWidth={10} markerHeight={10} refX={7.5} refY={3.5}
          orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L8,3.5 L0,7 Z" fill={c.edge} />
        </marker>
        <marker id="arrowHi" markerWidth={10} markerHeight={10} refX={7.5} refY={3.5}
          orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L8,3.5 L0,7 Z" fill={EDGE_HIGHLIGHT} />
        </marker>
      </defs>

      {/*
        Inner group: pan and zoom are applied as a CSS transform in vb space.
        translate(tx, ty) moves the world origin; scale(scale) zooms around it.
        The SVG viewBox stays fixed; only this group moves.
      */}
      <g transform={`translate(${tx},${ty}) scale(${scale})`}>
        {/* Layer 1: edge paths (under the nodes) */}
        {edgeRenders.map(e => (
          <EdgePath
            key={e.id}
            d={e.d}
            label={e.label}
            hasHiddenLabel={e.hasHiddenLabel}
            opacity={edgeOpacity(e.id)}
            highlighted={draggingEdge === e.id}
            c={c}
            onHoverChange={(entering, cx, cy) => {
              setHover(entering ? { kind: 'edge', id: e.id } : null);
              if (entering && e.dataLines.length > 0 && cx !== undefined && cy !== undefined) {
                if (tooltipClearTimer.current !== null) {
                  clearTimeout(tooltipClearTimer.current);
                  tooltipClearTimer.current = null;
                }
                setEdgeTooltip({ edgeId: e.id, x: cx, y: cy });
              } else if (!entering) {
                tooltipClearTimer.current = setTimeout(() => {
                  setEdgeTooltip(null);
                  tooltipClearTimer.current = null;
                }, 80);
              }
            }}
          />
        ))}

        {/* Layer 2: nodes */}
        {nodes.map(node => {
          const pos = positions.get(node.id);
          if (!pos) return null;

          const hoverProps = {
            opacity: nodeOpacity(node.id),
            style: { transition: 'opacity 0.12s' },
            onPointerEnter: () => setHover({ kind: 'node' as const, id: node.id }),
            onPointerLeave: () => setHover(null),
          };

          if (node.nodeType === 'process') {
            const processId = node.processId ?? node.id;
            const hasSubDfd = node.hasSubDfd ?? false;
            const procToken = `proc:${processId}`;
            return (
              <g
                key={node.id}
                data-token={procToken}
                {...hoverProps}
                onPointerDown={e => onNodePointerDown(e, node.id, hasSubDfd, processId)}
              >
                <ProcessNode
                  id={processId}
                  label={node.label}
                  pos={pos}
                  num={diagram.processes.find(p => p.id === node.processId)?.dottedNumber ?? '?'}
                  hasSubDfd={hasSubDfd}
                  c={c}
                  onOpenDoc={onOpenDoc ? () => onOpenDoc(procToken) : undefined}
                />
              </g>
            );
          }

          if (node.nodeType === 'external') {
            const extToken = node.extId ?? `ext:${node.label}`;
            // When the external carries a kind, look it up in the kind palette.
            const extKindColors = node.extKind && kindPalette
              ? kindPalette[node.extKind]
              : undefined;
            return (
              <g key={node.id} data-token={extToken} {...hoverProps} onPointerDown={e => onNodePointerDown(e, node.id, false, '')}>
                <ExternalNode
                  label={node.label}
                  pos={pos}
                  c={c}
                  kindColors={extKindColors}
                  onOpenDoc={onOpenDoc ? () => onOpenDoc(extToken) : undefined}
                />
              </g>
            );
          }

          if (node.nodeType === 'store') {
            const num = storeNums.get(node.id) ?? 0;
            // Use the raw slug (storeName) to build the token; use the display
            // label (node.label = displayName) as the visible text in the SVG.
            const slugName = node.storeName ?? node.label;
            const displayLabel = node.label ?? slugName;
            const storeKind = node.storeKind;
            const storeToken = `${storeKind ?? 'db'}:${slugName}`;
            const storeKindColors = storeKind && kindPalette
              ? kindPalette[storeKind]
              : undefined;
            return (
              <g key={node.id} data-token={storeToken} {...hoverProps} onPointerDown={e => onNodePointerDown(e, node.id, false, '')}>
                <StoreNode
                  storeNum={num}
                  storeName={displayLabel}
                  pos={pos}
                  duplicated={node.duplicated ?? false}
                  c={c}
                  kindColors={storeKindColors}
                  onOpenDoc={onOpenDoc ? () => onOpenDoc(storeToken) : undefined}
                />
              </g>
            );
          }

          return null;
        })}

        {/* Layer 3: edge chips (above everything, so a line never covers a label) */}
        {edgeRenders.map(e => (
          e.lines.length > 0
            ? <EdgeChip
                key={e.id}
                pos={e.chip}
                lines={e.lines}
                opacity={edgeOpacity(e.id)}
                c={c}
                onPointerDown={ev => onChipPointerDown(ev, e.id, e.points)}
                onHoverChange={(entering, cx, cy) => {
                  setHover(entering ? { kind: 'edge', id: e.id } : null);
                  if (entering && e.dataLines.length > 0 && cx !== undefined && cy !== undefined) {
                    if (tooltipClearTimer.current !== null) {
                      clearTimeout(tooltipClearTimer.current);
                      tooltipClearTimer.current = null;
                    }
                    setEdgeTooltip({ edgeId: e.id, x: cx, y: cy });
                  } else if (!entering) {
                    tooltipClearTimer.current = setTimeout(() => {
                      setEdgeTooltip(null);
                      tooltipClearTimer.current = null;
                    }, 80);
                  }
                }}
              />
            : null
        ))}
      </g>
    </svg>
    {tooltipEdge !== undefined && tooltipLeft !== undefined && tooltipTop !== undefined && (
      <div
        data-ignatius="flow-edge-tooltip"
        className="flow-edge-tooltip"
        style={{ left: tooltipLeft, top: tooltipTop }}
      >
        <div className="flow-edge-tooltip__header">
          {tooltipEdge.sourceLabel} → {tooltipEdge.targetLabel}
        </div>
        <ul className="flow-edge-tooltip__list">
          {tooltipEdge.dataLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    )}
    </>
  );
}
