import { useEffect, useRef } from 'react';
import type { SpotlightConnection } from '../../logic/spotlight';
import type { FlowSpotlightConnection } from '../../logic/flow-spotlight';
import { INHERITED_IDENTITY, type InheritedConnection } from '../../logic/spotlight-inherited';
import { separateSpotlightLines, type LineDirection } from '../../logic/spotlight-lines';

/**
 * Map an inherited connection's bundle direction to the per-line direction set
 * that `separateSpotlightLines` consumes. A `both` connection fans into one
 * out + one in line; a single-direction connection is one line. Identity links
 * carry `both`, so they fan into two faint lines (the shared-key relationship
 * has no inherent direction).
 */
function inheritedDirections(direction: 'out' | 'in' | 'both'): LineDirection[] {
  if (direction === 'both') return ['out', 'in'];
  return [direction];
}

/**
 * Human label for an inherited connection's provenance pill: identity links
 * read "shared key"; transitive relationships read "via <basetype>".
 */
function inheritedViaLabel(via: string): string {
  return via === INHERITED_IDENTITY ? 'shared key' : `via ${via}`;
}

/**
 * SpotlightOverlay — leader-line SVG overlay + off-screen chips for the Dictionary browse lens.
 *
 * Renders a position:fixed <svg> spanning the viewport plus a chips container div.
 *
 * For each on-screen FK connection of the active entity, the SVG draws a SOLID path:
 *  - Direction-coded stroke color (--spotlight-line-out / --spotlight-line-in)
 *  - Arrowhead: far end for 'out', near end for 'in', both ends for 'both'
 *  - Predicate pill at the midpoint: fwd for out edges, rev for in edges
 *  - Cardinality chip per edge: "${cardinality.parent} → ${cardinality.child}" (always parent-first)
 *
 * For each on-screen flow connection (CP12), the SVG draws a DASHED path:
 *  - Stroke color --spotlight-line-flow (distinct from FK colors)
 *  - Arrowhead points to the data SINK: out = arrowhead at far end, in = arrowhead at near end
 *  - Data payload label pill at midpoint (no cardinality chip)
 *  - Target card lookup works for entity cards (data-entity-id) and flow-node cards (data-flow-token)
 *
 * For each off-screen connection (target card outside the scrollport), the chips container
 * renders a clickable chip overlay on the active card showing:
 *  - ↑/↓ arrow glyph (by target vertical position relative to the scrollport)
 *  - Entity/node name
 *  - Predicate text (FK) or data payload (flow)
 * Clicking a chip scrolls the target card into view (smooth, center) and flashes it.
 *
 * Anchors are re-measured from real card rects every rAF-throttled frame, driven by:
 *  - ResizeObserver on the grid container (grid relayouts)
 *  - window resize
 *  - scroll events on the .dict-view scrollport
 *
 * Off-screen connections skip the SVG line; they appear as chips instead.
 * The SVG is pointer-events:none. The chips container has pointer-events:auto only on chips.
 */

type Line = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  direction: 'out' | 'in' | 'both';
  connection: SpotlightConnection;
  /** Whether the anchor edges face each other horizontally or vertically. */
  anchor: 'horizontal' | 'vertical';
};

type ComputedLine = Line & {
  midX: number;
  midY: number;
};

/** A flow line is similar but carries a FlowSpotlightConnection and no cardinality. */
type FlowLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  direction: 'out' | 'in' | 'both';
  connection: FlowSpotlightConnection;
  anchor: 'horizontal' | 'vertical';
  midX: number;
  midY: number;
};

/**
 * An inherited line (CP7, #9) carries an InheritedConnection and a `via`
 * provenance marker. Drawn DOTTED in --spotlight-line-inherited, distinct from
 * direct FK (solid) and flow (dashed) lines.
 */
type InheritedLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  direction: 'out' | 'in' | 'both';
  connection: InheritedConnection;
  anchor: 'horizontal' | 'vertical';
  midX: number;
  midY: number;
};

/**
 * Resolve the DOM card element for a connection's otherCardId.
 * Entity cards: data-entity-id="<id>" (no colon in id).
 * Flow-node cards: data-flow-token="<kind>:<name>" (contains colon).
 */
function resolveOtherCard(otherCardId: string): HTMLElement | null {
  if (otherCardId.includes(':')) {
    return document.querySelector<HTMLElement>(
      `.dict-grid-card[data-flow-token="${CSS.escape(otherCardId)}"]`,
    );
  }
  return document.querySelector<HTMLElement>(
    `.dict-grid-card[data-entity-id="${CSS.escape(otherCardId)}"]`,
  );
}

/**
 * Shared geometry: given two card rects, compute the facing-edge anchor points and
 * the bezier control magnitude. Returns the line geometry or null if cards overlap
 * or are coincident.
 */
function computeAnchor(
  activeRect: DOMRect,
  otherRect: DOMRect,
): { x1: number; y1: number; x2: number; y2: number; anchor: 'horizontal' | 'vertical' } | null {
  const activeCenterX = activeRect.left + activeRect.width / 2;
  const otherCenterX = otherRect.left + otherRect.width / 2;
  const activeCenterY = activeRect.top + activeRect.height / 2;
  const otherCenterY = otherRect.top + otherRect.height / 2;

  const dxCenter = Math.abs(otherCenterX - activeCenterX);
  const dyCenter = Math.abs(otherCenterY - activeCenterY);

  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;
  let anchor: 'horizontal' | 'vertical';

  if (dyCenter > dxCenter) {
    anchor = 'vertical';
    x1 = activeCenterX;
    x2 = otherCenterX;
    if (otherCenterY >= activeCenterY) {
      y1 = activeRect.bottom;
      y2 = otherRect.top;
    } else {
      y1 = activeRect.top;
      y2 = otherRect.bottom;
    }
  } else {
    anchor = 'horizontal';
    y1 = activeCenterY;
    y2 = otherCenterY;
    if (otherCenterX >= activeCenterX) {
      x1 = activeRect.right;
      x2 = otherRect.left;
    } else {
      x1 = activeRect.left;
      x2 = otherRect.right;
    }
  }

  return { x1, y1, x2, y2, anchor };
}

function computeLines(
  activeId: string,
  connections: SpotlightConnection[],
  scrollportRect: DOMRect,
): ComputedLine[] {
  const activeEl = document.querySelector<HTMLElement>(
    `.dict-grid-card[data-entity-id="${CSS.escape(activeId)}"]`,
  );
  if (activeEl === null) return [];

  const activeRect = activeEl.getBoundingClientRect();

  const result: ComputedLine[] = [];

  for (const conn of connections) {
    const otherEl = document.querySelector<HTMLElement>(
      `.dict-grid-card[data-entity-id="${CSS.escape(conn.otherId)}"]`,
    );
    if (otherEl === null) continue;

    const otherRect = otherEl.getBoundingClientRect();

    // Skip if the connected card's rect doesn't intersect the scrollport.
    if (
      otherRect.bottom < scrollportRect.top ||
      otherRect.top > scrollportRect.bottom ||
      otherRect.right < scrollportRect.left ||
      otherRect.left > scrollportRect.right
    ) {
      continue;
    }

    const geom = computeAnchor(activeRect, otherRect);
    if (geom === null) continue;

    const { x1, y1, x2, y2, anchor } = geom;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    result.push({ x1, y1, x2, y2, direction: conn.direction, connection: conn, anchor, midX, midY });
  }

  return result;
}

/**
 * Compute flow lines for the active card's flow connections (CP12).
 * The active card may be an entity card (no colon in activeId) or a flow-node card.
 */
function computeFlowLines(
  activeId: string,
  flowConnections: FlowSpotlightConnection[],
  scrollportRect: DOMRect,
): FlowLine[] {
  // Resolve the active card element — entity or flow-node.
  const activeEl = activeId.includes(':')
    ? document.querySelector<HTMLElement>(`.dict-grid-card[data-flow-token="${CSS.escape(activeId)}"]`)
    : document.querySelector<HTMLElement>(`.dict-grid-card[data-entity-id="${CSS.escape(activeId)}"]`);
  if (activeEl === null) return [];

  const activeRect = activeEl.getBoundingClientRect();
  const result: FlowLine[] = [];

  for (const conn of flowConnections) {
    const otherEl = resolveOtherCard(conn.otherCardId);
    if (otherEl === null) continue;

    const otherRect = otherEl.getBoundingClientRect();

    // Skip if the other card is outside the scrollport.
    if (
      otherRect.bottom < scrollportRect.top ||
      otherRect.top > scrollportRect.bottom ||
      otherRect.right < scrollportRect.left ||
      otherRect.left > scrollportRect.right
    ) {
      continue;
    }

    const geom = computeAnchor(activeRect, otherRect);
    if (geom === null) continue;

    const { x1, y1, x2, y2, anchor } = geom;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    result.push({ x1, y1, x2, y2, direction: conn.direction, connection: conn, anchor, midX, midY });
  }

  return result;
}

/**
 * Compute inherited lines for the active card's inherited connections (CP7, #9).
 * Inherited connections only apply to entity cards (a subtype member / basetype
 * is an ERD entity); the other card is always an entity too.
 */
function computeInheritedLines(
  activeId: string,
  inheritedConnections: InheritedConnection[],
  scrollportRect: DOMRect,
): InheritedLine[] {
  const activeEl = document.querySelector<HTMLElement>(
    `.dict-grid-card[data-entity-id="${CSS.escape(activeId)}"]`,
  );
  if (activeEl === null) return [];

  const activeRect = activeEl.getBoundingClientRect();
  const result: InheritedLine[] = [];

  for (const conn of inheritedConnections) {
    const otherEl = document.querySelector<HTMLElement>(
      `.dict-grid-card[data-entity-id="${CSS.escape(conn.otherId)}"]`,
    );
    if (otherEl === null) continue;

    const otherRect = otherEl.getBoundingClientRect();

    // Skip if the connected card's rect doesn't intersect the scrollport.
    if (
      otherRect.bottom < scrollportRect.top ||
      otherRect.top > scrollportRect.bottom ||
      otherRect.right < scrollportRect.left ||
      otherRect.left > scrollportRect.right
    ) {
      continue;
    }

    const geom = computeAnchor(activeRect, otherRect);
    if (geom === null) continue;

    const { x1, y1, x2, y2, anchor } = geom;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    result.push({ x1, y1, x2, y2, direction: conn.direction, connection: conn, anchor, midX, midY });
  }

  return result;
}

/** Chip data for a single off-screen FK connection. */
type ChipData = {
  kind: 'fk';
  conn: SpotlightConnection;
  /** ↑ if target is above the scrollport, ↓ if below. */
  arrow: '↑' | '↓';
  /** Entity name of the connected node. */
  name: string;
  /** Predicate label: fwd for out direction, rev for in. */
  predicate: string;
};

/** Chip data for a single off-screen flow connection. */
type FlowChipData = {
  kind: 'flow';
  conn: FlowSpotlightConnection;
  arrow: '↑' | '↓';
  /** Display name of the connected card (otherCardId). */
  name: string;
  /** Data payload label. */
  payload: string;
};

/** Compute chip data for FK connections not represented as on-screen lines. */
function computeChips(
  connections: SpotlightConnection[],
  onScreenOtherIds: ReadonlySet<string>,
  scrollportRect: DOMRect,
): ChipData[] {
  const chips: ChipData[] = [];
  for (const conn of connections) {
    if (onScreenOtherIds.has(conn.otherId)) continue;

    const el = document.querySelector<HTMLElement>(
      `.dict-grid-card[data-entity-id="${CSS.escape(conn.otherId)}"]`,
    );
    // Absent-card guard: never render a chip for a card that isn't in the grid DOM.
    if (el === null) continue;

    const rect = el.getBoundingClientRect();

    let arrow: '↑' | '↓' = '↓';
    const cardCenterY = rect.top + rect.height / 2;
    const scrollportCenterY = scrollportRect.top + scrollportRect.height / 2;
    arrow = cardCenterY < scrollportCenterY ? '↑' : '↓';

    let predicate: string;
    if (conn.direction === 'both') {
      const firstOut = conn.edges.find(e => e.direction === 'out');
      const firstIn = conn.edges.find(e => e.direction === 'in');
      predicate = firstOut !== undefined && firstIn !== undefined
        ? `${firstOut.predicate.fwd} ⇄ ${firstIn.predicate.rev}`
        : (firstOut?.predicate.fwd ?? firstIn?.predicate.rev ?? '');
    } else {
      const firstEdge = conn.edges[0];
      predicate = firstEdge !== undefined
        ? (conn.direction === 'in' ? firstEdge.predicate.rev : firstEdge.predicate.fwd)
        : '';
    }

    chips.push({ kind: 'fk', conn, arrow, name: conn.otherId, predicate });
  }
  return chips;
}

/** Compute chip data for flow connections not represented as on-screen lines. */
function computeFlowChips(
  flowConnections: FlowSpotlightConnection[],
  onScreenFlowIds: ReadonlySet<string>,
  scrollportRect: DOMRect,
): FlowChipData[] {
  const chips: FlowChipData[] = [];
  for (const conn of flowConnections) {
    if (onScreenFlowIds.has(conn.otherCardId)) continue;

    const otherEl = resolveOtherCard(conn.otherCardId);
    // Absent-card guard: never render a chip for a card that isn't in the grid DOM
    // (e.g. a search-hidden card, or a store not yet in the grid). This is the safety
    // net that prevents dead "Scroll to X" chips — after CP18 every flow-referenced
    // store is a grid card, so this only fires for search-hidden cards.
    if (otherEl === null) continue;

    const rect = otherEl.getBoundingClientRect();

    let arrow: '↑' | '↓' = '↓';
    const cardCenterY = rect.top + rect.height / 2;
    const scrollportCenterY = scrollportRect.top + scrollportRect.height / 2;
    arrow = cardCenterY < scrollportCenterY ? '↑' : '↓';

    // Data payload: join all edges' data labels.
    const seen = new Set<string>();
    const payloads: string[] = [];
    for (const edge of conn.edges) {
      if (!seen.has(edge.data)) { seen.add(edge.data); payloads.push(edge.data); }
    }
    const payload = payloads.join(', ');

    // Display name: for entity cards (no colon) use the bare id; for flow-node cards strip the kind prefix.
    const name = conn.otherCardId.includes(':')
      ? conn.otherCardId.slice(conn.otherCardId.indexOf(':') + 1)
      : conn.otherCardId;

    chips.push({ kind: 'flow', conn, arrow, name, payload });
  }
  return chips;
}

/** Chip data for a single off-screen inherited connection (CP7). */
type InheritedChipData = {
  kind: 'inherited';
  conn: InheritedConnection;
  arrow: '↑' | '↓';
  /** Entity name of the connected node. */
  name: string;
  /** Provenance label: "shared key" or "via <basetype>". */
  via: string;
};

/** Compute chip data for inherited connections not represented as on-screen lines (CP7). */
function computeInheritedChips(
  inheritedConnections: InheritedConnection[],
  onScreenInheritedIds: ReadonlySet<string>,
  scrollportRect: DOMRect,
): InheritedChipData[] {
  const chips: InheritedChipData[] = [];
  for (const conn of inheritedConnections) {
    if (onScreenInheritedIds.has(conn.otherId)) continue;

    const el = document.querySelector<HTMLElement>(
      `.dict-grid-card[data-entity-id="${CSS.escape(conn.otherId)}"]`,
    );
    // Absent-card guard: never render a chip for a card not in the grid DOM.
    if (el === null) continue;

    const rect = el.getBoundingClientRect();

    const cardCenterY = rect.top + rect.height / 2;
    const scrollportCenterY = scrollportRect.top + scrollportRect.height / 2;
    const arrow: '↑' | '↓' = cardCenterY < scrollportCenterY ? '↑' : '↓';

    chips.push({ kind: 'inherited', conn, arrow, name: conn.otherId, via: inheritedViaLabel(conn.via) });
  }
  return chips;
}

export function SpotlightOverlay({
  activeId,
  connections,
  flowConnections,
  inheritedConnections,
  labelHoverCardId,
  gridContainerRef,
}: {
  // activeId is always a non-null string when this component is mounted;
  // the parent only renders SpotlightOverlay when a spotlight is active.
  activeId: string;
  connections: SpotlightConnection[];
  flowConnections: FlowSpotlightConnection[];
  /** CP7 (#9): inherited 1:1 key-inheritance connections — drawn dotted, distinct. */
  inheritedConnections: InheritedConnection[];
  /**
   * CP14: The card id currently hovered by the pointer among connected (lit) cards.
   * Null = no connected card is hovered → NO pills rendered (lines only).
   * Non-null = render pills only for the connection(s) to this card id.
   * Distinct from activeId / hoverId — does not change the active spotlight node.
   */
  labelHoverCardId: string | null;
  gridContainerRef: React.RefObject<HTMLElement | null>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const NS = 'http://www.w3.org/2000/svg';

    function renderPredicatePill(
      svg: SVGSVGElement,
      line: ComputedLine,
      colorVar: string,
    ) {
      const { connection, midX, midY } = line;

      const labels: { text: string; cardinality: string }[] = [];
      for (const edge of connection.edges) {
        const text = edge.direction === 'out' ? edge.predicate.fwd : edge.predicate.rev;
        const cardinality = `${edge.cardinality.parent} → ${edge.cardinality.child}`;
        labels.push({ text, cardinality });
      }

      if (labels.length === 0) return;

      const CHAR_W = 7;
      const LINE_H = 18;
      const PILL_PAD_X = 10;
      const PILL_PAD_Y = 4;

      const rowWidths = labels.map(l => (l.text.length + l.cardinality.length + 3) * CHAR_W);
      const pillW = Math.max(...rowWidths) + PILL_PAD_X * 2;
      const pillH = labels.length * LINE_H + PILL_PAD_Y * 2;

      const pillX = midX - pillW / 2;
      const pillY = midY - pillH / 2;

      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(pillX));
      rect.setAttribute('y', String(pillY));
      rect.setAttribute('width', String(pillW));
      rect.setAttribute('height', String(pillH));
      rect.setAttribute('rx', '4');
      rect.setAttribute('ry', '4');
      rect.setAttribute('fill', 'var(--color-surface, #1a1a2e)');
      rect.setAttribute('stroke', `var(${colorVar}, #888)`);
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('stroke-opacity', '0.6');
      svg.appendChild(rect);

      labels.forEach((label, i) => {
        const rowY = pillY + PILL_PAD_Y + LINE_H * i + LINE_H * 0.7;

        const predText = document.createElementNS(NS, 'text');
        predText.setAttribute('x', String(pillX + PILL_PAD_X));
        predText.setAttribute('y', String(rowY));
        predText.setAttribute('font-size', '10');
        predText.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif');
        predText.setAttribute('fill', `var(${colorVar}, #888)`);
        predText.setAttribute('font-weight', '600');
        predText.textContent = label.text;
        svg.appendChild(predText);

        const chipText = document.createElementNS(NS, 'text');
        chipText.setAttribute('x', String(pillX + pillW - PILL_PAD_X));
        chipText.setAttribute('y', String(rowY));
        chipText.setAttribute('text-anchor', 'end');
        chipText.setAttribute('font-size', '9');
        chipText.setAttribute('font-family', 'ui-monospace, "SFMono-Regular", Menlo, monospace');
        chipText.setAttribute('fill', 'var(--color-text-muted, #666)');
        chipText.textContent = label.cardinality;
        svg.appendChild(chipText);
      });
    }

    /**
     * Render a data-payload pill for a flow line (no cardinality chip).
     * Bundles all edges' data payloads, deduped, into one pill.
     */
    function renderFlowPill(svg: SVGSVGElement, flowLine: FlowLine) {
      const { connection, midX, midY } = flowLine;
      const colorVar = '--spotlight-line-flow';

      // Collect unique data payloads from all edges.
      const seen = new Set<string>();
      const labels: string[] = [];
      for (const edge of connection.edges) {
        if (!seen.has(edge.data)) {
          seen.add(edge.data);
          labels.push(edge.data);
        }
      }
      if (labels.length === 0) return;

      const CHAR_W = 7;
      const LINE_H = 18;
      const PILL_PAD_X = 10;
      const PILL_PAD_Y = 4;

      const rowWidths = labels.map(l => l.length * CHAR_W);
      const pillW = Math.max(...rowWidths) + PILL_PAD_X * 2;
      const pillH = labels.length * LINE_H + PILL_PAD_Y * 2;

      const pillX = midX - pillW / 2;
      const pillY = midY - pillH / 2;

      const bgRect = document.createElementNS(NS, 'rect');
      bgRect.setAttribute('x', String(pillX));
      bgRect.setAttribute('y', String(pillY));
      bgRect.setAttribute('width', String(pillW));
      bgRect.setAttribute('height', String(pillH));
      bgRect.setAttribute('rx', '4');
      bgRect.setAttribute('ry', '4');
      bgRect.setAttribute('fill', 'var(--color-surface, #1a1a2e)');
      bgRect.setAttribute('stroke', `var(${colorVar}, #a78bfa)`);
      bgRect.setAttribute('stroke-width', '1');
      bgRect.setAttribute('stroke-opacity', '0.6');
      // Dashed border on the pill to match the dashed line style.
      bgRect.setAttribute('stroke-dasharray', '3 2');
      svg.appendChild(bgRect);

      labels.forEach((label, i) => {
        const rowY = pillY + PILL_PAD_Y + LINE_H * i + LINE_H * 0.7;
        const txt = document.createElementNS(NS, 'text');
        txt.setAttribute('x', String(pillX + PILL_PAD_X));
        txt.setAttribute('y', String(rowY));
        txt.setAttribute('font-size', '10');
        txt.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif');
        txt.setAttribute('fill', `var(${colorVar}, #a78bfa)`);
        txt.setAttribute('font-weight', '600');
        txt.textContent = label;
        svg.appendChild(txt);
      });
    }

    /**
     * Render a provenance pill for an inherited line (CP7) — a single-row pill
     * carrying "shared key" (identity link) or "via <basetype>" in the inherited
     * green, with a dotted border to match the dotted line.
     */
    function renderInheritedPill(svg: SVGSVGElement, inheritedLine: InheritedLine) {
      const { connection, midX, midY } = inheritedLine;
      const colorVar = '--spotlight-line-inherited';
      const label = inheritedViaLabel(connection.via);
      if (label.length === 0) return;

      const CHAR_W = 7;
      const LINE_H = 18;
      const PILL_PAD_X = 10;
      const PILL_PAD_Y = 4;

      const pillW = label.length * CHAR_W + PILL_PAD_X * 2;
      const pillH = LINE_H + PILL_PAD_Y * 2;

      const pillX = midX - pillW / 2;
      const pillY = midY - pillH / 2;

      const bgRect = document.createElementNS(NS, 'rect');
      bgRect.setAttribute('x', String(pillX));
      bgRect.setAttribute('y', String(pillY));
      bgRect.setAttribute('width', String(pillW));
      bgRect.setAttribute('height', String(pillH));
      bgRect.setAttribute('rx', '4');
      bgRect.setAttribute('ry', '4');
      bgRect.setAttribute('fill', 'var(--color-surface, #1a1a2e)');
      bgRect.setAttribute('stroke', `var(${colorVar}, #34d399)`);
      bgRect.setAttribute('stroke-width', '1');
      bgRect.setAttribute('stroke-opacity', '0.6');
      // Dotted border on the pill to match the dotted line style.
      bgRect.setAttribute('stroke-dasharray', '2 3');
      svg.appendChild(bgRect);

      const txt = document.createElementNS(NS, 'text');
      txt.setAttribute('x', String(pillX + PILL_PAD_X));
      txt.setAttribute('y', String(pillY + PILL_PAD_Y + LINE_H * 0.7));
      txt.setAttribute('font-size', '10');
      txt.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif');
      txt.setAttribute('fill', `var(${colorVar}, #34d399)`);
      txt.setAttribute('font-weight', '600');
      txt.setAttribute('font-style', 'italic');
      txt.textContent = label;
      svg.appendChild(txt);
    }

    function redrawChips(
      scrollportRect: DOMRect,
      onScreenOtherIds: ReadonlySet<string>,
      onScreenFlowIds: ReadonlySet<string>,
      onScreenInheritedIds: ReadonlySet<string>,
    ) {
      const container = chipsRef.current;
      if (container === null) return;

      while (container.firstChild) container.removeChild(container.firstChild);

      const fkChips = computeChips(connections, onScreenOtherIds, scrollportRect);
      const flowChips = computeFlowChips(flowConnections, onScreenFlowIds, scrollportRect);
      const inheritedChips = computeInheritedChips(inheritedConnections, onScreenInheritedIds, scrollportRect);
      const allChips = [...fkChips, ...flowChips, ...inheritedChips];

      if (allChips.length === 0) {
        container.style.display = 'none';
        return;
      }

      // Position the chips container over the active card.
      const activeEl = activeId.includes(':')
        ? document.querySelector<HTMLElement>(`.dict-grid-card[data-flow-token="${CSS.escape(activeId)}"]`)
        : document.querySelector<HTMLElement>(`.dict-grid-card[data-entity-id="${CSS.escape(activeId)}"]`);
      if (activeEl === null) {
        container.style.display = 'none';
        return;
      }

      const activeRect = activeEl.getBoundingClientRect();

      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '4px';
      container.style.position = 'fixed';
      container.style.left = `${activeRect.left}px`;
      // Clamp to avoid chips going above any fixed bar at the top of the viewport.
      // When the active card is scrolled off the top edge, activeRect.bottom may be
      // negative or zero. Clamp to the bottom of the fixed search bar (if present)
      // so chips don't collide with it. Fall back to 0 if the bar isn't in the DOM.
      const searchBar = document.querySelector<HTMLElement>('.dict-search-bar');
      const minTop = searchBar ? searchBar.getBoundingClientRect().bottom + 4 : 0;
      container.style.top = `${Math.max(minTop, activeRect.bottom + 4)}px`;
      container.style.width = `${activeRect.width}px`;
      container.style.zIndex = '16';

      for (const chip of allChips) {
        const btn = document.createElement('button');
        // Inherited chips carry an extra modifier class + data-kind so they read
        // distinct from FK/flow chips (CP7).
        btn.className = chip.kind === 'inherited'
          ? 'spotlight-chip spotlight-chip--inherited'
          : 'spotlight-chip';
        btn.setAttribute('data-kind', chip.kind);

        const targetId = chip.kind === 'flow' ? chip.conn.otherCardId : chip.conn.otherId;
        btn.setAttribute('data-chip-target', targetId);
        btn.title = `Scroll to ${chip.name}`;

        const arrowSpan = document.createElement('span');
        arrowSpan.className = 'spotlight-chip-arrow';
        arrowSpan.textContent = chip.arrow;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'spotlight-chip-name';
        nameSpan.textContent = chip.name;

        const dotSpan = document.createElement('span');
        dotSpan.className = 'spotlight-chip-sep';
        dotSpan.textContent = ' · ';

        const predSpan = document.createElement('span');
        predSpan.className = 'spotlight-chip-pred';
        predSpan.textContent =
          chip.kind === 'fk' ? chip.predicate
          : chip.kind === 'flow' ? chip.payload
          : chip.via;

        btn.appendChild(arrowSpan);
        btn.appendChild(nameSpan);
        btn.appendChild(dotSpan);
        btn.appendChild(predSpan);

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetCard = resolveOtherCard(targetId);
          if (targetCard === null) return;
          targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetCard.classList.add('dict-grid-card--flash');
          targetCard.addEventListener('animationend', () => {
            targetCard.classList.remove('dict-grid-card--flash');
          }, { once: true });
        });

        container.appendChild(btn);
      }
    }

    function buildPathD(x1: number, y1: number, x2: number, y2: number, anchor: 'horizontal' | 'vertical'): string {
      if (anchor === 'vertical') {
        const dy = Math.abs(y2 - y1);
        const cp = Math.max(dy * 0.45, 40);
        const cpSign = y2 > y1 ? cp : -cp;
        return `M ${x1} ${y1} C ${x1} ${y1 + cpSign}, ${x2} ${y2 - cpSign}, ${x2} ${y2}`;
      } else {
        const dx = Math.abs(x2 - x1);
        const cp = Math.max(dx * 0.45, 40);
        return `M ${x1} ${y1} C ${x1 + (x2 > x1 ? cp : -cp)} ${y1}, ${x2 + (x2 > x1 ? -cp : cp)} ${y2}, ${x2} ${y2}`;
      }
    }

    function redraw() {
      const svg = svgRef.current;
      if (svg === null) return;

      const hasAnyConnections =
        connections.length > 0 || flowConnections.length > 0 || inheritedConnections.length > 0;
      if (!hasAnyConnections) {
        svg.style.display = 'none';
        const chips = chipsRef.current;
        if (chips !== null) chips.style.display = 'none';
        return;
      }

      const scrollport = document.querySelector<HTMLElement>('[data-ignatius="dict-view"]');
      if (scrollport === null) {
        svg.style.display = 'none';
        const chips = chipsRef.current;
        if (chips !== null) chips.style.display = 'none';
        return;
      }

      const scrollportRect = scrollport.getBoundingClientRect();
      const lines = computeLines(activeId, connections, scrollportRect);
      const flowLines = computeFlowLines(activeId, flowConnections, scrollportRect);
      const inheritedLines = computeInheritedLines(activeId, inheritedConnections, scrollportRect);

      // Collect on-screen ids for chip exclusion.
      const onScreenOtherIds = new Set(lines.map(l => l.connection.otherId));
      const onScreenFlowIds = new Set(flowLines.map(l => l.connection.otherCardId));
      const onScreenInheritedIds = new Set(inheritedLines.map(l => l.connection.otherId));

      redrawChips(scrollportRect, onScreenOtherIds, onScreenFlowIds, onScreenInheritedIds);

      if (lines.length === 0 && flowLines.length === 0 && inheritedLines.length === 0) {
        svg.style.display = 'none';
        return;
      }

      svg.style.display = 'block';
      svg.setAttribute('width', String(window.innerWidth));
      svg.setAttribute('height', String(window.innerHeight));

      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const defs = document.createElementNS(NS, 'defs');

      function makeMarker(id: string, colorVar: string, refX: number, orient: string) {
        const marker = document.createElementNS(NS, 'marker');
        marker.setAttribute('id', id);
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', String(refX));
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', orient);
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
        path.setAttribute('fill', `var(${colorVar}, #888)`);
        marker.appendChild(path);
        return marker;
      }

      // FK markers (solid, out=amber, in=teal).
      defs.appendChild(makeMarker('arrow-out-end', '--spotlight-line-out', 9, 'auto'));
      defs.appendChild(makeMarker('arrow-in-start', '--spotlight-line-in', 1, 'auto-start-reverse'));

      // Flow markers (dashed, purple). Direction: out = arrowhead at far end (sink);
      // in = arrowhead at near end (active card is sink, so start of path).
      defs.appendChild(makeMarker('arrow-flow-end', '--spotlight-line-flow', 9, 'auto'));
      defs.appendChild(makeMarker('arrow-flow-start', '--spotlight-line-flow', 1, 'auto-start-reverse'));

      // Inherited markers (dotted, green — CP7). Direction relative to the
      // entity the relationship was inherited through.
      defs.appendChild(makeMarker('arrow-inherited-end', '--spotlight-line-inherited', 9, 'auto'));
      defs.appendChild(makeMarker('arrow-inherited-start', '--spotlight-line-inherited', 1, 'auto-start-reverse'));

      svg.appendChild(defs);

      // Draw FK (solid) lines. CP6 (#2): a `both` or multi-edge bundle is fanned
      // apart into SEPARATE paths — one per edge/direction with offset connection
      // points — so neither the lines nor their arrowheads coincide. A single-edge
      // out/in connection stays one un-offset line. CP14: pills are a second pass.
      for (const line of lines) {
        const directions: LineDirection[] = line.connection.edges.map(e => e.direction);
        const specs = separateSpotlightLines(
          { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2, anchor: line.anchor },
          directions,
        );

        for (const spec of specs) {
          const colorVar = spec.direction === 'in' ? '--spotlight-line-in' : '--spotlight-line-out';
          const d = buildPathD(spec.x1, spec.y1, spec.x2, spec.y2, line.anchor);

          const pathEl = document.createElementNS(NS, 'path');
          pathEl.setAttribute('class', 'spotlight-line');
          pathEl.setAttribute('d', d);
          pathEl.setAttribute('fill', 'none');
          pathEl.setAttribute('stroke', `var(${colorVar}, #888)`);
          pathEl.setAttribute('stroke-width', '1.5');
          pathEl.setAttribute('stroke-opacity', '0.75');
          // Single direction per path → a single arrowhead. Never both ends.
          if (spec.direction === 'out') pathEl.setAttribute('marker-end', 'url(#arrow-out-end)');
          else pathEl.setAttribute('marker-start', 'url(#arrow-in-start)');
          svg.appendChild(pathEl);
        }
        // Pills are rendered in a second pass below (after all paths) to apply
        // collision-avoidance nudging across all pills for the hovered card.
      }

      // Draw flow (dashed) lines. CP6 (#2): same separation as FK lines — flow
      // bundles overlap identically, so a `both`/multi-edge bundle fans into one
      // dashed path per edge/direction. CP14: pills rendered only for hovered card.
      for (const flowLine of flowLines) {
        const directions: LineDirection[] = flowLine.connection.edges.map(e => e.direction);
        const specs = separateSpotlightLines(
          { x1: flowLine.x1, y1: flowLine.y1, x2: flowLine.x2, y2: flowLine.y2, anchor: flowLine.anchor },
          directions,
        );

        for (const spec of specs) {
          const d = buildPathD(spec.x1, spec.y1, spec.x2, spec.y2, flowLine.anchor);

          const pathEl = document.createElementNS(NS, 'path');
          // Both spotlight-line (counted by tests) and spotlight-line--flow (distinguished from FK).
          pathEl.setAttribute('class', 'spotlight-line spotlight-line--flow');
          pathEl.setAttribute('data-kind', 'flow');
          pathEl.setAttribute('d', d);
          pathEl.setAttribute('fill', 'none');
          pathEl.setAttribute('stroke', 'var(--spotlight-line-flow, #a78bfa)');
          pathEl.setAttribute('stroke-width', '1.5');
          pathEl.setAttribute('stroke-opacity', '0.80');
          pathEl.setAttribute('stroke-dasharray', '6 3');
          // Direction: out = active is source → arrowhead at far end (target = sink).
          //            in  = active is sink → arrowhead at near end (start of path).
          if (spec.direction === 'out') pathEl.setAttribute('marker-end', 'url(#arrow-flow-end)');
          else pathEl.setAttribute('marker-start', 'url(#arrow-flow-start)');
          svg.appendChild(pathEl);
        }
      }

      // Draw inherited (dotted, green) lines. CP7 (#9): a connection inherited
      // via 1:1 key-inheritance (shared key). Drawn DOTTED in a distinct green so
      // it never reads as a direct FK (solid) or flow (dashed) line. A `both`
      // connection (identity links + bidirectional inherited rels) fans into two
      // lines via the CP6 separation so they don't overlap.
      for (const inheritedLine of inheritedLines) {
        const directions: LineDirection[] = inheritedDirections(inheritedLine.direction);
        const specs = separateSpotlightLines(
          { x1: inheritedLine.x1, y1: inheritedLine.y1, x2: inheritedLine.x2, y2: inheritedLine.y2, anchor: inheritedLine.anchor },
          directions,
        );

        for (const spec of specs) {
          const d = buildPathD(spec.x1, spec.y1, spec.x2, spec.y2, inheritedLine.anchor);

          const pathEl = document.createElementNS(NS, 'path');
          // spotlight-line (counted by existing tests) + spotlight-line--inherited (distinguished).
          pathEl.setAttribute('class', 'spotlight-line spotlight-line--inherited');
          pathEl.setAttribute('data-kind', 'inherited');
          pathEl.setAttribute('d', d);
          pathEl.setAttribute('fill', 'none');
          pathEl.setAttribute('stroke', 'var(--spotlight-line-inherited, #34d399)');
          pathEl.setAttribute('stroke-width', '1.5');
          pathEl.setAttribute('stroke-opacity', '0.70');
          // Dotted — distinct from solid FK and dashed flow.
          pathEl.setAttribute('stroke-dasharray', '2 4');
          if (spec.direction === 'out') pathEl.setAttribute('marker-end', 'url(#arrow-inherited-end)');
          else pathEl.setAttribute('marker-start', 'url(#arrow-inherited-start)');
          svg.appendChild(pathEl);
        }
      }

      // CP14: Pill rendering — second pass, only for labelHoverCardId.
      // Collect all pills (FK + flow) for the hovered card, then apply a vertical
      // collision-avoidance nudge so bounding boxes don't overlap when multiple
      // pills land at the same midpoint (e.g. a process that reads and writes the
      // same store, or a bundle with both out and in FK edges).
      if (labelHoverCardId !== null) {
        // Gather candidate FK / flow / inherited pills.
        type PillSpec =
          | { kind: 'fk'; line: ComputedLine; colorVar: string }
          | { kind: 'flow'; flowLine: FlowLine }
          | { kind: 'inherited'; inheritedLine: InheritedLine };

        const pillSpecs: PillSpec[] = [];

        for (const line of lines) {
          if (line.connection.otherId === labelHoverCardId) {
            const colorVar = line.direction === 'in' ? '--spotlight-line-in' : '--spotlight-line-out';
            pillSpecs.push({ kind: 'fk', line, colorVar });
          }
        }
        for (const flowLine of flowLines) {
          if (flowLine.connection.otherCardId === labelHoverCardId) {
            pillSpecs.push({ kind: 'flow', flowLine });
          }
        }
        for (const inheritedLine of inheritedLines) {
          if (inheritedLine.connection.otherId === labelHoverCardId) {
            pillSpecs.push({ kind: 'inherited', inheritedLine });
          }
        }

        if (pillSpecs.length > 0) {
          // Estimate pill heights for collision nudging.
          // FK pill: LINE_H per edge + 2*PILL_PAD_Y.
          // Flow pill: LINE_H per unique payload label + 2*PILL_PAD_Y.
          // Inherited pill: single row (LINE_H + 2*PILL_PAD_Y).
          const LINE_H = 18;
          const PILL_PAD_Y = 4;
          const NUDGE_MARGIN = 4; // extra vertical gap between pills

          // Compute base midY per pill spec.
          type PillWithMidY = { spec: PillSpec; baseMidY: number; estHeight: number };
          const pillsWithMid: PillWithMidY[] = pillSpecs.map(spec => {
            if (spec.kind === 'fk') {
              const estHeight = spec.line.connection.edges.length * LINE_H + PILL_PAD_Y * 2;
              return { spec, baseMidY: spec.line.midY, estHeight };
            } else if (spec.kind === 'flow') {
              // Count unique payloads.
              const seen = new Set<string>();
              for (const edge of spec.flowLine.connection.edges) seen.add(edge.data);
              const estHeight = seen.size * LINE_H + PILL_PAD_Y * 2;
              return { spec, baseMidY: spec.flowLine.midY, estHeight };
            } else {
              const estHeight = LINE_H + PILL_PAD_Y * 2;
              return { spec, baseMidY: spec.inheritedLine.midY, estHeight };
            }
          });

          // Sort by baseMidY ascending so nudging is deterministic.
          pillsWithMid.sort((a, b) => a.baseMidY - b.baseMidY);

          // Assign nudged midY values: each pill starts after the previous one ends.
          const nudgedMidYs: number[] = [];
          let nextAllowedTop = -Infinity;
          for (const pill of pillsWithMid) {
            const pillTop = pill.baseMidY - pill.estHeight / 2;
            const adjustedTop = Math.max(pillTop, nextAllowedTop);
            const nudgedMidY = adjustedTop + pill.estHeight / 2;
            nudgedMidYs.push(nudgedMidY);
            nextAllowedTop = adjustedTop + pill.estHeight + NUDGE_MARGIN;
          }

          // Render each pill with its nudged midY.
          pillsWithMid.forEach((pill, i) => {
            const nudgedY = nudgedMidYs[i] ?? pill.baseMidY;
            if (pill.spec.kind === 'fk') {
              const nudgedLine: ComputedLine = { ...pill.spec.line, midY: nudgedY };
              renderPredicatePill(svg, nudgedLine, pill.spec.colorVar);
            } else if (pill.spec.kind === 'flow') {
              const nudgedFlowLine: FlowLine = { ...pill.spec.flowLine, midY: nudgedY };
              renderFlowPill(svg, nudgedFlowLine);
            } else {
              const nudgedInheritedLine: InheritedLine = { ...pill.spec.inheritedLine, midY: nudgedY };
              renderInheritedPill(svg, nudgedInheritedLine);
            }
          });
        }
      }
    }

    function scheduleRedraw() {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        redraw();
      });
    }

    scheduleRedraw();

    const hasAnyConnections =
      connections.length > 0 || flowConnections.length > 0 || inheritedConnections.length > 0;
    if (!hasAnyConnections) return;

    const container = gridContainerRef.current;
    let ro: ResizeObserver | null = null;
    if (container !== null) {
      ro = new ResizeObserver(scheduleRedraw);
      ro.observe(container);
    }

    window.addEventListener('resize', scheduleRedraw);

    const scrollport = document.querySelector<HTMLElement>('[data-ignatius="dict-view"]');
    if (scrollport !== null) {
      scrollport.addEventListener('scroll', scheduleRedraw, { passive: true });
    }

    return () => {
      if (ro !== null) ro.disconnect();
      window.removeEventListener('resize', scheduleRedraw);
      if (scrollport !== null) {
        scrollport.removeEventListener('scroll', scheduleRedraw);
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [activeId, connections, flowConnections, inheritedConnections, labelHoverCardId, gridContainerRef]);

  return (
    <>
      <svg
        ref={svgRef}
        className="spotlight-overlay"
        aria-hidden="true"
      />
      {/* Chips container: position:fixed overlay for off-screen connections.
          Positioned imperatively by redrawChips() on every rAF frame. */}
      <div
        ref={chipsRef}
        className="spotlight-chips-container"
        aria-label="Off-screen connections"
      />
    </>
  );
}
