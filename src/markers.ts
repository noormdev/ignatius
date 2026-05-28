import type cytoscape from 'cytoscape';
import type { ThemeConfig, ThemeMode } from './theme-defaults';

type Cardinality = '1' | '0..1' | 'many';

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
    const parentCard = edge.data('parentCard') as Cardinality;
    const childCard = edge.data('childCard') as Cardinality;
    const identifying = edge.data('identifying') === 'true';
    const color = identifying ? p.edgeIdentifying : p.edgeReferential;

    const srcPt = edge.renderedSourceEndpoint();
    const tgtPt = edge.renderedTargetEndpoint();

    const dx = tgtPt.x - srcPt.x;
    const dy = tgtPt.y - srcPt.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 40) return;

    const srcAngle = Math.atan2(dy, dx);
    const tgtAngle = Math.atan2(-dy, -dx);

    drawEndMarker(svg, srcPt.x, srcPt.y, srcAngle, parentCard, color, scale, p.background, theme.spacing.markerOffset);
    drawEndMarker(svg, tgtPt.x, tgtPt.y, tgtAngle, childCard, color, scale, p.background, theme.spacing.markerOffset);
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
) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${x},${y}) rotate(${angle * 180 / Math.PI}) scale(${scale})`);

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
