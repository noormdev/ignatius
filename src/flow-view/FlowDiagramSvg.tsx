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
import type { FlowDiagram } from '../flow-parse';
import type { NodePos } from './flow-layout';
import type { PositionMap } from '../layout-store';

// ── Visual constants — match mock-e ──────────────────────────────────────────

const C = {
  canvas: '#0e1116',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#8b949e',
  accent: '#58a6ff',

  procFill: '#0d419d',
  procBorder: '#58a6ff',
  procText: '#cfe2ff',

  extFill: '#1a3a1a',
  extBorder: '#3fb950',
  extText: '#b7f0c4',

  storeFill: '#3d2e00',
  storeBorder: '#d29922',
  storeText: '#f2d49b',

  edgeWrite: '#8b949e',
  edgeRead: '#d29922',
  chipBg: '#161b22',
};

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

const EDGE_SW_WRITE = 1.6;
const EDGE_SW_READ = 1.8;
// How far short of the node boundary to stop the path, so the arrowhead
// (markerUnits=userSpaceOnUse, refX=7.5) sits flush against the node edge.
const ARROW_MARGIN = 8;

const CHIP_H = 18;
const CHIP_RX = 4;
const CHIP_FONT = 10.5;
const CHIP_MAX_CHARS = 22; // truncate long labels to keep chips within store spacing

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
  const bodyW = Math.max(STORE_BODY_W, measureText(name, 11.5));
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

/**
 * Compute an orthogonal edge path between two nodes.
 * Returns an SVG path `d` attribute string.
 */
function orthogonalPath(
  fromPos: NodePos, fromType: string, fromStoreName: string | undefined,
  toPos: NodePos, toType: string, toStoreName: string | undefined,
): string {
  const fb = nodeBounds(fromPos, fromType, fromStoreName);
  const tb = nodeBounds(toPos, toType, toStoreName);

  const goingDown = fromPos.y <= toPos.y;

  const fx = fromPos.x;
  const fy = goingDown ? fb.y + fb.h : fb.y;
  const tx = toPos.x;
  const ty = goingDown ? tb.y - ARROW_MARGIN : tb.y + tb.h + ARROW_MARGIN;

  const destBoundary = goingDown ? tb.y : tb.y + tb.h;
  const midY = (fy + destBoundary) / 2;

  if (Math.abs(fx - tx) < 2) {
    return `M${fx},${fy} V${ty}`;
  }

  return `M${fx},${fy} V${midY} H${tx} V${ty}`;
}

/**
 * Pick a point along an orthogonal path for the data-label chip.
 */
function chipAnchor(
  fromPos: NodePos, fromType: string, fromStoreName: string | undefined,
  toPos: NodePos, toType: string, toStoreName: string | undefined,
): NodePos {
  const fb = nodeBounds(fromPos, fromType, fromStoreName);
  const tb = nodeBounds(toPos, toType, toStoreName);
  const goingDown = fromPos.y <= toPos.y;

  const fy = goingDown ? fb.y + fb.h : fb.y;
  const destBoundary = goingDown ? tb.y : tb.y + tb.h;
  const midY = (fy + destBoundary) / 2;

  let chipX: number;
  if (fromType === 'process' && toType === 'store') {
    chipX = toPos.x;
  } else if (fromType === 'store' && toType === 'process') {
    chipX = fromPos.x;
  } else {
    chipX = Math.abs(fromPos.x - toPos.x) < 2
      ? fromPos.x
      : (fromPos.x + toPos.x) / 2;
  }

  const isLongDownwardPath = goingDown && fromType === 'process' && toType === 'external';
  const chipY = isLongDownwardPath
    ? fy + (destBoundary - fy) * 0.72
    : midY;

  return { x: chipX, y: chipY };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ProcessNode({
  id, label, pos, num, hasSubDfd,
}: {
  id: string; label: string; pos: NodePos; num: string;
  hasSubDfd: boolean;
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
      <rect
        x={x} y={y} width={PROC_W} height={PROC_H} rx={PROC_RX}
        fill={C.procFill} stroke={C.procBorder} strokeWidth={1.6}
      />
      <circle cx={badgeCx} cy={badgeCy} r={BADGE_R} fill={C.canvas} stroke={C.procBorder} strokeWidth={1.3} />
      <text x={badgeCx} y={badgeCy + 4} fill={C.procText} fontSize={11} fontWeight={700} textAnchor="middle">{num}</text>
      <text
        x={textCenterX}
        y={textStartY}
        fill={C.procText}
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
          fill={C.procText}
          fontSize={11.5}
          fontWeight={600}
          textAnchor="middle"
        >
          {line2}
        </text>
      )}
      {hasSubDfd && (
        <text x={x + PROC_W - 10} y={y + PROC_H - 6} fill="#9ecbff" fontSize={12} textAnchor="middle">⤵</text>
      )}
    </g>
  );
}

function ExternalNode({ label, pos }: { label: string; pos: NodePos }) {
  const x = pos.x - EXT_W / 2;
  const y = pos.y - EXT_H / 2;

  return (
    <g data-node-type="external" style={{ cursor: 'move' }}>
      <rect x={x} y={y} width={EXT_W} height={EXT_H} rx={EXT_RX}
        fill={C.extFill} stroke={C.extBorder} strokeWidth={1.4} />
      <text x={pos.x} y={pos.y + 4} fill={C.extText} fontSize={12.5} fontWeight={600} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function StoreNode({
  storeNum, storeName, pos, isShared,
}: {
  storeNum: number; storeName: string; pos: NodePos; isShared: boolean;
}) {
  const sw = storeWidth(storeName);
  const x = pos.x - sw / 2;
  const y = pos.y - STORE_H / 2;
  const bodyX = x + STORE_CAP_W;
  const bodyW = sw - STORE_CAP_W;
  const dLabel = `D${storeNum}`;
  const strokeW = isShared ? 1.6 : 1.4;
  const rightX = x + sw;

  return (
    <g data-node-type="store" style={{ cursor: 'move' }}>
      {isShared && (
        <rect
          x={x - 6} y={y - 6} width={sw + 12} height={STORE_H + 12} rx={6}
          fill="none" stroke={C.accent} strokeWidth={1.2} opacity={0.65}
        />
      )}
      <rect x={bodyX} y={y} width={bodyW} height={STORE_H} fill={C.storeFill} />
      <rect x={x} y={y} width={STORE_CAP_W} height={STORE_H}
        fill={C.storeFill} stroke={C.storeBorder} strokeWidth={strokeW} />
      <path
        d={`M${x},${y} H${rightX} M${x},${y} V${y + STORE_H} H${rightX}`}
        fill="none" stroke={C.storeBorder} strokeWidth={strokeW}
      />
      <line x1={bodyX} y1={y} x2={bodyX} y2={y + STORE_H} stroke={C.storeBorder} strokeWidth={strokeW} />
      <text
        x={x + STORE_CAP_W / 2} y={y + STORE_H / 2 + 4}
        fill={C.storeText} fontSize={11} fontWeight={700} textAnchor="middle"
      >
        {dLabel}
      </text>
      <text
        x={bodyX + 6} y={y + STORE_H / 2 + 4}
        fill={C.storeText} fontSize={11.5} textAnchor="start"
      >
        {storeName}
      </text>
    </g>
  );
}

function EdgeLine({
  fromPos, fromType, fromStoreName,
  toPos, toType, toStoreName,
  label, isRead,
}: {
  fromPos: NodePos; fromType: string; fromStoreName?: string;
  toPos: NodePos; toType: string; toStoreName?: string;
  label: string; isRead: boolean;
}) {
  const stroke = isRead ? C.edgeRead : C.edgeWrite;
  const sw = isRead ? EDGE_SW_READ : EDGE_SW_WRITE;
  const dashArray = isRead ? '6 5' : undefined;
  const markerId = isRead ? 'arrowRead' : 'arrowWrite';
  const chipStroke = isRead ? C.edgeRead : C.border;
  const chipTextFill = isRead ? C.storeText : C.text;

  const d = orthogonalPath(fromPos, fromType, fromStoreName, toPos, toType, toStoreName);
  const anchor = chipAnchor(fromPos, fromType, fromStoreName, toPos, toType, toStoreName);

  const displayLabel = truncateLabel(label, CHIP_MAX_CHARS);
  const chipW = Math.max(measureText(displayLabel, CHIP_FONT), 40);

  return (
    <g>
      {label && <title>{label}</title>}
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={sw}
        strokeDasharray={dashArray}
        markerEnd={`url(#${markerId})`}
      />
      {label && (
        <g>
          <rect
            x={anchor.x - chipW / 2} y={anchor.y - CHIP_H / 2}
            width={chipW} height={CHIP_H} rx={CHIP_RX}
            fill={C.chipBg} stroke={chipStroke}
          />
          <text
            x={anchor.x} y={anchor.y + CHIP_FONT / 2 - 1}
            fill={chipTextFill}
            fontSize={CHIP_FONT}
            textAnchor="middle"
          >
            {displayLabel}
          </text>
        </g>
      )}
    </g>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export type FlowDiagramSvgProps = {
  diagram: FlowDiagram;
  onDrill?: (processId: string) => void;
  onReady?: () => void;
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
};

export function FlowDiagramSvg({
  diagram,
  onDrill,
  onReady,
  savedPositions,
  onPositionsChange,
  onViewChange,
  onRegisterPanTo,
}: FlowDiagramSvgProps) {
  const { nodes, edges, positions: bandedPositions, storeNums } = buildFlowData(diagram);

  // Build a quick lookup: nodeId → node metadata. Memoized so it only
  // rebuilds when the diagram (and thus `nodes`) changes, not every render.
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // Merge banded positions with any saved overrides.
  // savedPositions keys use node ids; banded positions use the same ids.
  const initialPositions: Map<string, NodePos> = new Map(bandedPositions);
  if (savedPositions) {
    for (const [id, saved] of Object.entries(savedPositions)) {
      if (initialPositions.has(id)) {
        initialPositions.set(id, { x: saved.x, y: saved.y });
      }
    }
  }

  // ── State ────────────────────────────────────────────────────────────────

  // Node positions (world space). Mutable during drag; triggers re-render on change.
  const [positions, setPositions] = useState<Map<string, NodePos>>(initialPositions);

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
    const storeName = node.nodeType === 'store' ? (node.storeName ?? '') : undefined;
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
      const storeName = node.nodeType === 'store' ? (node.storeName ?? '') : undefined;
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
  // We capture scale via a ref so the closure always has the latest value.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

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

  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
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

  function onSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
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

      if (movedEnough && nodeId && onPositionsChange) {
        // Debounce-save: cancel previous timer, schedule new one.
        if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          // Snapshot current positions and report them.
          setPositions(current => {
            const posMap: PositionMap = {};
            for (const [id, pos] of current) posMap[id] = { x: pos.x, y: pos.y };
            onPositionsChange(posMap);
            return current;
          });
        }, 400);
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

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
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

  // ── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      style={{ display: 'block', background: C.canvas, touchAction: 'none' }}
      data-ignatius="flow-svg"
      onPointerDown={onSvgPointerDown}
      onPointerMove={onSvgPointerMove}
      onPointerUp={onSvgPointerUp}
      onPointerCancel={onSvgPointerCancel}
      onWheel={onWheel}
    >
      <defs>
        <marker id="arrowWrite" markerWidth={10} markerHeight={10} refX={7.5} refY={3.5}
          orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L8,3.5 L0,7 Z" fill={C.edgeWrite} />
        </marker>
        <marker id="arrowRead" markerWidth={10} markerHeight={10} refX={7.5} refY={3.5}
          orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L8,3.5 L0,7 Z" fill={C.edgeRead} />
        </marker>
      </defs>

      {/*
        Inner group: pan and zoom are applied as a CSS transform in vb space.
        translate(tx, ty) moves the world origin; scale(scale) zooms around it.
        The SVG viewBox stays fixed; only this group moves.
      */}
      <g transform={`translate(${tx},${ty}) scale(${scale})`}>
        {/* Edges first (under nodes) */}
        {edges.map(edge => {
          const fromNode = nodeById.get(edge.source);
          const toNode = nodeById.get(edge.target);
          if (!fromNode || !toNode) return null;
          const fromPos = positions.get(edge.source);
          const toPos = positions.get(edge.target);
          if (!fromPos || !toPos) return null;
          const fromStoreName = fromNode.nodeType === 'store' ? fromNode.storeName : undefined;
          const toStoreName = toNode.nodeType === 'store' ? toNode.storeName : undefined;
          return (
            <EdgeLine
              key={edge.id}
              fromPos={fromPos}
              fromType={fromNode.nodeType}
              fromStoreName={fromStoreName}
              toPos={toPos}
              toType={toNode.nodeType}
              toStoreName={toStoreName}
              label={edge.label}
              isRead={edge.isRead}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map(node => {
          const pos = positions.get(node.id);
          if (!pos) return null;

          if (node.nodeType === 'process') {
            const processId = node.processId ?? node.id;
            const hasSubDfd = node.hasSubDfd ?? false;
            return (
              <g
                key={node.id}
                onPointerDown={e => onNodePointerDown(e, node.id, hasSubDfd, processId)}
              >
                <ProcessNode
                  id={processId}
                  label={node.label}
                  pos={pos}
                  num={diagram.processes.find(p => p.id === node.processId)?.dottedNumber ?? '?'}
                  hasSubDfd={hasSubDfd}
                />
              </g>
            );
          }

          if (node.nodeType === 'external') {
            return (
              <g
                key={node.id}
                onPointerDown={e => onNodePointerDown(e, node.id, false, '')}
              >
                <ExternalNode label={node.label} pos={pos} />
              </g>
            );
          }

          if (node.nodeType === 'store') {
            const storeId = node.id;
            const num = storeNums.get(storeId) ?? 0;
            return (
              <g
                key={node.id}
                onPointerDown={e => onNodePointerDown(e, node.id, false, '')}
              >
                <StoreNode
                  storeNum={num}
                  storeName={node.storeName ?? node.label}
                  pos={pos}
                  isShared={node.shared ?? false}
                />
              </g>
            );
          }

          return null;
        })}
      </g>
    </svg>
  );
}
