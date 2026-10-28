import type { MermaidStyle } from '../../theme/mermaid-theme';

const PENDING = '.mermaid-diagram:not([data-rendered])';

let loading: Promise<IgnatiusMermaid> | null = null;
let renderCount = 0;

// React 19 rewrites a body's innerHTML on every re-render of its card, putting the placeholder back;
// reusing the last SVG for that source, synchronously, keeps it from flashing or shifting the layout.
const svgBySource = new Map<string, { id: string; svg: string }>();
let cachedStyle = '';

function nextRenderId(): string {
  renderCount += 1;
  return `ignatius-mermaid-${renderCount}`;
}

// Mermaid scopes the SVG's styles and marker ids by its render id, so each copy needs its own.
function withFreshId(cached: { id: string; svg: string }): string {
  return cached.svg.replace(new RegExp(`${cached.id}(?!\\d)`, 'g'), nextRenderId());
}

/** The Mermaid API: inlined by an export, or fetched once from the live server. */
export function loadMermaid(): Promise<IgnatiusMermaid> {
  const loaded = window.__IGNATIUS_MERMAID__;
  if (loaded) return Promise.resolve(loaded);
  if (window.__IGNATIUS_MODE__ !== 'live') return Promise.reject(new Error('Mermaid is not included in this export.'));
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/static/mermaid.js';
    script.onload = () => {
      const mermaid = window.__IGNATIUS_MERMAID__;
      if (mermaid) resolve(mermaid);
      else reject(new Error('/static/mermaid.js loaded but did not register Mermaid.'));
    };
    script.onerror = () => reject(new Error('Could not load /static/mermaid.js.'));
    document.head.appendChild(script);
  });
  return loading;
}

function pruneCache(root: ParentNode): void {
  const live = new Set(
    Array.from(root.querySelectorAll<HTMLElement>('.mermaid-diagram')).map(el => el.dataset.source ?? el.textContent ?? ''),
  );
  for (const source of svgBySource.keys()) {
    if (!live.has(source)) svgBySource.delete(source);
  }
}

function isDiamond(polygon: SVGPolygonElement): boolean {
  const pts = Array.from(polygon.points);
  const [top, right, bottom, left] = pts;
  if (pts.length !== 4 || !top || !right || !bottom || !left) return false;
  return top.x === bottom.x && right.y === left.y;
}

// Mermaid marks no node with its shape. A decision is the only 4-point polygon with axis-aligned
// diagonals; a store (cylinder) the only node drawn as a bare `path.outer-path`.
function tagFlowchartShapes(el: HTMLElement): void {
  for (const node of Array.from(el.querySelectorAll('g.node[id*="-flowchart-"]'))) {
    const outline = node.firstElementChild;
    if (outline instanceof SVGPolygonElement && isDiamond(outline)) node.classList.add('ignatius-decision');
    if (outline instanceof SVGPathElement && outline.classList.contains('outer-path')) node.classList.add('ignatius-store');
  }
}

/** The `.mermaid-diagram svg` padding plus border in src/app/styles.css. */
const CANVAS_INSET = 13;

// Mermaid caps the svg at its natural width inline. The panel spans its container instead, so the
// cap moves to height: the drawing never scales past 1:1 and preserveAspectRatio centres it.
function fitPanel(el: HTMLElement): void {
  const svg = el.querySelector('svg');
  const box = svg?.viewBox.baseVal;
  if (!svg || !box?.width) return;
  const natural = Number.parseFloat(svg.style.maxWidth) || box.width;
  svg.style.maxWidth = '';
  svg.removeAttribute('preserveAspectRatio');
  svg.style.maxHeight = `${(box.height * natural) / box.width + CANVAS_INSET * 2}px`;
}

function showSvg(el: HTMLElement, source: string, svg: string): void {
  el.dataset.source = source;
  el.classList.remove('mermaid-error');
  el.innerHTML = svg;
  fitPanel(el);
  tagFlowchartShapes(el);
}

function showError(el: HTMLElement, source: string, err: unknown): void {
  el.dataset.source = source;
  const pre = document.createElement('pre');
  pre.textContent = source;
  const message = document.createElement('div');
  message.className = 'mermaid-error-message';
  message.textContent = err instanceof Error ? err.message : String(err);
  el.classList.add('mermaid-error');
  el.replaceChildren(pre, message);
}

/** Render every visible, unrendered diagram under `root`. Hidden ones wait for a later
 *  pass: Mermaid measures text, and a `display:none` subtree measures 0. */
export async function renderMermaidIn(root: ParentNode, style: MermaidStyle): Promise<void> {
  const visible = Array.from(root.querySelectorAll<HTMLElement>(PENDING)).filter(el => el.offsetParent !== null);
  if (visible.length === 0) return;

  const styleKey = JSON.stringify(style);
  if (styleKey !== cachedStyle) {
    svgBySource.clear();
    cachedStyle = styleKey;
  }

  const pending: { el: HTMLElement; source: string }[] = [];
  for (const el of visible) {
    // Claimed before the first await so an overlapping pass skips it.
    el.setAttribute('data-rendered', '');
    // Read before the swap and kept after it, so a theme change can render the source again.
    const source = el.dataset.source ?? el.textContent ?? '';
    const cached = svgBySource.get(source);
    if (cached) showSvg(el, source, withFreshId(cached));
    else pending.push({ el, source });
  }
  pruneCache(root);
  if (pending.length === 0) return;

  let mermaid: IgnatiusMermaid;
  try {
    mermaid = await loadMermaid();
  } catch (err) {
    for (const { el, source } of pending) showError(el, source, err);
    return;
  }

  // Mermaid 12 wraps flowchart labels at 120px, which splits short bold labels mid-word.
  // Actor names take their weight inline from config, out of themeCSS's reach.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    look: 'classic',
    flowchart: { wrappingWidth: 200 },
    sequence: { actorFontWeight: 600 },
    ...style,
  });
  for (const { el, source } of pending) {
    const id = nextRenderId();
    try {
      const { svg } = await mermaid.render(id, source);
      if (cachedStyle === styleKey) svgBySource.set(source, { id, svg });
      showSvg(el, source, svg);
    } catch (err) {
      showError(el, source, err);
    }
  }
}

/** Render every diagram under `root` again, e.g. with another theme mode's variables. */
export function rerenderAll(root: ParentNode, style: MermaidStyle): Promise<void> {
  for (const el of Array.from(root.querySelectorAll('.mermaid-diagram[data-rendered]'))) el.removeAttribute('data-rendered');
  return renderMermaidIn(root, style);
}
