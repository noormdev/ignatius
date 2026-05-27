import type cytoscape from 'cytoscape';

type Cardinality = '1' | '0..1' | 'many';

const BG = '#0e1116';

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

export function updateMarkers(cy: cytoscape.Core, svg: SVGSVGElement) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const zoom = cy.zoom();
  const scale = Math.min(Math.max(zoom, 0.5), 2.5);

  cy.edges().forEach(edge => {
    if (!edge.visible()) return;
    const parentCard = edge.data('parentCard') as Cardinality;
    const childCard = edge.data('childCard') as Cardinality;
    const identifying = edge.data('identifying') === 'true';
    const color = identifying ? '#8b949e' : '#3d424a';

    const srcPt = edge.renderedSourceEndpoint();
    const tgtPt = edge.renderedTargetEndpoint();

    const dx = tgtPt.x - srcPt.x;
    const dy = tgtPt.y - srcPt.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 40) return;

    const srcAngle = Math.atan2(dy, dx);
    const tgtAngle = Math.atan2(-dy, -dx);

    drawEndMarker(svg, srcPt.x, srcPt.y, srcAngle, parentCard, color, scale);
    drawEndMarker(svg, tgtPt.x, tgtPt.y, tgtAngle, childCard, color, scale);
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
) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${x},${y}) rotate(${angle * 180 / Math.PI}) scale(${scale})`);

  const sw = 1.8;
  const h = 10;
  const sp = 7;
  const cr = 6;
  const fan = 12;
  const forkLen = 14;
  const off = 10; // offset from node edge

  switch (card) {
    case '1': {
      bar(g, off, h, color, sw);
      bar(g, off + sp, h, color, sw);
      break;
    }
    case '0..1': {
      bar(g, off, h, color, sw);
      cir(g, off + sp + cr, cr, color, sw);
      break;
    }
    case 'many': {
      const convX = off + forkLen;
      ln(g, convX, 0, off, 0, color, sw);
      ln(g, convX, 0, off, -fan, color, sw);
      ln(g, convX, 0, off, fan, color, sw);
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

function cir(g: SVGGElement, cx: number, r: number, color: string, sw: number) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  el.setAttribute('cx', `${cx}`);
  el.setAttribute('cy', '0');
  el.setAttribute('r', `${r}`);
  el.setAttribute('fill', BG);
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', `${sw}`);
  g.appendChild(el);
}
