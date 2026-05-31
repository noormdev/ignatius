import type cytoscape from 'cytoscape';
import type { ThemeConfig, ThemeMode } from './theme-defaults';

type Cardinality = '1' | '0..1' | 'many';

/**
 * Draw ⚠ corner badges on nodes that have validation findings.
 * Called after updateMarkers (or independently) on the same SVG overlay.
 *
 * WHY a separate function: markers.ts owns the SVG overlay; badge rendering
 * needs cy node positions, so it belongs here alongside crow's-foot rendering.
 * Caller passes the set of affected entity ids — no validate.ts import needed.
 */
export function drawWarningBadges(
  cy: cytoscape.Core,
  svg: SVGSVGElement,
  entityIds: Set<string>,
): void {
  if (entityIds.size === 0) return;

  cy.nodes().forEach(node => {
    if (!node.visible()) return;
    if (node.data('cluster') === 'true' || node.data('joiner') === 'true') return;

    const id = node.id();
    if (!entityIds.has(id)) return;

    const bb = node.renderedBoundingBox({});
    if (!bb) return;
    if (!Number.isFinite(bb.x1) || !Number.isFinite(bb.y1)) return;

    // Place badge at top-right corner of the node bounding box
    const cx = bb.x2 - 7;
    const cy2 = bb.y1 + 7;
    const r = 7;

    // Filled red circle background
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', `${cx}`);
    circle.setAttribute('cy', `${cy2}`);
    circle.setAttribute('r', `${r}`);
    circle.setAttribute('fill', '#e05252');
    circle.setAttribute('stroke', '#0e1116');
    circle.setAttribute('stroke-width', '1');
    svg.appendChild(circle);

    // ⚠ text — use a simple "!" for crisp rendering at small size
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', `${cx}`);
    text.setAttribute('y', `${cy2 + 4}`);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#ffffff');
    text.setAttribute('font-size', '9');
    text.setAttribute('font-weight', '700');
    text.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif');
    text.setAttribute('pointer-events', 'none');
    text.textContent = '!';
    svg.appendChild(text);
  });
}

export function createMarkerOverlay(container: HTMLDivElement): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.overflow = 'visible';
  container.style.position = 'relative';
  container.appendChild(svg);
  return svg;
}

export function updateMarkers(cy: cytoscape.Core, svg: SVGSVGElement, theme: ThemeConfig, mode: ThemeMode = 'dark') {
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const p = mode === 'light' ? theme.light : theme.dark;
  const [minScale, maxScale] = theme.spacing.markerScale;
  const zoom = cy.zoom();
  const scale = Math.min(Math.max(zoom, minScale), maxScale);

  cy.edges().forEach(edge => {
    if (!edge.visible()) return;
    // Guard against transient null endpoints (edges whose source/target node
    // has been removed but the edge still iterates, e.g. during teardown or
    // when triggered from cytoscape-navigator's pan callback mid-frame).
    if (edge.source().empty() || edge.target().empty()) return;
    const parentCard = edge.data('parentCard') as Cardinality;
    const childCard = edge.data('childCard') as Cardinality;
    const identifying = edge.data('identifying') === 'true';
    const color = identifying ? p.edgeIdentifying : p.edgeReferential;

    const srcPt = edge.renderedSourceEndpoint();
    const tgtPt = edge.renderedTargetEndpoint();
    if (!srcPt || !tgtPt) return;
    // Cytoscape can return NaN endpoints transiently (mid-layout, hidden
    // compound parents). Skip rather than emit invalid SVG transforms.
    if (!Number.isFinite(srcPt.x) || !Number.isFinite(srcPt.y)) return;
    if (!Number.isFinite(tgtPt.x) || !Number.isFinite(tgtPt.y)) return;

    const dx = tgtPt.x - srcPt.x;
    const dy = tgtPt.y - srcPt.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 40) return;

    const srcAngle = Math.atan2(dy, dx);
    const tgtAngle = Math.atan2(-dy, -dx);

    const faded = edge.hasClass('faded');
    drawEndMarker(svg, srcPt.x, srcPt.y, srcAngle, parentCard, color, scale, p.background, theme.spacing.markerOffset, faded);
    drawEndMarker(svg, tgtPt.x, tgtPt.y, tgtAngle, childCard, color, scale, p.background, theme.spacing.markerOffset, faded);
  });
}

//  Coordinate system after transform:
//    Origin = edge endpoint (at the node boundary)
//    +X = away from entity, along the edge toward the other node
//    +Y = perpendicular (right-hand side of the edge direction)
//
//  We draw symbols at POSITIVE X (into the edge gap created by distance-from-node).
//
//  Crow's foot notation (reading from entity → line):
//    "1"    = two perpendicular bars (||)
//    "0..1" = perpendicular bar then hollow circle (|O)
//    "many" = crow's foot prongs fanning toward entity, converging toward line,
//             then a perpendicular bar (><|)

function drawEndMarker(
  svg: SVGSVGElement,
  x: number, y: number,
  angle: number,
  card: Cardinality,
  color: string,
  scale: number,
  bgColor: string,
  offset: number,
  faded: boolean,
) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${x},${y}) rotate(${angle * 180 / Math.PI}) scale(${scale})`);
  if (faded) g.setAttribute('opacity', '0.3');

  const sw = 1.8;
  const h = 10;
  const sp = 7;
  const cr = 6;
  const fan = 12;
  const forkLen = 14;

  switch (card) {
    case '1': {
      bar(g, offset, h, color, sw);
      bar(g, offset + sp, h, color, sw);
      break;
    }
    case '0..1': {
      bar(g, offset, h, color, sw);
      cir(g, offset + sp + cr, cr, color, sw, bgColor);
      break;
    }
    case 'many': {
      const convX = offset + forkLen;
      ln(g, convX, 0, offset, 0, color, sw);
      ln(g, convX, 0, offset, -fan, color, sw);
      ln(g, convX, 0, offset, fan, color, sw);
      bar(g, convX + 4, h, color, sw);
      break;
    }
  }

  svg.appendChild(g);
}

function ln(g: SVGGElement, x1: number, y1: number, x2: number, y2: number, color: string, sw: number) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  el.setAttribute('x1', `${x1}`);
  el.setAttribute('y1', `${y1}`);
  el.setAttribute('x2', `${x2}`);
  el.setAttribute('y2', `${y2}`);
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', `${sw}`);
  el.setAttribute('stroke-linecap', 'round');
  g.appendChild(el);
}

function bar(g: SVGGElement, x: number, half: number, color: string, sw: number) {
  ln(g, x, -half, x, half, color, sw);
}

function cir(g: SVGGElement, cx: number, r: number, color: string, sw: number, bgColor: string) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  el.setAttribute('cx', `${cx}`);
  el.setAttribute('cy', '0');
  el.setAttribute('r', `${r}`);
  el.setAttribute('fill', bgColor);
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', `${sw}`);
  g.appendChild(el);
}
