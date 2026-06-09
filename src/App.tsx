import { useEffect, useLayoutEffect, useMemo, useRef, useState, createElement } from 'react';
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root as ReactRoot } from 'react-dom/client';
import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
import cytoscapeNavigator from 'cytoscape-navigator';
import 'cytoscape-navigator/cytoscape.js-navigator.css';
import { createMarkerOverlay, updateMarkers, drawWarningBadges } from './markers';
import { semanticColors, resolveFlowKindPalette, type ThemeConfig, type ThemeMode, type FlowKindKey, type FlowKindEntry } from './theme-defaults';
import { parseHash, serializeHash, type HashState, type ViewName } from './hash-router';
import { validateModel, RULES } from './validate';
import type { EntityError, GlobalError, RuleId } from './validate';
import { wrapEntityLabel } from './wrap-label';
import { createLayoutStore } from './layout-store';
import type {
  Model,
  ModelNode,
  ModelEdge,
  SubtypeCluster,
  GroupConfig,
} from './parse';
import type {
  FlowDiagram,
  FlowProcess,
  FlowExternal,
  FlowStoreRef,
  FlowEdge,
  FlowEndpoint,
  FlowExample,
} from './flow-parse';
import type { FlowError, FlowValidationResult } from './flow-validate';
import { buildEntityUsageIndex, buildFlowNodeUsageIndex } from './flow-usage-index';
import type { ProcessUsage } from './flow-usage-index';
import { FlowDiagramSvg, DARK_PALETTE, LIGHT_PALETTE } from './flow-view/FlowDiagramSvg';
import type { MinimapData, FlowDiagramSvgProps, FlowPalette } from './flow-view/FlowDiagramSvg';
import { FlowChrome } from './flow-view/FlowChrome';
import type { FlowChromeHandle, BreadcrumbEntry } from './flow-view/FlowChrome';
import type { PositionMap } from './layout-store';

// @ts-expect-error — cytoscape uses `export =` which loses namespace members under bundler resolution
cytoscape.use(elk);

// Graph layout algorithm, toggled at runtime from the FAB menu.
// 'hierarchical' → ELK layered (ranked rows); 'organic' → ELK stress (force-directed).
type LayoutMode = 'hierarchical' | 'organic';

// Place each subtype cluster's members on an arc around their joiner diamond,
// fanning away from the basetype. Keeps basetype/subtype clusters cohesive under
// the organic (stress) layout, which otherwise treats identifying joiner→member
// edges like any other and flings members across the canvas.
//
// Size-aware: neighbour spacing clears the largest member's footprint, so
// multi-line boxes and many-member clusters never collide on the arc. The span
// widens with member count — small clusters stay a tight fan, large ones wrap
// toward a near-full ring (capped just under 2π so the base side stays open).
function fanSubtypeClusters(cy: cytoscape.Core) {
  cy.nodes('[joiner = "true"]').forEach((j) => {
    const jp = j.position();
    const members = cy.edges().filter((e) => e.source().id() === j.id()).map((e) => e.target());
    if (members.length === 0) return;
    const inEdge = cy.edges().filter((e) => e.target().id() === j.id())[0];
    const base = inEdge ? inEdge.source() : null;
    // Fan outward, away from the basetype, so the diamond sits between base and members.
    let baseAngle = Math.PI / 2;
    if (base) {
      const bp = base.position();
      baseAngle = Math.atan2(jp.y - bp.y, jp.x - bp.x);
    }
    const n = members.length;
    const slot = Math.max(...members.map((m) => Math.max(m.outerWidth(), m.outerHeight()))) + 26;
    const span = Math.min(2 * Math.PI * (n / (n + 1)), 0.9 + n * 0.42);
    const gap = span / Math.max(1, n - 1);
    // Radius so the chord between neighbours clears a slot: chord = 2R·sin(gap/2).
    const radius = Math.max(120, slot / 2 / Math.sin(Math.min(Math.PI / 2, gap / 2) || 1));
    members.forEach((m, i) => {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      const angle = baseAngle + t * span;
      m.position({ x: jp.x + radius * Math.cos(angle), y: jp.y + radius * Math.sin(angle) });
    });
  });
}

// Light separating-axis pass to clear residual node overlaps left when two
// nearby clusters' fans land on top of each other. Nudges only overlapping pairs
// apart along their axis of least penetration; converges fast (breaks once a
// pass moves nothing). Skips compound parents (invisible cluster boxes).
function deoverlapNodes(cy: cytoscape.Core, iterations: number) {
  const nodes = cy.nodes().filter((n) => !n.isParent());
  const pad = 30;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const A = nodes[a];
        const B = nodes[b];
        const pa = A.position();
        const pb = B.position();
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const minX = (A.outerWidth() + B.outerWidth()) / 2 + pad;
        const minY = (A.outerHeight() + B.outerHeight()) / 2 + pad;
        if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
          const overlapX = minX - Math.abs(dx);
          const overlapY = minY - Math.abs(dy);
          if (overlapX < overlapY) {
            const shift = ((dx < 0 ? -1 : 1) * overlapX) / 2;
            A.position({ x: pa.x - shift, y: pa.y });
            B.position({ x: pb.x + shift, y: pb.y });
          } else {
            const shift = ((dy < 0 ? -1 : 1) * overlapY) / 2;
            A.position({ x: pa.x, y: pa.y - shift });
            B.position({ x: pb.x, y: pb.y + shift });
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// Push whole subtype-cluster fans (joiner + members) apart so interleaved
// clusters settle into distinct regions, not merely un-overlapped. Works on each
// fan's bounding box; the per-node de-overlap that follows cleans up the
// node-level collisions a coarse shove can introduce.
function separateClusterFans(cy: cytoscape.Core, iterations: number) {
  const fans = cy.nodes('[joiner = "true"]').map((j) => j.outgoers('node').union(j)).filter((fan) => fan.length > 1);
  if (fans.length < 2) return;
  const margin = 45;
  const shiftFan = (fan, dx: number, dy: number) =>
    fan.forEach((n) => { const p = n.position(); n.position({ x: p.x + dx, y: p.y + dy }); });
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let a = 0; a < fans.length; a++) {
      for (let b = a + 1; b < fans.length; b++) {
        const ba = fans[a].boundingBox();
        const bb = fans[b].boundingBox();
        const overlapX = Math.min(ba.x2, bb.x2) - Math.max(ba.x1, bb.x1) + margin;
        const overlapY = Math.min(ba.y2, bb.y2) - Math.max(ba.y1, bb.y1) + margin;
        if (overlapX > 0 && overlapY > 0) {
          const aLeftOfB = ba.x1 + ba.x2 < bb.x1 + bb.x2;
          const aAboveB = ba.y1 + ba.y2 < bb.y1 + bb.y2;
          // Separate along the axis of least penetration (smaller move).
          if (overlapX < overlapY) {
            const s = overlapX / 2;
            shiftFan(fans[a], aLeftOfB ? -s : s, 0);
            shiftFan(fans[b], aLeftOfB ? s : -s, 0);
          } else {
            const s = overlapY / 2;
            shiftFan(fans[a], 0, aAboveB ? -s : s);
            shiftFan(fans[b], 0, aAboveB ? s : -s);
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// Spread a hub's degree-1 satellites angularly so their edges stop smearing into
// one line. Each leaf is repelled — in angle, around its hub — by every other
// neighbour edge until it clears a minimum gap; distance from the hub is kept,
// so this is a pure rotation that never changes how far a leaf sits.
function separateLeafFan(cy: cytoscape.Core, iterations: number) {
  const minGap = 0.42;
  const step = 0.5;
  const movable = (n) => n.parent().empty() && n.data('joiner') !== 'true';
  const isLeaf = (n) => n.degree(false) === 1 && movable(n);
  for (let it = 0; it < iterations; it++) {
    cy.nodes().forEach((h) => {
      if (!movable(h)) return;
      const nbrs = h.openNeighborhood().nodes();
      if (nbrs.length < 2) return;
      const hp = h.position();
      const entries = nbrs.map((nb) => ({ nb, ang: Math.atan2(nb.position().y - hp.y, nb.position().x - hp.x), leaf: isLeaf(nb) }));
      entries.forEach((e) => {
        if (!e.leaf) return;
        let push = 0;
        entries.forEach((o) => {
          if (o === e) return;
          let d = e.ang - o.ang;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          if (Math.abs(d) < minGap) push += (d >= 0 ? 1 : -1) * (minGap - Math.abs(d));
        });
        if (push !== 0) {
          const p = e.nb.position();
          const dist = Math.hypot(p.x - hp.x, p.y - hp.y);
          const a = e.ang + push * step;
          e.nb.position({ x: hp.x + dist * Math.cos(a), y: hp.y + dist * Math.sin(a) });
        }
      });
    });
  }
}

// Triangulate a degree-2 pass-through node that sits on the line between its two
// neighbours: nudge it perpendicular off the line so its two edges stop
// overlapping into one. Only fires when the node is between the neighbours
// (projection within the segment) and closer to the line than the clearance.
function decollinearNodes(cy: cytoscape.Core) {
  const clearance = 80;
  cy.nodes().forEach((n) => {
    if (n.data('joiner') === 'true' || !n.parent().empty() || n.degree(false) !== 2) return;
    const nb = n.openNeighborhood().nodes();
    if (nb.length !== 2) return;
    const A = nb[0].position(), B = nb[1].position(), P = n.position();
    const abx = B.x - A.x, aby = B.y - A.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1) return;
    const t = ((P.x - A.x) * abx + (P.y - A.y) * aby) / len2;
    if (t < 0.15 || t > 0.85) return;
    const projx = A.x + t * abx, projy = A.y + t * aby;
    const perpx = P.x - projx, perpy = P.y - projy;
    const perpDist = Math.hypot(perpx, perpy);
    if (perpDist >= clearance) return;
    const len = Math.sqrt(len2);
    const ux = perpDist > 1 ? perpx / perpDist : -aby / len;
    const uy = perpDist > 1 ? perpy / perpDist : abx / len;
    n.position({ x: projx + ux * clearance, y: projy + uy * clearance });
  });
}

// Post-process a settled organic (stress) layout: fan subtype clusters into tidy
// rings, pull interleaved fans into distinct regions, spread hub satellites,
// triangulate collinear pass-throughs, then clear residual node overlaps.
function arrangeOrganic(cy: cytoscape.Core) {
  fanSubtypeClusters(cy);
  separateClusterFans(cy, 80);
  separateLeafFan(cy, 80);
  decollinearNodes(cy);
  deoverlapNodes(cy, 90);
}
// @ts-expect-error — same interop gap; .use() exists at runtime
cytoscape.use(cytoscapeNavigator);

type NavigatorInstance = {
  destroy: () => void;
  _onRenderHandler?: { cancel?: () => void };
};

function mountNavigator(cy: cytoscape.Core): NavigatorInstance {
  // The plugin only honors `container` as a string selector ('#id' or '.class').
  // Passing an HTMLElement falls through to `document.body.appendChild` of its own
  // div — see cytoscape-navigator.js:378-389. Use the id selector path.
  const nav = (cy as cytoscape.Core & {
    navigator: (opts: Record<string, unknown>) => NavigatorInstance;
  }).navigator({
    container: '#minimap-panel',
    viewLiveFramerate: 0,
    rerenderDelay: 100,
    removeCustomContainer: false,
  });
  // The plugin only generates the thumbnail on cy.onRender events. After
  // layoutstop the graph is idle so no render fires; force one so the
  // initial thumbnail paints.
  (cy as cytoscape.Core & { resize: () => void; trigger: (e: string) => void }).resize();
  (cy as cytoscape.Core & { resize: () => void; trigger: (e: string) => void }).trigger('render');
  return nav;
}

function teardownNavigator(nav: NavigatorInstance, container: HTMLElement | null) {
  // Cancel the throttled render handler's pending trailing setTimeout BEFORE
  // nav.destroy() — otherwise the tick can fire after cy.destroy() nulls
  // the renderer and throw "Cannot read properties of null (reading 'png')".
  // nav.destroy() also unsubscribes the navigator's cy 'resize' listener, so it
  // must run even when the container is already unmounted — otherwise a leaked
  // navigator boundingBox-es a destroyed core on a trailing resize ('isHeadless'
  // of null). Hence the container is optional and only used to clear children.
  nav._onRenderHandler?.cancel?.();
  nav.destroy();
  if (container) while (container.firstChild) container.removeChild(container.firstChild);
}

declare global {
  interface Window {
    __MODEL__?: Model;
    __THEME_MODE__?: 'dark' | 'light';
    __IGNATIUS_MODE__?: 'live' | 'static';
    __LAYOUT_KEY__?: string;
    // Flow-mode globals: injected by generateApp (export) or fetched from /api/flow (live).
    // __FLOW_MODEL__ is the array of all top-level FlowDiagrams (each carries
    // its subDfds recursively so drill-down works client-side with no fetches).
    __FLOW_MODEL__?: FlowDiagram[];
    // __FLOW_LAYOUT_KEYS__ maps diagram id → structural fingerprint for every
    // diagram in the tree (top-level and sub-DFDs). The frontend looks up
    // the key by id rather than importing the fingerprint module.
    __FLOW_LAYOUT_KEYS__?: Record<string, string>;
    // Debug/test seam: the live Cytoscape core, exposed for the visual harness
    // to locate nodes and drive hover. Not read by application code.
    __IGNATIUS_CY__?: cytoscape.Core;
    // Generation counter: incremented each time a new Cytoscape instance is
    // assigned to __IGNATIUS_CY__. Lets the visual harness detect a rebuild
    // even when the teardown→rebuild cycle is too fast to observe the undefined state.
    __IGNATIUS_CY_GEN__?: number;
    // Flow surface ready-flag: set to true once the SVG renderer has mounted.
    // Used by the visual test harness to confirm the flow render path ran.
    __IGNATIUS_FLOW_READY__?: boolean;
    // Generation counter for flow renders: incremented each time FLOW_READY goes true.
    // Lets the visual harness detect a re-render even when the false→true cycle is
    // too fast to observe via polling.
    __IGNATIUS_FLOW_GEN__?: number;
    // Test seam: the id of the currently active top-level DFD. Updated by the
    // flow renderer's onDiagramChange callback so the visual harness can assert
    // DFD-preserve across SSE re-renders without DOM parsing.
    __IGNATIUS_ACTIVE_FLOW_DFD__?: string;
  }
}

function applyThemeCssVars(theme: ThemeConfig, mode: ThemeMode) {
  const p = mode === 'light' ? theme.light : theme.dark;
  const root = document.documentElement;
  root.classList.remove('theme-dark', 'theme-light');
  root.classList.add(`theme-${mode}`);
  root.style.setProperty('--color-background', p.background);
  root.style.setProperty('--color-surface', p.surface);
  root.style.setProperty('--color-border', p.border);
  root.style.setProperty('--color-text', p.text);
  root.style.setProperty('--color-text-muted', p.textMuted);
  root.style.setProperty('--color-text-secondary', p.text + 'cc');
  // surface-alt: halfway between background and surface (for dividers)
  root.style.setProperty('--color-surface-alt', blendHex(p.background, p.surface, 0.5));
  root.style.setProperty('--color-edge-identifying', p.edgeIdentifying);
  root.style.setProperty('--color-edge-referential', p.edgeReferential);

  // Semantic classification badge colors — mode-aware
  const sc = semanticColors[mode];
  root.style.setProperty('--badge-independent-bg', sc.independent.bg);
  root.style.setProperty('--badge-independent-fg', sc.independent.fg);
  root.style.setProperty('--badge-dependent-bg', sc.dependent.bg);
  root.style.setProperty('--badge-dependent-fg', sc.dependent.fg);
  root.style.setProperty('--badge-classifier-bg', sc.classifier.bg);
  root.style.setProperty('--badge-classifier-fg', sc.classifier.fg);
  root.style.setProperty('--badge-subtype-bg', sc.subtype.bg);
  root.style.setProperty('--badge-subtype-fg', sc.subtype.fg);
  root.style.setProperty('--badge-associative-bg', sc.associative.bg);
  root.style.setProperty('--badge-associative-fg', sc.associative.fg);
  root.style.setProperty('--color-link', sc.link);

  // CP9: DD search-highlight color — yellow with opacity for contrast in both modes.
  root.style.setProperty(
    '--dd-search-highlight',
    mode === 'dark' ? 'rgba(255, 215, 0, 0.40)' : 'rgba(255, 195, 0, 0.50)',
  );

  // Direction-badge colors (read/write/readwrite) — mode-aware so they adapt on
  // theme switch. Dark: slightly brighter tints; light: slightly more saturated.
  if (mode === 'dark') {
    root.style.setProperty('--color-badge-read-bg', 'rgba(59, 130, 246, 0.15)');
    root.style.setProperty('--color-badge-read-fg', '#58a6ff');
    root.style.setProperty('--color-badge-write-bg', 'rgba(16, 185, 129, 0.15)');
    root.style.setProperty('--color-badge-write-fg', '#3fb950');
    root.style.setProperty('--color-badge-rw-bg', 'rgba(139, 92, 246, 0.15)');
    root.style.setProperty('--color-badge-rw-fg', '#b083f0');
  } else {
    root.style.setProperty('--color-badge-read-bg', 'rgba(5, 80, 174, 0.10)');
    root.style.setProperty('--color-badge-read-fg', '#0550ae');
    root.style.setProperty('--color-badge-write-bg', 'rgba(26, 127, 55, 0.10)');
    root.style.setProperty('--color-badge-write-fg', '#1a7f37');
    root.style.setProperty('--color-badge-rw-bg', 'rgba(130, 80, 223, 0.10)');
    root.style.setProperty('--color-badge-rw-fg', '#6639ba');
  }
}

function blendHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar * (1 - t) + br * t);
  const g = Math.round(ag * (1 - t) + bg * t);
  const bl = Math.round(ab * (1 - t) + bb * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

function pastel(hex: string, bgHex: string, mix: number): string {
  const bgR = parseInt(bgHex.slice(1, 3), 16);
  const bgG = parseInt(bgHex.slice(3, 5), 16);
  const bgB = parseInt(bgHex.slice(5, 7), 16);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const pr = Math.round(bgR * (1 - mix) + r * mix);
  const pg = Math.round(bgG * (1 - mix) + g * mix);
  const pb = Math.round(bgB * (1 - mix) + b * mix);
  return `#${pr.toString(16).padStart(2, '0')}${pg.toString(16).padStart(2, '0')}${pb.toString(16).padStart(2, '0')}`;
}

function lighten(hex: string): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + 60);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + 60);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + 60);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// Flow render — isolated path. Render is handled by FlowDiagramSvg (SVG).
// ---------------------------------------------------------------------------

// buildFlowStyles, assignStoreNumbers, computeFlowLayout, buildFlowElements,
// and buildFlowLayoutOpts were removed — dead code once FlowDiagramSvg
// (src/flow-view/) replaced the Cytoscape flow render path. The SVG renderer
// owns layout and drawing; Cytoscape is only used for the ERD surface.

// Chrome callbacks: typed interface so both initFlowGraphCore and the App component
// share the same contract. The FlowChrome React component drives these from its
// useImperativeHandle handle.
interface FlowChromeCallbacks {
  /** Called on every breadcrumb change (DFD select, drill-down, drill-up). */
  onStackChange: (stack: BreadcrumbEntry[]) => void;
  /** Called once on init and on each SSE re-render with the full diagram list. */
  onDiagramsChange: (all: FlowDiagram[], activeId: string) => void;
  /**
   * Called by the core once after init, providing the imperative drill handlers.
   * The App component stores these in refs so FlowChrome callbacks can invoke them
   * without DOM extension (no `as` casts at call sites).
   */
  onRegisterHandlers: (
    drillUp: (idx: number) => void,
    selectDiagram: (id: string) => void,
  ) => void;
  /** Called on pan/zoom/drag to update the minimap in FlowChrome. */
  onViewChange?: (data: MinimapData) => void;
  /** Called once to register the reset-layout callback; null to clear. */
  onResetLayout?: (fn: (() => void) | null) => void;
  /** Called to register a panTo(worldX, worldY) function for the minimap; null to clear. */
  onRegisterPanTo?: (fn: ((worldX: number, worldY: number) => void) | null) => void;
  /**
   * Called once to register a retheme(mode) function. Calling it updates the
   * flow SVG palette without tearing down and rebuilding the renderer — preserves
   * the selected DFD and drill-down stack.
   */
  onRegisterRetheme?: (fn: ((mode: 'dark' | 'light') => void) | null) => void;
  /**
   * Called on every diagram render — top-level select, drill-down, and drill-up.
   * The id is the diagram being rendered (the current top of the breadcrumb stack).
   * Used by App.tsx to write the `dfd` URL hash param so the active DFD is
   * deep-linkable at every level.
   */
  onActiveDiagramChange?: (id: string) => void;
  /**
   * Called whenever the SVG scale changes (wheel, zoom control, reset).
   * Drives the flow ZoomControl readout (scale 1 = 100% = fit baseline).
   */
  onZoomChange?: (scale: number) => void;
  /**
   * Called once on each diagram render with the imperative zoom operations,
   * and with null when the diagram is torn down. Wired to the flow ZoomControl.
   */
  onRegisterZoomControl?: (ctrl: {
    zoomTo(scale: number): void;
    resetFit(): void;
  } | null) => void;
}

// Core flow graph setup. Extracted so both static and live modes can call it.
// allDiagrams is passed in rather than read from globals so the live path can
// pass fresh data on each SSE-triggered re-render.
// startDiagramId: which top-level DFD to render first (null → first in array).
// onDiagramChange: called whenever the selected top-level DFD changes.
// chromeCallbacks: optional — when provided, the FlowChrome React component drives
//   the breadcrumb/selector UI; when absent (e.g. static mode without React chrome),
//   the function falls back to no-ops.
// ── Flow documentation dialog ────────────────────────────────────────────────
//
// Every flow node carries markdown: processes and externals have their own body;
// non-`db` stores borrow theirs from `_stores/`; a `db:` store borrows its
// entity's business narrative from the ERD model. The ⓘ badge on each node opens
// a dialog rendering that markdown, and `[[Target]]` links inside it route to
// other docs (flow nodes or ERD entities) in the same dialog — mirroring the
// ERD entity-link navigation.

type FlowDoc = { title: string; bodyHtml: string };

/**
 * Discriminated result from the flow doc resolver.
 * - `entity` — token maps to an ERD entity; open the rich SelectedEntityModal.
 * - `node`   — token maps to a structured flow node (process/external/non-db store);
 *              open the facts-rich FlowNodeModal (I/O table or kind+refs + markdown body).
 * - `doc`    — token maps to a plain markdown doc with no structured node (wiki-links
 *              that cannot be enriched, or the empty-state fallback for absent entities).
 */
type FlowDocResult =
  | { kind: 'entity'; entityId: string }
  | { kind: 'node'; node: FlowProcess | FlowExternal | FlowStoreRef; allProcesses: FlowProcess[]; doc: FlowDoc }
  | { kind: 'doc'; doc: FlowDoc };

/** Split a doc token into kind prefix + bare name. A bare token (from a
 *  `[[wiki-link]]`) has no kind prefix. */
function splitDocToken(token: string): { kind: string | null; name: string } {
  const colon = token.indexOf(':');
  if (colon === -1) return { kind: null, name: token };
  return { kind: token.slice(0, colon), name: token.slice(colon + 1) };
}

/**
 * Build a resolver mapping a doc token to a discriminated result:
 * - `{kind:'entity', entityId}` for `db:` tokens and bare wiki-link tokens
 *   whose name matches a known ERD entity — the caller opens the rich
 *   SelectedEntityModal.
 * - `{kind:'node', node, allProcesses, doc}` for process / external / non-`db`
 *   store tokens — the caller opens the facts-rich FlowNodeModal.
 * - `null` for tokens that cannot be resolved in any namespace (absent
 *   entity, unknown process, etc.) — caller shows an empty-state fallback.
 *
 * Tokens are either kind-qualified (`proc:Validate`, `ext:Customer`,
 * `db:Party`, `cache:Session`) from a node's ⓘ badge, or bare (`Party`)
 * from a `[[wiki-link]]`.
 */
function buildFlowDocResolver(
  diagrams: FlowDiagram[],
  // Accepts a getter so callers can pass () => modelRef.current — the resolver
  // then reads the LIVE entity-id set on every call, not a snapshot baked at
  // effect-run time. A plain Model value is still accepted for static mode
  // (where the model never changes).
  getEntityModel: (() => Model | undefined) | Model | undefined,
): (token: string) => FlowDocResult | null {
  // Structured node maps: stores the full typed node for facts rendering.
  const processById = new Map<string, FlowProcess>();
  // Keyed by stable id/slug (NOT by display label) so that a `title:` override
  // on an external does not break `[[Customer]]` or `ext:Customer` resolution.
  const externalById = new Map<string, FlowExternal>();
  const storesByKindName = new Map<string, FlowStoreRef>();
  const storesByName = new Map<string, FlowStoreRef>();
  // Flat list of all processes (needed for FlowIoTable's allProcesses param).
  const allProcesses: FlowProcess[] = [];

  function walk(d: FlowDiagram) {
    for (const p of d.processes) {
      if (!processById.has(p.id)) {
        processById.set(p.id, p);
        allProcesses.push(p);
      }
    }
    for (const e of d.externals) {
      if (!externalById.has(e.id)) externalById.set(e.id, e);
    }
    for (const s of d.storeRefs) {
      if (s.kind !== 'db') {
        if (!storesByKindName.has(`${s.kind}:${s.name}`)) storesByKindName.set(`${s.kind}:${s.name}`, s);
        if (!storesByName.has(s.name)) storesByName.set(s.name, s);
      }
    }
    for (const sub of d.subDfds) walk(sub);
  }
  diagrams.forEach(walk);

  // Normalize: if a plain Model (or undefined) was passed, wrap it in a getter
  // so the resolution path below is uniform.
  const getModel: () => Model | undefined =
    typeof getEntityModel === 'function'
      ? getEntityModel
      : () => getEntityModel;

  return (token: string): FlowDocResult | null => {
    // Read the live entity-id set on every resolution so SSE-updated models
    // are classified correctly without re-running the flow effect.
    const currentModel = getModel();
    const entityIds = currentModel
      ? new Set(currentModel.nodes.map(n => n.id))
      : new Set<string>();

    const { kind, name } = splitDocToken(token);
    // Kind-qualified: resolve against that namespace first.
    if (kind === 'proc') {
      const proc = processById.get(name);
      if (!proc) return null;
      return { kind: 'node', node: proc, allProcesses, doc: { title: proc.label || proc.id, bodyHtml: proc.bodyHtml } };
    }
    if (kind === 'ext') {
      const ext = externalById.get(name);
      if (!ext) return null;
      return { kind: 'node', node: ext, allProcesses, doc: { title: ext.label, bodyHtml: ext.bodyHtml } };
    }
    // db: tokens always route to the rich entity dialog (if entity exists).
    if (kind === 'db') {
      return entityIds.has(name) ? { kind: 'entity', entityId: name } : null;
    }
    if (kind) {
      const store = storesByKindName.get(`${kind}:${name}`);
      if (store) return { kind: 'node', node: store, allProcesses, doc: { title: store.displayName, bodyHtml: store.bodyHtml ?? '' } };
    }
    // Bare token (wiki-link): entity check first — business narratives most
    // often cross-link entities — then flow node namespaces.
    if (entityIds.has(name)) return { kind: 'entity', entityId: name };
    const proc = processById.get(name);
    if (proc) return { kind: 'node', node: proc, allProcesses, doc: { title: proc.label || proc.id, bodyHtml: proc.bodyHtml } };
    const ext = externalById.get(name);
    if (ext) return { kind: 'node', node: ext, allProcesses, doc: { title: ext.label, bodyHtml: ext.bodyHtml } };
    const store = storesByName.get(name);
    if (store) return { kind: 'node', node: store, allProcesses, doc: { title: store.displayName, bodyHtml: store.bodyHtml ?? '' } };
    return null;
  };
}

/**
 * Shared modal primitive. Owns the backdrop, stop-propagation, close button,
 * header with title, and ONE ESC keydown listener (added/removed on mount).
 * All four dialog variants render their content as children.
 * `headerExtra` renders inside `.modal-header` after the `<h1>` (for badges etc.).
 */
function Modal({ title, onClose, children, className, headerExtra }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  headerExtra?: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus the close button so keyboard users can dismiss immediately.
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal${className ? ` ${className}` : ''}`} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} ref={closeRef}>×</button>
        <div className="modal-header">
          <h1>{title}</h1>
          {headerExtra}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Facts-rich dialog for a non-entity flow node (process / external / non-db store).
 * Renders the node's structured data above its markdown body.
 * Reuses the Dictionary's FlowIoTable / DictExternalSection / DictStoreSection
 * components so the dialog and the dictionary show the same structured facts.
 */
function FlowNodeModal({ node, allProcesses, doc, onClose, onNavigate, allFlowNodeIds, canOpenToken, nodeUsageIndex }: {
  node: FlowProcess | FlowExternal | FlowStoreRef;
  allProcesses: FlowProcess[];
  doc: FlowDoc;
  onClose: () => void;
  onNavigate: (token: string) => void;
  allFlowNodeIds?: ReadonlySet<string>;
  /** When provided, non-db IO table endpoints whose token resolves become clickable links. */
  canOpenToken?: (token: string) => boolean;
  /** Token-keyed usage index (buildFlowNodeUsageIndex). When provided, ext/store
   *  branches render the Processes cross-reference table (CP21). */
  nodeUsageIndex?: ReadonlyMap<string, ProcessUsage[]>;
}) {
  // Upgrade pass: resolve `.entity-link--missing` spans inside the body to live
  // anchors when the target exists in the full flow + entity node-id set.
  // Body HTML is rendered at parse time with entity-only knownIds, so ext:/proc:
  // references start as missing. This pass corrects them after the modal mounts.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current && allFlowNodeIds) {
      upgradeMissingLinksInContainer(bodyRef.current, allFlowNodeIds);
    }
  }, [doc.bodyHtml, allFlowNodeIds]);

  function handleBodyClick(e: React.MouseEvent) {
    const el = e.target;
    if (!(el instanceof Element)) return;
    const link = el.closest('a[data-entity]');
    if (!link) return;
    e.preventDefault();
    const id = link.getAttribute('data-entity');
    if (id) onNavigate(id);
  }

  // FlowProcess has `inputs` + `outputs`; FlowStoreRef has `displayName`; FlowExternal has neither.
  // TypeScript narrows on these property presence guards — no casts needed.
  // Note: FlowExternal now also carries optional `kind`, so we cannot use 'kind' in node
  // to distinguish FlowStoreRef — use `displayName` which is required on FlowStoreRef only.
  function renderFacts() {
    if ('inputs' in node) {
      // FlowProcess
      return (
        <div className="flow-node-dialog-facts">
          <FlowIoTable
            process={node}
            allProcesses={allProcesses}
            onScrollToEntity={() => { /* no-op: dialog context */ }}
            onOpenEntity={onNavigate}
            onOpenToken={onNavigate}
            canOpenToken={canOpenToken}
          />
        </div>
      );
    }
    if ('displayName' in node) {
      // FlowStoreRef — token is "kind:name" (e.g. "file:gateway-log")
      const storeToken = `${node.kind}:${node.name}`;
      const storeUsages = nodeUsageIndex?.get(storeToken);
      return (
        <div className="flow-node-dialog-facts">
          <DictStoreSection store={node} />
          {storeUsages && storeUsages.length > 0 && (
            <ProcessesSection
              usages={storeUsages}
              onNavigateToProcess={(processId) => onNavigate(`proc:${processId}`)}
            />
          )}
        </div>
      );
    }
    // FlowExternal — token is "ext:<id>"
    const extToken = `ext:${node.id}`;
    const extUsages = nodeUsageIndex?.get(extToken);
    return (
      <div className="flow-node-dialog-facts">
        <DictExternalSection external={node} />
        {extUsages && extUsages.length > 0 && (
          <ProcessesSection
            usages={extUsages}
            onNavigateToProcess={(processId) => onNavigate(`proc:${processId}`)}
          />
        )}
      </div>
    );
  }

  return (
    <Modal title={doc.title.replace(/_/g, ' ')} onClose={onClose}>
      {renderFacts()}
      {doc.bodyHtml && (
        <div
          ref={bodyRef}
          className="doc-body"
          onClick={handleBodyClick}
          dangerouslySetInnerHTML={{ __html: doc.bodyHtml }}
        />
      )}
      {'inputs' in node && <FlowProcessExamplesSection examples={node.examples} />}
    </Modal>
  );
}

/** Plain markdown documentation dialog. Used for the empty-state fallback
 *  (absent-entity db: token) and wiki-links that resolve to no structured node. */
function FlowDocModal({ doc, onClose, onNavigate }: {
  doc: FlowDoc;
  onClose: () => void;
  onNavigate: (token: string) => void;
}) {
  return (
    <Modal title={doc.title.replace(/_/g, ' ')} onClose={onClose}>
      <div
        className="doc-body"
        onClick={e => {
          // Injected HTML can't carry React handlers — delegate clicks on
          // `[[…]]` anchors through the same navigation path.
          const el = e.target;
          if (!(el instanceof Element)) return;
          const link = el.closest('a[data-entity]');
          if (!link) return;
          e.preventDefault();
          const id = link.getAttribute('data-entity');
          if (id) onNavigate(id);
        }}
        dangerouslySetInnerHTML={{ __html: doc.bodyHtml }}
      />
    </Modal>
  );
}

/**
 * Stateful wrapper around FlowDiagramSvg that owns the doc-dialog state. The ⓘ
 * badge resolves a node's token to a discriminated result:
 * - `entity` → delegates to `onOpenEntity` (rich SelectedEntityModal, app-level).
 * - `node`   → opens the FlowNodeModal (structured facts + markdown).
 * - `doc`    → opens the plain FlowDocModal (markdown only — empty-state fallback).
 * - `null`   → shows a graceful empty-state FlowDocModal ("not found in catalog").
 *
 * In-dialog `[[wiki-links]]` re-resolve through the same path, so entity-targeting
 * links open the rich dialog and flow-node links swap the node or markdown dialog.
 * An absent-entity `db:` token (`null` result) shows an empty-state doc rather
 * than a dead badge, matching the `flow.unknown_store` finding surface.
 */
function FlowSurface({ svgProps, resolveDoc, onOpenEntity, themeMode, allFlowNodeIds, onRegisterOpen, nodeUsageIndex }: {
  svgProps: Omit<FlowDiagramSvgProps, 'onOpenDoc' | 'themeMode'>;
  resolveDoc: (token: string) => FlowDocResult | null;
  onOpenEntity?: (id: string) => void;
  themeMode: 'dark' | 'light';
  allFlowNodeIds?: ReadonlySet<string>;
  /** Called once on mount with the `open` dispatcher so callers can trigger
   *  in-flow navigation from outside the component (e.g. from the app-level
   *  SelectedEntityModal's process-usage links when opened from the flow view). */
  onRegisterOpen?: (open: (token: string) => void) => void;
  /** Token-keyed usage index (buildFlowNodeUsageIndex) for CP21 Processes section
   *  in external/store dialogs. Optional — omit to suppress the section. */
  nodeUsageIndex?: ReadonlyMap<string, ProcessUsage[]>;
}) {
  // Active dialog state. Exactly one may be open at a time.
  const [openResult, setOpenResult] = useState<
    | { kind: 'node'; node: FlowProcess | FlowExternal | FlowStoreRef; allProcesses: FlowProcess[]; doc: FlowDoc }
    | { kind: 'doc'; doc: FlowDoc }
    | null
  >(null);

  // Keep a stable ref to `open` so onRegisterOpen only fires once (no deps churn).
  const openRef = useRef<(token: string) => void>(() => {});

  const open = (token: string) => {
    const result = resolveDoc(token);
    if (result === null) {
      // Absent entity / unknown token — show an empty-state doc so the badge
      // isn't silently dead. `db:` absent entities are surfaced by flow.unknown_store;
      // this fallback prevents a crash and gives the user a clear signal.
      const { name } = splitDocToken(token);
      setOpenResult({ kind: 'doc', doc: { title: name, bodyHtml: '<p class="entity-link entity-link--missing">Not found in the entity catalog.</p>' } });
      return;
    }
    if (result.kind === 'entity') {
      // Close any open dialog before opening the rich entity dialog so
      // only one modal is visible at a time — both badge clicks and wiki-link
      // clicks in the flow dialog come through this path.
      setOpenResult(null);
      onOpenEntity?.(result.entityId);
      return;
    }
    setOpenResult(result);
  };
  openRef.current = open;

  // Register the `open` dispatcher with the app level on mount so it can route
  // in-flow navigation (e.g. process-usage link clicks in a flow-opened entity
  // dialog) without switching the view to the Dictionary or Graph.
  useEffect(() => {
    if (onRegisterOpen) onRegisterOpen((token: string) => openRef.current(token));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => setOpenResult(null);

  return (
    <>
      <FlowDiagramSvg {...svgProps} themeMode={themeMode} onOpenDoc={open} />
      {openResult?.kind === 'node' && (
        <FlowNodeModal
          node={openResult.node}
          allProcesses={openResult.allProcesses}
          doc={openResult.doc}
          onClose={close}
          onNavigate={open}
          allFlowNodeIds={allFlowNodeIds}
          canOpenToken={(tok) => resolveDoc(tok) !== null}
          nodeUsageIndex={nodeUsageIndex}
        />
      )}
      {openResult?.kind === 'doc' && (
        <FlowDocModal doc={openResult.doc} onClose={close} onNavigate={open} />
      )}
    </>
  );
}

function initFlowGraphCore(
  container: HTMLDivElement,
  allDiagrams: FlowDiagram[],
  startDiagramId: string | null,
  onDiagramChange?: (id: string) => void,
  chromeCallbacks?: FlowChromeCallbacks,
  initialThemeMode: 'dark' | 'light' = 'dark',
  // Accepts a getter (() => Model | undefined) so callers can thread a ref and
  // always resolve the live entity-id set — or a plain Model for static mode.
  entityModel?: (() => Model | undefined) | Model,
  onOpenEntity?: (id: string) => void,
  onRegisterOpen?: (open: (token: string) => void) => void,
  // Theme config getter so kind-colored stores resolve the live theme.flowKinds overrides.
  getThemeConfig?: () => ThemeConfig | undefined,
  // CP21: token-keyed usage index so ext/store dialogs can render Processes section.
  nodeUsageIndex?: ReadonlyMap<string, ProcessUsage[]>,
): () => void {
  // Resolver for node ⓘ docs + in-dialog [[links]]. The entityModel parameter
  // may be a getter (() => Model | undefined) so the resolver always reads the
  // live entity-id set on each call — falling back to window.__MODEL__ if neither
  // the caller nor the getter provides a model (static mode with no explicit arg).
  const resolveDoc = buildFlowDocResolver(
    allDiagrams,
    entityModel ?? window.__MODEL__,
  );

  // Build the full set of flow node IDs (entities + processes + externals + non-db stores)
  // once for this renderer lifecycle. Used by FlowNodeModal's upgrade pass so
  // ext:/proc: references in dialog bodies render as live links, not missing spans.
  const resolvedEntityModel: Model | undefined =
    typeof entityModel === 'function' ? entityModel() : entityModel ?? window.__MODEL__;
  const allFlowNodeIds = buildAllFlowNodeIds(allDiagrams, resolvedEntityModel);

  // Persistence: flow positions use a separate localStorage key so they never
  // touch the ERD's 'ignatius-layout-positions' bucket.
  const flowLayoutStore = createLayoutStore(
    globalThis.localStorage,
    undefined,
    'ignatius-flow-layout-positions',
  );

  // Breadcrumb stack: array of { diagram, label } from the selected top-level DFD down.
  // The current diagram is always the last entry.
  const stack: Array<{ diagram: FlowDiagram; label: string }> = [];

  // Current palette mode. Updated by retheme() without rebuilding the renderer.
  let currentThemeMode: 'dark' | 'light' = initialThemeMode;

  // The container must be position:relative for absolute children.
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  // Track the active selector id for chrome callback
  let activeSelectorId: string = startDiagramId ?? allDiagrams[0]!.id;

  function pushChromeState() {
    chromeCallbacks?.onStackChange(stack.map(s => ({ label: s.label })));
  }

  // --- SVG React root ---
  // The flow renderer mounts FlowDiagramSvg into a dedicated sub-div inside
  // the container. On diagram swap (DFD select or drill-down), the old root
  // is unmounted and a new one is created, mirroring the Cytoscape destroy/init
  // lifecycle it replaces.
  let svgRoot: ReactRoot | null = null;
  let svgContainer: HTMLDivElement | null = null;

  // Returns the fingerprint for a diagram id from the injected layout keys map.
  // Static: window.__FLOW_LAYOUT_KEYS__; live: injected by the app-level flow
  // effect's applyFlowPayload before the renderer calls initFlowGraphCore.
  function layoutKeyFor(diagramId: string): string {
    return window.__FLOW_LAYOUT_KEYS__?.[diagramId] ?? '';
  }

  function renderDiagram(diagram: FlowDiagram) {
    // Unmount previous SVG root.
    if (svgRoot) {
      svgRoot.unmount();
      svgRoot = null;
    }
    if (svgContainer && svgContainer.parentNode) {
      svgContainer.parentNode.removeChild(svgContainer);
      svgContainer = null;
    }
    window.__IGNATIUS_FLOW_READY__ = false;

    // Load saved positions for this diagram.
    const layoutKey = layoutKeyFor(diagram.id);
    const savedPositions: PositionMap | null = layoutKey
      ? flowLayoutStore.load(layoutKey)
      : null;

    // Create a fresh full-bleed sub-div for the SVG.
    const div = document.createElement('div');
    div.setAttribute('data-ignatius', 'flow-svg-host');
    Object.assign(div.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
    });
    container.appendChild(div);
    svgContainer = div;

    // Drill handler: called by FlowDiagramSvg when user clicks a drillable process.
    function handleDrill(processId: string) {
      const currentDiagram = stack[stack.length - 1]!.diagram;
      const subDfd = currentDiagram.subDfds.find(d => d.id === processId);
      if (!subDfd) {
        console.warn(`[ignatius] drill-down: no sub-DFD found for process '${processId}'`);
        return;
      }
      const proc = currentDiagram.processes.find(p => p.id === processId);
      const label = proc ? `${proc.dottedNumber} ${proc.label}` : processId;
      stack.push({ diagram: subDfd, label });
      pushChromeState();
      renderDiagram(subDfd);
    }

    // Reset layout for this diagram: clear saved positions and re-render with
    // the banded defaults. Registered with FlowChrome so the FAB can trigger it.
    function resetLayout() {
      if (layoutKey) flowLayoutStore.clear(layoutKey);
      renderDiagram(diagram);
    }
    chromeCallbacks?.onResetLayout?.(resetLayout);

    // Mount the SVG renderer.
    const root = createRoot(div);
    svgRoot = root;

    function doRender(themeMode: 'dark' | 'light') {
      // Guard: if this diagram's root has been replaced (teardown + remount during a
      // diagram switch or SSE re-render), skip the render — the current root owns the DOM.
      if (svgRoot !== root) return;
      // Resolve kind palette from the live theme config (falls back to defaults when
      // the theme has no flowKinds override — same pattern as semanticColors).
      const themeConfig = getThemeConfig?.();
      const kindPalette = resolveFlowKindPalette(themeMode, themeConfig?.flowKinds);
      root.render(
        createElement(FlowSurface, {
          resolveDoc,
          onOpenEntity,
          themeMode,
          allFlowNodeIds,
          onRegisterOpen,
          nodeUsageIndex,
          svgProps: {
            diagram,
            kindPalette,
            onDrill: handleDrill,
            onReady: () => {
              window.__IGNATIUS_FLOW_READY__ = true;
              window.__IGNATIUS_FLOW_GEN__ = (window.__IGNATIUS_FLOW_GEN__ ?? 0) + 1;
            },
            savedPositions: savedPositions ?? undefined,
            layoutKey,
            onPositionsChange: (posMap: PositionMap) => {
              if (layoutKey) flowLayoutStore.save(layoutKey, posMap);
            },
            onViewChange: (data: MinimapData) => {
              chromeCallbacks?.onViewChange?.(data);
            },
            onRegisterPanTo: (fn: ((worldX: number, worldY: number) => void) | null) => {
              chromeCallbacks?.onRegisterPanTo?.(fn);
            },
            onZoomChange: (s: number) => {
              chromeCallbacks?.onZoomChange?.(s);
            },
            onRegisterZoomControl: (ctrl) => {
              chromeCallbacks?.onRegisterZoomControl?.(ctrl);
            },
          },
        }),
      );
    }

    doRender(currentThemeMode);

    // Register the retheme hook — re-renders with updated palette without
    // unmounting (React reconciles in-place, preserving interaction state).
    chromeCallbacks?.onRegisterRetheme?.((mode) => {
      currentThemeMode = mode;
      doRender(mode);
    });

    // Notify the app that the active diagram changed so it can update the URL hash.
    chromeCallbacks?.onActiveDiagramChange?.(diagram.id);

    pushChromeState();
  }

  function drillUp(targetIdx: number) {
    // Truncate the stack to targetIdx + 1 (keeping entries 0..targetIdx)
    stack.splice(targetIdx + 1);
    const target = stack[stack.length - 1];
    if (!target) return;
    pushChromeState();
    renderDiagram(target.diagram);
    // onActiveDiagramChange fired inside renderDiagram above.
  }

  // Recursively search allDiagrams (and their sub-DFD trees) for a diagram with the
  // given id, returning the path of ancestor diagrams from the top-level root down
  // to (and including) the found diagram. Returns null if not found.
  function findDiagramPath(id: string): FlowDiagram[] | null {
    function search(diagrams: FlowDiagram[], path: FlowDiagram[]): FlowDiagram[] | null {
      for (const d of diagrams) {
        if (d.id === id) return [...path, d];
        const found = search(d.subDfds, [...path, d]);
        if (found) return found;
      }
      return null;
    }
    return search(allDiagrams, []);
  }

  // selectDiagramById: resolves the diagram by id whether top-level OR sub-DFD.
  // Rebuilds the breadcrumb stack to reflect the full ancestor path, then renders.
  // Used by both the popstate/back-nav path AND the FlowChrome DFD selector.
  function selectDiagramById(id: string) {
    const path = findDiagramPath(id);
    if (!path || path.length === 0) return;
    const target = path.at(-1);
    if (!target) return;
    // Rebuild stack: each step in the path becomes a breadcrumb entry.
    const newStack = path.map((d, i) => {
      if (i === 0) return { diagram: d, label: d.title };
      // For sub-DFD entries, find the process label in the parent diagram.
      const parent = path[i - 1];
      if (!parent) return { diagram: d, label: d.title };
      const proc = parent.processes.find(p => p.id === d.id);
      const label = proc ? `${proc.dottedNumber} ${proc.label}` : d.title;
      return { diagram: d, label };
    });
    stack.splice(0, stack.length, ...newStack);
    // Update the top-level active selector to the root of this path.
    const rootId = path[0]?.id ?? target.id;
    activeSelectorId = rootId;
    onDiagramChange?.(rootId);
    chromeCallbacks?.onDiagramsChange(allDiagrams, rootId);
    pushChromeState();
    renderDiagram(target);
  }

  // Seed the stack with the starting DFD (preserving selection across SSE re-renders).
  // Use findDiagramPath so a deep-linked sub-DFD id resolves correctly and the
  // full ancestor breadcrumb chain is established from the first render.
  const startPath = startDiagramId !== null ? findDiagramPath(startDiagramId) : null;
  if (startPath && startPath.length > 0) {
    // Build the initial stack for every ancestor step in the path.
    const newStack = startPath.map((d, i) => {
      if (i === 0) return { diagram: d, label: d.title };
      const parent = startPath[i - 1];
      if (!parent) return { diagram: d, label: d.title };
      const proc = parent.processes.find(p => p.id === d.id);
      const label = proc ? `${proc.dottedNumber} ${proc.label}` : d.title;
      return { diagram: d, label };
    });
    stack.push(...newStack);
    // activeSelectorId should reflect the root of this path.
    // startPath.length > 0 is guaranteed by the enclosing guard, so both
    // index accesses are safe; extract locals so TypeScript can narrow them.
    const pathRoot = startPath[0];
    const startDiagram = startPath[startPath.length - 1];
    if (!pathRoot || !startDiagram) return () => {}; // unreachable — length > 0
    activeSelectorId = pathRoot.id;
    onDiagramChange?.(startDiagram.id);
    chromeCallbacks?.onDiagramsChange(allDiagrams, activeSelectorId);
    chromeCallbacks?.onRegisterHandlers(drillUp, selectDiagramById);
    renderDiagram(startDiagram);
  } else {
    // startDiagramId was null, unknown, or stale — fall back to first top-level diagram.
    const startDiagram = allDiagrams[0]!;
    stack.push({ diagram: startDiagram, label: startDiagram.title });
    onDiagramChange?.(startDiagram.id);
    chromeCallbacks?.onDiagramsChange(allDiagrams, activeSelectorId);
    chromeCallbacks?.onRegisterHandlers(drillUp, selectDiagramById);
    renderDiagram(startDiagram);
  }

  return () => {
    chromeCallbacks?.onResetLayout?.(null);
    chromeCallbacks?.onRegisterRetheme?.(null);
    if (svgRoot) {
      svgRoot.unmount();
      svgRoot = null;
    }
    if (svgContainer && svgContainer.parentNode) {
      svgContainer.parentNode.removeChild(svgContainer);
      svgContainer = null;
    }
    window.__IGNATIUS_FLOW_READY__ = false;
    window.__IGNATIUS_ACTIVE_FLOW_DFD__ = undefined;
  };
}

function buildStyles(groups: Record<string, GroupConfig>, theme: ThemeConfig, mode: ThemeMode): cytoscape.Stylesheet[] {
  const p = mode === 'light' ? theme.light : theme.dark;
  const defaultNodeBg = pastel(p.textMuted, p.background, p.pastelMix);

  const base: cytoscape.Stylesheet[] = [
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'background-color': defaultNodeBg,
        'color': p.text,
        'border-width': 2,
        'border-color': p.textMuted,
        'shape': 'round-rectangle',
        // Size each box to its (wrapped) label so long names stay compact and
        // the text never overflows the border. text-max-width is a safety net
        // for the rare single long word with no break opportunity.
        'width': 'label',
        'height': 'label',
        'text-wrap': 'wrap',
        'text-max-width': 150 as unknown as string,
        'padding': '9px' as unknown as number,
        'font-size': 11,
        'font-weight': 600,
        'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      },
    },
    {
      selector: 'node[classification = "Independent"], node[classification = "Classifier"]',
      style: { 'shape': 'rectangle' },
    },
    {
      selector: 'node[cluster = "true"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': 'transparent',
        'background-opacity': 0,
        'border-width': 1,
        'border-color': blendHex(p.background, p.surface, 0.5),
        'border-opacity': 0.4,
        'padding': '10px' as unknown as number,
        'label': '',
      },
    },
    {
      selector: 'node[joiner = "true"]',
      style: {
        'shape': 'diamond',
        'width': 20,
        'height': 20,
        // Fixed-size discriminator marker — must not inherit the entity nodes'
        // label padding, or the diamond balloons out.
        'padding': 0,
        'background-color': p.background,
        'border-color': p.edgeIdentifying,
        'border-width': 2,
        'font-size': 10,
        'font-weight': 700,
        'color': p.edgeIdentifying,
        'text-valign': 'center',
        'text-halign': 'center',
      },
    },
    {
      selector: 'edge[subtypeEdge = "true"]',
      style: {
        'line-style': 'solid',
        'width': 1.5,
        'line-color': p.edgeIdentifying,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 3,
        'overlay-opacity': 0.08,
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 1.5,
        'line-color': p.edgeIdentifying,
        'target-arrow-shape': 'none',
        'source-arrow-shape': 'none',
        'curve-style': 'bezier',
        'label': 'data(edgeLabel)',
        'font-size': 10,
        'color': p.textMuted,
        'text-rotation': 'autorotate',
        'text-margin-y': -10,
        'arrow-scale': 1.2,
        'text-background-color': p.background,
        'text-background-opacity': 0.95,
        'text-background-padding': '4px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: 'edge[identifying = "true"]',
      style: {
        'line-style': 'solid',
        'width': 2,
        'line-color': p.edgeIdentifying,
      },
    },
    {
      selector: 'edge[identifying = "false"]',
      style: {
        'line-style': 'dashed',
        'line-color': p.edgeReferential,
        'width': 1.2,
      },
    },
  ];

  for (const [name, cfg] of Object.entries(groups)) {
    base.push({
      selector: `node[group = "${name}"]`,
      style: {
        'border-color': cfg.color,
        'background-color': pastel(cfg.color, p.background, p.pastelMix),
      },
    });
    base.push({
      selector: `node[group = "${name}"]:selected`,
      style: { 'border-color': lighten(cfg.color) },
    });
  }

  base.push({
    selector: '.faded',
    style: { 'opacity': 0.3 },
  });

  base.push({
    selector: 'node.hover-focus',
    style: { 'border-width': 3 },
  });

  return base;
}

function SelectedEntityModal({ selected, model, entityErrors, onClose, onNavigate, processUsages, onNavigateToProcess, allFlowNodeIds }: {
  selected: ModelNode;
  model: Model | null;
  entityErrors: EntityError[];
  onClose: () => void;
  onNavigate: (id: string) => void;
  processUsages?: ProcessUsage[];
  onNavigateToProcess?: (processId: string) => void;
  /** When set (flow-opened modal), run upgradeMissingLinksInContainer on the body
   *  so ext:/proc: references render as live `.entity-link` links, not missing spans. */
  allFlowNodeIds?: ReadonlySet<string>;
}) {
  const groups = model?.groups ?? {};
  const edges = model?.edges ?? [];
  const nodes = model?.nodes ?? [];
  const groupCfg = selected.group ? groups[selected.group] : undefined;
  const errorsForSelected = entityErrors.filter(e => e.entityId === selected.id);

  // Upgrade pass for flow-opened modals: resolve missing-span links that were
  // rendered with entity-only knownIds but whose targets exist as flow nodes.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current && allFlowNodeIds) {
      upgradeMissingLinksInContainer(bodyRef.current, allFlowNodeIds);
    }
  }, [selected.bodyHtml, allFlowNodeIds]);

  const badges = (
    <div className="modal-badges">
      <span className={`badge ${selected.classification.toLowerCase()}`}>
        {selected.classification}
      </span>
      {groupCfg && (
        <span
          className="badge"
          style={{
            background: hexToRgba(groupCfg.color, 0.2),
            color: groupCfg.color,
          }}
        >
          {groupCfg.label}
        </span>
      )}
      <span className="pk-label">
        PK: {selected.pk.join(', ')}
      </span>
    </div>
  );

  return (
    <Modal title={selected.id.replace(/_/g, ' ')} onClose={onClose} headerExtra={badges}>
      <ColumnsTable
        node={selected}
        edges={edges}
        onNavigate={(id) => {
          const target = nodes.find(n => n.id === id);
          if (target) onNavigate(id);
        }}
      />
      <div
        ref={bodyRef}
        className="doc-body"
        onClick={(e) => {
          // Body HTML is injected, so its `[[…]]` anchors can't carry React
          // handlers — delegate: intercept clicks on entity links and route
          // them through the same navigation the FK links use.
          const el = e.target;
          if (!(el instanceof Element)) return;
          const link = el.closest('a[data-entity]');
          if (!link) return;
          e.preventDefault();
          const id = link.getAttribute('data-entity');
          // In flow context (allFlowNodeIds present), allow any flow node id;
          // in graph context, limit to ERD entity nodes only.
          const allowed = allFlowNodeIds
            ? (id && (allFlowNodeIds.has(id) || nodes.some(n => n.id === id)))
            : (id && nodes.some(n => n.id === id));
          if (allowed && id) onNavigate(id);
        }}
        dangerouslySetInnerHTML={{ __html: selected.bodyHtml }}
      />
      <ChildrenTable
        node={selected}
        edges={edges}
        onNavigate={(id) => {
          const target = nodes.find(n => n.id === id);
          if (target) onNavigate(id);
        }}
      />
      {errorsForSelected.length > 0 && (
        <div className="graph-modal-issues-section">
          <h4>Issues</h4>
          <ul>
            {errorsForSelected.map(err => (
              <li key={err.ruleId}>
                <strong>{RULES[err.ruleId]?.title ?? err.ruleId}</strong>: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ExamplesAccordion node={selected} />
      {processUsages && processUsages.length > 0 && onNavigateToProcess && (
        <ProcessesSection usages={processUsages} onNavigateToProcess={onNavigateToProcess} />
      )}
    </Modal>
  );
}

function ProcessesSection({ usages, onNavigateToProcess }: {
  usages: ProcessUsage[];
  onNavigateToProcess: (processId: string) => void;
}) {
  return (
    <div className="modal-processes doc-section">
      <h4>Processes</h4>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Process</th>
              <th>DFD</th>
              <th>Direction</th>
            </tr>
          </thead>
          <tbody>
            {usages.map(u => (
              <tr key={u.processId}>
                <td>
                  <a
                    href={`#process-${u.processId}`}
                    onClick={e => { e.preventDefault(); onNavigateToProcess(u.processId); }}
                  >
                    {u.dottedNumber} {u.processLabel}
                  </a>
                </td>
                <td>{u.dfdTitle}</td>
                <td>
                  <span className={`dict-process-direction dict-process-direction--${u.direction}`}>
                    {u.direction}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColumnsTable({ node, edges, onNavigate }: {
  node: ModelNode;
  edges: ModelEdge[];
  onNavigate: (entityId: string) => void;
}) {
  const fkTargets: Record<string, string> = {};
  for (const edge of edges) {
    if (edge.source === node.id) {
      for (const childCol of Object.keys(edge.on)) {
        fkTargets[childCol] = edge.target;
      }
    }
  }

  const cols = Object.entries(node.columns);
  if (cols.length === 0) return null;

  function renderRoles(name: string) {
    const parts: (string | JSX.Element)[] = [];
    if (node.pk.includes(name)) parts.push('PK');
    if (fkTargets[name]) {
      const target = fkTargets[name];
      parts.push(
        <span key="fk">
          FK →{' '}
          <a className="fk-link" onClick={() => onNavigate(target)}>
            {target}
          </a>
        </span>
      );
    }
    for (const ak of node.alternateKeys) {
      if (ak.columns.includes(name)) parts.push('AK');
    }
    if (parts.length === 0) return '—';
    return parts.map((p, i) => (
      <span key={i}>{i > 0 ? ', ' : ''}{p}</span>
    ));
  }

  return (
    <div className="doc-section">
      <h2>Attributes</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Type</th>
              <th>Key</th>
              <th>Null</th>
              <th>Default</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {cols.map(([name, col]) => (
              <tr key={name}>
                <td><code>{name}</code></td>
                <td>{col.type}</td>
                <td>{renderRoles(name)}</td>
                <td>{col.nullable ? 'Yes' : 'No'}</td>
                <td>{col.default ?? ''}</td>
                <td>{col.desc ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChildrenTable({ node, edges, onNavigate }: {
  node: ModelNode;
  edges: ModelEdge[];
  onNavigate: (entityId: string) => void;
}) {
  const children = edges.filter(e => e.target === node.id);
  if (children.length === 0) return null;

  return (
    <div className="doc-section">
      <h2>Relationships</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Child</th>
              <th>Type</th>
              <th>Predicate</th>
              <th>Cardinality</th>
            </tr>
          </thead>
          <tbody>
            {children.map(edge => (
              <tr key={edge.source}>
                <td>
                  <a className="fk-link" onClick={() => onNavigate(edge.source)}>
                    {edge.source}
                  </a>
                </td>
                <td>{edge.identifying ? 'Identifying' : 'Referential'}</td>
                <td>{edge.predicate.fwd}{edge.predicate.rev !== edge.predicate.fwd && <span className="predicate-rev">{edge.predicate.rev}</span>}</td>
                <td>{edge.cardinality.parent}:{edge.cardinality.child}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExamplesAccordion({ node }: { node: ModelNode }) {
  const examples = node.examples;
  if (!examples || examples.length === 0) return null;

  // Column order: PK first, then declared columns in declaration order.
  const pkSet: Record<string, true> = {};
  for (const k of node.pk) pkSet[k] = true;
  const declaredCols = Object.keys(node.columns).filter(k => !pkSet[k]);
  const headers = [...node.pk, ...declaredCols];

  const isOpen = examples.length <= 3;

  return (
    <details className="modal-examples doc-section" open={isOpen || undefined}>
      <summary>Examples ({examples.length})</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {headers.map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {examples.map((row, i) => (
              <tr key={i}>
                {headers.map(h => (
                  <td key={h}>
                    {row[h] !== undefined && row[h] !== null && row[h] !== ''
                      ? String(row[h])
                      : <span className="example-empty">–</span>
                    }
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Renders the `examples: { in, out }` data from a FlowProcess as a series of
 * small tables — one per entry — after the process body in the dialog.
 * Mirrors ExamplesAccordion: columns = union of keys across that entry's rows;
 * blank cell (–) when a row lacks a key.
 * Returns null when the process has no examples (no empty section rendered).
 */
function FlowProcessExamplesSection({ examples }: { examples: FlowProcess['examples'] }) {
  if (!examples) return null;
  const allEntries: Array<{ direction: 'in' | 'out'; entry: FlowExample }> = [
    ...examples.in.map(e => ({ direction: 'in' as const, entry: e })),
    ...examples.out.map(e => ({ direction: 'out' as const, entry: e })),
  ];
  if (allEntries.length === 0) return null;

  return (
    <div className="flow-process-examples">
      {allEntries.map(({ direction, entry }, i) => {
        const counterpart = direction === 'in' ? (entry.from ?? '') : (entry.to ?? '');
        const caption = [
          direction,
          counterpart,
          entry.label,
        ].filter(Boolean).join(' · ');

        // Columns = union of keys across all rows, in insertion order
        const colSet = new Set<string>();
        for (const row of entry.rows) {
          for (const k of Object.keys(row)) colSet.add(k);
        }
        const cols = Array.from(colSet);

        if (cols.length === 0 && entry.rows.length === 0) return null;

        return (
          <details key={i} className="modal-examples doc-section" open={entry.rows.length <= 3 || undefined}>
            <summary>{caption} ({entry.rows.length} row{entry.rows.length === 1 ? '' : 's'})</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {entry.rows.map((row, ri) => (
                    <tr key={ri}>
                      {cols.map(c => (
                        <td key={c}>
                          {row[c] !== undefined && row[c] !== null && row[c] !== ''
                            ? String(row[c])
                            : <span className="example-empty">–</span>
                          }
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DictionaryView — inline, searchable, no-dialog entity dictionary.
//
// Renders ALL entities inline (no modals). Reuses ColumnsTable / ChildrenTable /
// ExamplesAccordion from the graph modal but passes onNavigate = scroll-to-anchor
// instead of open-dialog. Keep-mounted: search text + scroll survive view detours.
// ---------------------------------------------------------------------------

// Dictionary group/entity hierarchy sort (pure logic, no I/O).
// Hierarchy ordering: independent basetype-clusters first, dependent second;
// within a tier alphabetical by basetype id; basetype before its subtypes.
function sortGroupNodes(
  groupNodes: ModelNode[],
  subtypeClusters: SubtypeCluster[],
): ModelNode[] {
  const nodeSet: Record<string, ModelNode> = {};
  for (const n of groupNodes) nodeSet[n.id] = n;

  const relevantClusters = subtypeClusters.filter(c => nodeSet[c.basetype]);

  const subtypeOf: Record<string, string> = {};
  for (const c of relevantClusters) {
    for (const m of c.members) {
      subtypeOf[m] = c.basetype;
    }
  }

  type Cluster = { basetype: ModelNode; subtypes: ModelNode[] };
  const clusterMap: Record<string, Cluster> = {};

  for (const c of relevantClusters) {
    const basetypeNode = nodeSet[c.basetype];
    if (!basetypeNode) continue;
    const subtypeNodes = c.members
      .map(m => nodeSet[m])
      .filter((n): n is ModelNode => n !== undefined)
      .sort((a, b) => a.id.localeCompare(b.id));
    clusterMap[c.basetype] = { basetype: basetypeNode, subtypes: subtypeNodes };
  }

  for (const n of groupNodes) {
    if (!clusterMap[n.id] && !subtypeOf[n.id]) {
      clusterMap[n.id] = { basetype: n, subtypes: [] };
    }
  }

  const isIndependent = (n: ModelNode) => n.classification.toLowerCase() === 'independent';

  const independent: Cluster[] = [];
  const dependent: Cluster[] = [];

  for (const cluster of Object.values(clusterMap)) {
    if (isIndependent(cluster.basetype)) independent.push(cluster);
    else dependent.push(cluster);
  }

  independent.sort((a, b) => a.basetype.id.localeCompare(b.basetype.id));
  dependent.sort((a, b) => a.basetype.id.localeCompare(b.basetype.id));

  const ordered: ModelNode[] = [];
  for (const cluster of [...independent, ...dependent]) {
    ordered.push(cluster.basetype);
    ordered.push(...cluster.subtypes);
  }

  return ordered;
}

const KNOWN_CLASSIFICATIONS = new Set([
  'independent', 'dependent', 'classifier', 'subtype', 'associative',
]);

function DictClassificationBadge({ cls }: { cls: string }) {
  const key = cls.toLowerCase();
  if (!KNOWN_CLASSIFICATIONS.has(key)) {
    return (
      <span className="dict-badge" style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}>
        {cls}
      </span>
    );
  }
  return (
    <span
      className="dict-badge"
      style={{
        background: `var(--badge-${key}-bg)`,
        color: `var(--badge-${key}-fg)`,
      }}
    >
      {cls}
    </span>
  );
}

// Dict-flavored columns table: uses dict CSS classes (.dict-attr-table etc.)
// instead of the modal's doc-section / table-scroll wrappers.
// onNavigate here scrolls to the entity anchor within the dict page.
function DictColumnsTable({
  node,
  edges,
  missingTargets,
  onNavigate,
  onNavigateMissing,
}: {
  node: ModelNode;
  edges: ModelEdge[];
  missingTargets: Set<string>;
  onNavigate: (entityId: string) => void;
  onNavigateMissing: (id: string) => void;
}) {
  const fkTargets: Record<string, string> = {};
  for (const edge of edges) {
    if (edge.source === node.id) {
      for (const childCol of Object.keys(edge.on)) {
        fkTargets[childCol] = edge.target;
      }
    }
  }

  const pkSet: Record<string, true> = {};
  for (const k of node.pk) pkSet[k] = true;

  const akSet: Record<string, true> = {};
  for (const ak of node.alternateKeys ?? []) {
    if (!Array.isArray(ak?.columns)) continue;
    for (const col of ak.columns) akSet[col] = true;
  }

  const cols = Object.entries(node.columns);
  if (cols.length === 0) return null;

  return (
    <div className="dict-table-wrap">
      <table className="dict-attr-table">
        <thead>
          <tr>
            <th>Attribute</th>
            <th>Type</th>
            <th>Key</th>
            <th>Nullable</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {cols.map(([name, col]) => {
            const isPk = pkSet[name];
            const isFk = fkTargets[name];
            const isAk = akSet[name];
            const parts: ReactNode[] = [];
            if (isPk) parts.push('PK');
            if (isFk) {
              const target = fkTargets[name] ?? '';
              parts.push(
                missingTargets.has(target)
                  ? <a key="fk" className="dict-link-missing" href={`#missing-${target}`} onClick={e => { e.preventDefault(); onNavigateMissing(target); }}>{target}</a>
                  : <a key="fk" href={`#entity-${target}`} onClick={e => { e.preventDefault(); onNavigate(target); }}>{target}</a>
              );
            }
            if (isAk) parts.push('AK');
            return (
              <tr key={name}>
                <td><code>{name}</code></td>
                <td><code>{col.type}</code></td>
                <td>
                  {parts.length === 0 ? '—' : parts.map((p, i) => (
                    <span key={i}>{i > 0 ? ' · ' : ''}{p}</span>
                  ))}
                </td>
                <td>{col.nullable ? 'Yes' : 'No'}</td>
                <td>{col.default != null ? String(col.default) : ''}</td>
                <td>{col.desc ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Dict-flavored relationships table: uses dict CSS classes.
function DictRelationshipsTable({
  node,
  edges,
  onNavigate,
}: {
  node: ModelNode;
  edges: ModelEdge[];
  onNavigate: (entityId: string) => void;
}) {
  const downstream = edges.filter(e => e.target === node.id);
  if (downstream.length === 0) return null;

  return (
    <>
      <h4 className="dict-rel-heading">Downstream relationships</h4>
      <div className="dict-table-wrap">
        <table className="dict-rel-table">
          <thead>
            <tr>
              <th>Child entity</th>
              <th>Type</th>
              <th>Predicate</th>
              <th>Cardinality</th>
            </tr>
          </thead>
          <tbody>
            {downstream.map(e => (
              <tr key={e.source}>
                <td>
                  <a
                    href={`#entity-${e.source}`}
                    onClick={ev => { ev.preventDefault(); onNavigate(e.source); }}
                  >
                    {e.source}
                  </a>
                </td>
                <td>{e.identifying ? 'Identifying' : 'Referential'}</td>
                <td>
                  {e.predicate.fwd === e.predicate.rev ? (
                    <div className="dict-predicate-cell">
                      <span className="dict-predicate-pill dict-predicate-pill--shared">{e.predicate.fwd}</span>
                    </div>
                  ) : (
                    <div className="dict-predicate-cell">
                      <span className="dict-predicate-pill dict-predicate-pill--primary">
                        {e.predicate.rev}<span className="dict-predicate-arrow"> →</span>
                      </span>
                      <span className="dict-predicate-pill dict-predicate-pill--inverse">
                        <span className="dict-predicate-arrow">← </span>{e.predicate.fwd}
                      </span>
                    </div>
                  )}
                </td>
                <td>{e.cardinality.parent} → {e.cardinality.child}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Dict-flavored examples accordion
function DictExamplesAccordion({ node }: { node: ModelNode }) {
  const examples = node.examples;
  if (!examples || examples.length === 0) return null;

  const pkSet: Record<string, true> = {};
  for (const k of node.pk) pkSet[k] = true;
  const declaredCols = Object.keys(node.columns).filter(k => !pkSet[k]);
  const headers = [...node.pk, ...declaredCols];
  const isOpen = examples.length <= 3;

  return (
    <details className="dict-examples" open={isOpen || undefined}>
      <summary>Examples ({examples.length} row{examples.length === 1 ? '' : 's'})</summary>
      <div className="dict-examples-table-wrap">
        <table className="dict-examples-table">
          <thead>
            <tr>{headers.map(h => <th key={h}><code>{h}</code></th>)}</tr>
          </thead>
          <tbody>
            {examples.map((row, i) => (
              <tr key={i}>
                {headers.map(h => (
                  <td key={h}>
                    {row[h] !== undefined && row[h] !== null
                      ? String(row[h])
                      : <span className="dict-example-empty">–</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function DictEntitySection({
  node,
  edges,
  subtypeClusters,
  entityErrors,
  missingTargets,
  onNavigate,
  onNavigateMissing,
  processUsages,
  onScrollToProcess,
}: {
  node: ModelNode;
  edges: ModelEdge[];
  subtypeClusters: SubtypeCluster[];
  entityErrors: EntityError[];
  missingTargets: Set<string>;
  onNavigate: (entityId: string) => void;
  onNavigateMissing: (id: string) => void;
  processUsages?: ProcessUsage[];
  onScrollToProcess?: (processId: string) => void;
}) {
  const pkList = node.pk.join(', ');
  const pkLabel = node.pk.length > 0 ? <span className="dict-pk-label">PK: <code>{pkList}</code></span> : null;

  const isBasetypeOf = subtypeClusters.find(c => c.basetype === node.id);
  const isSubtypeOf = subtypeClusters.find(c => c.members.includes(node.id));

  const nodeErrors = entityErrors.filter(e => e.entityId === node.id);

  return (
    <section className="dict-entity-section" id={`entity-${node.id}`}>
      <div className="dict-entity-header">
        <h2>{node.id}</h2>
        <DictClassificationBadge cls={node.classification} />
        {isBasetypeOf && (
          <span
            className="dict-badge"
            style={{ background: 'var(--badge-classifier-bg)', color: 'var(--badge-classifier-fg)' }}
          >
            basetype · {isBasetypeOf.exclusive ? 'exclusive' : 'inclusive'}
          </span>
        )}
        {isSubtypeOf && (
          <span
            className="dict-badge"
            style={{ background: 'var(--badge-classifier-bg)', color: 'var(--badge-classifier-fg)' }}
          >
            of{' '}
            <a
              href={`#entity-${isSubtypeOf.basetype}`}
              onClick={e => { e.preventDefault(); onNavigate(isSubtypeOf.basetype); }}
            >
              {isSubtypeOf.basetype}
            </a>
          </span>
        )}
        {pkLabel}
      </div>

      {nodeErrors.length > 0 && (
        <details className="dict-entity-warning">
          <summary>⚠ {nodeErrors.length} issue{nodeErrors.length > 1 ? 's' : ''}</summary>
          <ul className="dict-entity-warning-detail">
            {nodeErrors.map((err, i) => {
              const rule = RULES[err.ruleId];
              const title = rule ? rule.title : err.ruleId;
              return (
                <li key={i}><strong>{title}</strong> — {err.message}</li>
              );
            })}
          </ul>
        </details>
      )}

      {isBasetypeOf && (
        <p className="dict-subtype-list">
          Subtypes:{' '}
          {isBasetypeOf.members.map((m, i) => (
            <span key={m}>
              {i > 0 ? ', ' : ''}
              <a href={`#entity-${m}`} onClick={e => { e.preventDefault(); onNavigate(m); }}>{m}</a>
            </span>
          ))}
        </p>
      )}

      <DictColumnsTable node={node} edges={edges} missingTargets={missingTargets} onNavigate={onNavigate} onNavigateMissing={onNavigateMissing} />
      <DictRelationshipsTable node={node} edges={edges} onNavigate={onNavigate} />

      {node.bodyHtml && (
        <div
          className="dict-entity-body"
          dangerouslySetInnerHTML={{ __html: node.bodyHtml }}
          onClick={e => {
            const t = e.target;
            if (!(t instanceof Element)) return;
            // Live anchor: <a data-entity="X">
            const link = t.closest('a[data-entity]');
            if (link) {
              e.preventDefault();
              const entityId = link.getAttribute('data-entity');
              if (entityId) onNavigate(entityId);
              return;
            }
            // Missing span: <span class="entity-link--missing" title="Unknown entity: X">
            // Resolved at click time — timing-independent, survives React reconciliation.
            const span = t.closest('span.entity-link--missing');
            if (span) {
              const title = span.getAttribute('title') ?? '';
              const prefix = 'Unknown entity: ';
              if (title.startsWith(prefix)) {
                const target = title.slice(prefix.length);
                onNavigate(target);
              }
            }
          }}
        />
      )}

      <DictExamplesAccordion node={node} />
      {processUsages && processUsages.length > 0 && onScrollToProcess && (
        <DictProcessesTable usages={processUsages} onScrollToProcess={onScrollToProcess} />
      )}
    </section>
  );
}

function DictProcessesTable({ usages, onScrollToProcess }: {
  usages: ProcessUsage[];
  onScrollToProcess: (processId: string) => void;
}) {
  return (
    <div className="dict-processes-table-wrap">
      <h4 className="dict-section-heading">Processes</h4>
      <table className="dict-processes-table">
        <thead>
          <tr>
            <th>Process</th>
            <th>DFD</th>
            <th>Direction</th>
          </tr>
        </thead>
        <tbody>
          {usages.map(u => (
            <tr key={u.processId}>
              <td>
                <a
                  href={`#process-${u.processId}`}
                  onClick={e => { e.preventDefault(); onScrollToProcess(u.processId); }}
                >
                  {u.dottedNumber} {u.processLabel}
                </a>
              </td>
              <td>{u.dfdTitle}</td>
              <td>
                <span className={`dict-process-direction dict-process-direction--${u.direction}`}>
                  {u.direction}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Returns true if the node matches the search term (id, columns, body text, group desc).
function nodeMatchesSearch(node: ModelNode, term: string, groupLabel: string): boolean {
  const t = term.toLowerCase();
  if (node.id.toLowerCase().includes(t)) return true;
  if (groupLabel.toLowerCase().includes(t)) return true;
  for (const [colName, col] of Object.entries(node.columns)) {
    if (colName.toLowerCase().includes(t)) return true;
    if (col.type.toLowerCase().includes(t)) return true;
    if (col.desc?.toLowerCase().includes(t)) return true;
  }
  if (node.bodyHtml?.replace(/<[^>]+>/g, ' ').toLowerCase().includes(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Flow process-model matchers
// ---------------------------------------------------------------------------

function processMatchesSearch(proc: FlowProcess, term: string): boolean {
  const t = term.toLowerCase();
  if (proc.id.toLowerCase().includes(t)) return true;
  if (proc.label.toLowerCase().includes(t)) return true;
  if (proc.dottedNumber.toLowerCase().includes(t)) return true;
  if (proc.body.toLowerCase().includes(t)) return true;
  return false;
}

function externalMatchesSearch(ext: FlowExternal, term: string): boolean {
  const t = term.toLowerCase();
  if (ext.id.toLowerCase().includes(t)) return true;
  if (ext.label.toLowerCase().includes(t)) return true;
  if (ext.body.toLowerCase().includes(t)) return true;
  return false;
}

function storeMatchesSearch(store: FlowStoreRef, term: string): boolean {
  const t = term.toLowerCase();
  if (store.name.toLowerCase().includes(t)) return true;
  if (store.displayName.toLowerCase().includes(t)) return true;
  if (store.kind.toLowerCase().includes(t)) return true;
  if (store.body?.toLowerCase().includes(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Flow process-model section components
// ---------------------------------------------------------------------------

// Kind markers: short labels for the inputs/outputs table (mirrors flow-dict.ts)
const FLOW_KIND_MARKERS: Record<string, string> = {
  db: 'D',
  cache: 'C',
  queue: 'Q',
  file: 'F',
  doc: 'Do',
  manual: 'M',
  ext: '',
  proc: '',
};

function FlowKindMarker({ ep, processes }: { ep: FlowEndpoint; processes: FlowProcess[] }) {
  if (ep.kind === 'proc') {
    const proc = processes.find(p => p.id === ep.name);
    const label = proc ? proc.dottedNumber : ep.name;
    return <span className="flow-kind-marker">{label}</span>;
  }
  if (ep.kind === 'ext') {
    return <span className="flow-kind-ext">ext</span>;
  }
  const marker = FLOW_KIND_MARKERS[ep.kind] ?? ep.kind;
  const isDb = ep.kind === 'db';
  return (
    <span className={`flow-kind-marker${isDb ? ' flow-kind-marker--db' : ''}`}>
      {marker}
    </span>
  );
}

function FlowIoTable({
  process,
  allProcesses,
  onScrollToEntity,
  onOpenEntity,
  onOpenToken,
  canOpenToken,
}: {
  process: FlowProcess;
  allProcesses: FlowProcess[];
  onScrollToEntity: (entityId: string) => void;
  /** When provided, db: entity links open the rich entity dialog instead of scrolling. */
  onOpenEntity?: (entityId: string) => void;
  /** When provided, non-db endpoints whose token resolves open in-place via the flow resolver. */
  onOpenToken?: (token: string) => void;
  /** Returns true when a given token resolves to a known flow node (used to avoid dead links). */
  canOpenToken?: (token: string) => boolean;
}) {
  const hasFlows = process.inputs.length > 0 || process.outputs.length > 0;
  if (!hasFlows) {
    return <p className="flow-no-flows">No flows defined for this process.</p>;
  }

  function renderRow(edge: FlowEdge, direction: 'in' | 'out') {
    const otherEp = direction === 'in' ? edge.from : edge.to;
    const dirLabel = direction;

    if (otherEp.kind === 'db') {
      const entityId = otherEp.name;
      const dataColumns: string[] = Array.isArray(edge.data)
        ? edge.data
        : edge.data.length > 0 ? [edge.data] : [];

      // When onOpenEntity is provided (dialog context), render as a rich entity
      // link with data-entity so a click opens the SelectedEntityModal. Otherwise
      // fall back to the dict scroll-to-anchor behavior.
      function renderEntityCell() {
        if (onOpenEntity) {
          return (
            <a
              href={`#entity-${entityId}`}
              className="entity-link"
              data-entity={entityId}
              onClick={e => { e.preventDefault(); onOpenEntity(entityId); }}
            >
              {entityId}
            </a>
          );
        }
        return (
          <a href={`#entity-${entityId}`} onClick={e => { e.preventDefault(); onScrollToEntity(entityId); }}>
            {entityId}
          </a>
        );
      }

      if (dataColumns.length === 0) {
        return (
          <tr key={`${direction}-${entityId}-empty`}>
            <td>{renderEntityCell()}</td>
            <td><FlowKindMarker ep={otherEp} processes={allProcesses} /></td>
            <td>—</td>
            <td>{dirLabel}</td>
          </tr>
        );
      }

      return dataColumns.map(col => (
        <tr key={`${direction}-${entityId}-${col}`}>
          <td>{renderEntityCell()}</td>
          <td><FlowKindMarker ep={otherEp} processes={allProcesses} /></td>
          <td><code>{col}</code></td>
          <td>{dirLabel}</td>
        </tr>
      ));
    }

    // Non-db endpoint
    const dataLabel = Array.isArray(edge.data)
      ? edge.data.join(', ')
      : edge.data;

    // Build the kind-qualified token for this endpoint so the flow resolver can
    // check whether it maps to a known node (ext:, file:, cache:, etc.).
    const epToken = `${otherEp.kind}:${otherEp.name}`;
    const isResolvable = onOpenToken !== undefined && canOpenToken?.(epToken) === true;

    function renderNonDbEndpointCell() {
      if (isResolvable && onOpenToken) {
        return (
          <a
            href="#"
            className="entity-link"
            onClick={e => { e.preventDefault(); onOpenToken(epToken); }}
          >
            {otherEp.name}
          </a>
        );
      }
      return <>{otherEp.name}</>;
    }

    return (
      <tr key={`${direction}-${otherEp.name}-${dataLabel}`}>
        <td>{renderNonDbEndpointCell()}</td>
        <td><FlowKindMarker ep={otherEp} processes={allProcesses} /></td>
        <td>{dataLabel || '—'}</td>
        <td>{dirLabel}</td>
      </tr>
    );
  }

  return (
    <div className="flow-table-wrap">
      <table className="dict-io-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Kind</th>
            <th>Data</th>
            <th>Direction</th>
          </tr>
        </thead>
        <tbody>
          {process.inputs.map(e => renderRow(e, 'in'))}
          {process.outputs.map(e => renderRow(e, 'out'))}
        </tbody>
      </table>
    </div>
  );
}

// Hierarchical dotted-number sort for the DD process nav. Compares segment-by-segment
// numerically (so 2 < 10 and 1.1 < 1.2); non-numeric/missing segments fall back to 0 so a
// malformed number never throws. Module-scope so it isn't re-created per render.
function parseDottedNumber(dn: string): number[] {
  return dn.split('.').map(seg => {
    const n = parseInt(seg, 10);
    return isNaN(n) ? 0 : n;
  });
}
function compareDottedProcesses(a: FlowProcess, b: FlowProcess): number {
  const pa = parseDottedNumber(a.dottedNumber);
  const pb = parseDottedNumber(b.dottedNumber);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// Shared body-click resolver for all DD body divs (entity/process/external/store).
// Handles live `<a data-entity>` anchors AND `.entity-link--missing` spans
// (resolved at click time — survives React reconciliation).
// scrollFn should be the caller's scrollToSection; it no-ops if the id matches nothing.
function resolveBodyClick(
  e: React.MouseEvent<HTMLDivElement>,
  scrollFn: (id: string) => void,
): void {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const link = t.closest('a[data-entity]');
  if (link) {
    e.preventDefault();
    const id = link.getAttribute('data-entity');
    if (id) scrollFn(id);
    return;
  }
  const span = t.closest('span.entity-link--missing');
  if (span) {
    const title = span.getAttribute('title') ?? '';
    const prefix = 'Unknown entity: ';
    if (title.startsWith(prefix)) {
      e.preventDefault();
      const target = title.slice(prefix.length);
      scrollFn(target);
    }
  }
}

function DictProcessSection({
  process,
  allProcesses,
  flowErrors,
  onScrollToEntity,
  onScrollToSection,
  externalIds,
  nonDbStoreNames,
}: {
  process: FlowProcess;
  allProcesses: FlowProcess[];
  flowErrors: FlowError[];
  onScrollToEntity: (entityId: string) => void;
  onScrollToSection: (id: string) => void;
  /** O(1) set of known external ids — used to decide whether a non-db endpoint is linkable. */
  externalIds: Record<string, true>;
  /** O(1) set of known non-db store names — same purpose. */
  nonDbStoreNames: Record<string, true>;
}) {
  const procErrors = flowErrors.filter(e => e.processId === process.id);

  // Non-db endpoint handlers for the DD card. The token is `kind:name` (e.g. `ext:Customer`).
  // We split at the first colon to get the name, then check whether the DD has a section for it.
  // canOpenToken is data-driven (O(1) hash lookup) — not document.getElementById — so it is safe
  // to call during render before the section has mounted.
  function canOpenToken(token: string): boolean {
    const colonIdx = token.indexOf(':');
    if (colonIdx === -1) return false;
    const name = token.slice(colonIdx + 1);
    return externalIds[name] === true || nonDbStoreNames[name] === true;
  }

  function onOpenToken(token: string): void {
    const colonIdx = token.indexOf(':');
    if (colonIdx === -1) return;
    const name = token.slice(colonIdx + 1);
    onScrollToSection(name);
  }

  return (
    <section className="dict-entity-section" id={`process-${process.id}`}>
      <div className="dict-entity-header">
        <span className="flow-dotted-number">{process.dottedNumber}</span>
        <h2 className="flow-process-label">{process.label}</h2>
      </div>

      {procErrors.length > 0 && (
        <details className="dict-entity-warning">
          <summary>⚠ {procErrors.length} issue{procErrors.length > 1 ? 's' : ''}</summary>
          <ul className="dict-entity-warning-detail">
            {procErrors.map((err, i) => {
              const rule = RULES[err.ruleId];
              const title = rule ? rule.title : err.ruleId;
              return <li key={i}><strong>{title}</strong> — {err.message}</li>;
            })}
          </ul>
        </details>
      )}

      <FlowIoTable
        process={process}
        allProcesses={allProcesses}
        onScrollToEntity={onScrollToEntity}
        onOpenToken={onOpenToken}
        canOpenToken={canOpenToken}
      />

      {process.bodyHtml && (
        <div
          className="flow-node-body flow-node-body--process"
          dangerouslySetInnerHTML={{ __html: process.bodyHtml }}
          onClick={e => resolveBodyClick(e, onScrollToSection)}
        />
      )}

      <FlowProcessExamplesSection examples={process.examples} />
    </section>
  );
}

/**
 * Renders the header (EXT badge + label) for a flow external entity.
 * Body is NOT rendered here — callers that want body (the DD section) pass
 * it as children; the FlowNodeModal renders body separately after renderFacts().
 * This avoids the duplicate-body bug where the modal rendered body twice.
 */
function DictExternalSection({
  external,
  children,
}: {
  external: FlowExternal;
  children?: React.ReactNode;
}) {
  return (
    <section className="dict-entity-section" id={`external-${external.id}`}>
      <div className="dict-entity-header">
        <span className="flow-external-kind">EXT</span>
        <h3 className="flow-external-name">{external.label}</h3>
      </div>
      {children}
    </section>
  );
}

/**
 * Renders the header (kind badge + name) for a non-db flow store.
 * Body is NOT rendered here — callers that want body pass it as children.
 * db: stores are excluded (they open the rich entity dialog instead).
 */
function DictStoreSection({
  store,
  children,
}: {
  store: FlowStoreRef;
  children?: React.ReactNode;
}) {
  if (store.kind === 'db') return null;
  return (
    <section className="dict-entity-section" id={`store-${store.name}`}>
      <div className="dict-entity-header">
        <span className="flow-store-kind">{store.kind.toUpperCase()}</span>
        <h3 className="flow-store-name">{store.displayName}</h3>
      </div>
      {children}
    </section>
  );
}

/**
 * Walk all flow diagrams (recursively) and collect every known node ID —
 * entity IDs (from the ERD model), process IDs, external IDs, and non-db
 * store names — into a single Set. Used by FlowNodeModal and the flow-opened
 * SelectedEntityModal to upgrade `.entity-link--missing` spans to live links.
 */
export function buildAllFlowNodeIds(
  diagrams: FlowDiagram[],
  entityModel?: Model,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (entityModel) {
    for (const n of entityModel.nodes) ids.add(n.id);
  }
  function walk(d: FlowDiagram) {
    for (const p of d.processes) ids.add(p.id);
    for (const e of d.externals) ids.add(e.id);
    for (const s of d.storeRefs) {
      if (s.kind !== 'db') ids.add(s.name);
    }
    for (const sub of d.subDfds) walk(sub);
  }
  diagrams.forEach(walk);
  return ids;
}

/**
 * Upgrade `.entity-link--missing` spans inside `container` to live anchor
 * elements when their target ID appears in `allKnownIds`.
 *
 * Entity bodies are rendered at parse time with knownIds = entity IDs only,
 * so a `[[Customer]]` reference in an entity body emits a missing span even
 * when Customer exists as a flow external. This pass resolves those references
 * client-side after the full set of node IDs (entities + externals + stores +
 * processes) is known.
 *
 * Exported for unit testing; the upgrade is side-effecting (mutates the DOM).
 */
export function upgradeMissingLinksInContainer(
  container: ParentNode,
  allKnownIds: ReadonlySet<string>,
): void {
  const spans = container.querySelectorAll<HTMLElement>('span.entity-link--missing');
  for (const span of spans) {
    // Target is encoded in `title="Unknown entity: <target>"`.
    const title = span.getAttribute('title') ?? '';
    const prefix = 'Unknown entity: ';
    if (!title.startsWith(prefix)) continue;
    const target = title.slice(prefix.length);
    if (!allKnownIds.has(target)) continue;

    // Replace span with a live anchor carrying data-entity so the parent body
    // div's click delegation picks it up. Href is "#" (neutral) because the
    // correct section prefix (entity/external/store/process) is resolved at
    // click time by scrollToSection — hardcoding #entity-* would be wrong for
    // externals, stores, and processes.
    const anchor = document.createElement('a');
    anchor.className = 'entity-link';
    anchor.setAttribute('data-entity', target);
    anchor.setAttribute('href', '#');
    anchor.textContent = span.textContent ?? '';
    span.replaceWith(anchor);
  }
}

function DictionaryView({
  model,
  findings,
  flowDiagrams,
  flowFindings,
  searchText,
  onSearchChange,
  dictNavOpen,
  onToggleNav,
}: {
  model: Model;
  findings: { globalErrors: GlobalError[]; entityErrors: EntityError[] };
  flowDiagrams: FlowDiagram[] | null;
  flowFindings: { flowErrors: FlowError[]; globalErrors: GlobalError[] };
  searchText: string;
  onSearchChange: (v: string) => void;
  dictNavOpen: boolean;
  onToggleNav: () => void;
}) {
  const { globalErrors, entityErrors } = findings;

  // CP10: beforeprint/afterprint — clear active search so the FULL dictionary
  // renders when the user prints, then restore the prior term on afterprint.
  //
  // Implementation note: savedSearchRef holds the term to restore. Using a ref
  // (not local let) because beforeprint calls onSearchChange(''), which triggers
  // a re-render that would re-run a deps-based effect and reset a local variable
  // before afterprint fires — losing the saved term. The ref is mutation-stable
  // across re-renders. searchTextRef gives handlers stable read access to the
  // current searchText without re-registering the event listeners on every change.
  const searchTextRef = useRef(searchText);
  searchTextRef.current = searchText;
  const onSearchChangeRef = useRef(onSearchChange);
  onSearchChangeRef.current = onSearchChange;
  const savedSearchRef = useRef('');

  useEffect(() => {
    function handleBeforePrint() {
      savedSearchRef.current = searchTextRef.current;
      if (searchTextRef.current !== '') onSearchChangeRef.current('');
    }

    function handleAfterPrint() {
      if (savedSearchRef.current !== '') {
        onSearchChangeRef.current(savedSearchRef.current);
        savedSearchRef.current = '';
      }
    }

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  // Empty deps: register once on mount, unregister on unmount.
  // Handlers read searchTextRef/onSearchChangeRef/savedSearchRef (all stable refs).
  }, []);

  // Build missing-target set (entities referenced by FK but not present).
  const missingTargets = new Set(
    globalErrors
      .filter(e => e.ruleId === 'edge.unknown_target')
      .map(e => {
        const arrow = e.omitted.id.indexOf('→');
        return arrow >= 0 ? e.omitted.id.slice(arrow + 1) : e.omitted.id;
      }),
  );

  // Sort group order: sort_key ascending, then alphabetical by id.
  const groupOrder = Object.keys(model.groups).sort((a, b) => {
    const skA = model.groups[a]?.sort_key;
    const skB = model.groups[b]?.sort_key;
    if (skA !== undefined && skB !== undefined) {
      return skA !== skB ? skA - skB : a.localeCompare(b);
    }
    if (skA !== undefined) return -1;
    if (skB !== undefined) return 1;
    return a.localeCompare(b);
  });

  // Scroll-to-anchor navigation (anchor links within the dict panel).
  function scrollToEntity(entityId: string) {
    const el = document.getElementById(`entity-${entityId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Generalized scroll: resolves the correct DD section anchor regardless of
  // kind (entity / external / store / process). Used by body wiki-link clicks so
  // [[Customer]] (an external) reaches #external-Customer even though the href
  // written by the wiki plugin always says #entity-*.
  function scrollToSection(id: string) {
    const prefixes = ['entity', 'external', 'store', 'process'] as const;
    for (const prefix of prefixes) {
      const el = document.getElementById(`${prefix}-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
  }

  function scrollToMissing(id: string) {
    const el = document.getElementById(`missing-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Delegates to the shared module-level resolveBodyClick with the local scrollToSection.
  function handleDdBodyClick(e: React.MouseEvent<HTMLDivElement>) {
    resolveBodyClick(e, scrollToSection);
  }

  // Build node list filtered by search term.
  const hasSearch = searchText.trim().length > 0;
  const term = searchText.trim();

  // Subtypes-of lookup: which clusters is this node the basetype or member of?
  const subtypeIds: Record<string, true> = {};
  for (const c of model.subtypeClusters) {
    for (const m of c.members) subtypeIds[m] = true;
  }

  // Build group → sorted nodes mapping (pre-sorted, then optionally filtered).
  const groupOrderedNodes: Record<string, ModelNode[]> = {};
  for (const key of groupOrder) {
    const cfg = model.groups[key];
    if (!cfg) continue;
    const groupNodes = model.nodes.filter(n => n.group === key);
    if (groupNodes.length === 0) continue;
    groupOrderedNodes[key] = sortGroupNodes(groupNodes, model.subtypeClusters);
  }

  const ungrouped = model.nodes
    .filter(n => !n.group || !model.groups[n.group])
    .sort((a, b) => a.id.localeCompare(b.id));

  // Determine which entity nodes pass the filter.
  const visibleSet: Record<string, true> = {};
  if (!hasSearch) {
    for (const n of model.nodes) visibleSet[n.id] = true;
  } else {
    for (const key of groupOrder) {
      const cfg = model.groups[key];
      if (!cfg) continue;
      for (const n of model.nodes.filter(n => n.group === key)) {
        if (nodeMatchesSearch(n, term, cfg.label)) visibleSet[n.id] = true;
      }
    }
    for (const n of ungrouped) {
      if (nodeMatchesSearch(n, term, '')) visibleSet[n.id] = true;
    }
  }

  const totalVisible = Object.keys(visibleSet).length;

  // Collect all processes / externals / non-db stores from all diagrams (flat).
  const allDiagrams = flowDiagrams ?? [];
  // Include sub-DFD processes recursively.
  function collectProcessesDeep(diagrams: FlowDiagram[]): FlowProcess[] {
    const result: FlowProcess[] = [];
    for (const d of diagrams) {
      result.push(...d.processes);
      result.push(...collectProcessesDeep(d.subDfds));
    }
    return result;
  }
  const allProcessesDeep = collectProcessesDeep(allDiagrams);

  // Deduplicate externals by id (same external may appear in multiple DFDs).
  const externalById: Record<string, FlowExternal> = {};
  for (const d of allDiagrams) {
    for (const ext of d.externals) externalById[ext.id] = ext;
  }
  const allExternals = Object.values(externalById);

  // Deduplicate non-db stores by name across diagrams.
  const storeByName: Record<string, FlowStoreRef> = {};
  for (const d of allDiagrams) {
    for (const s of d.storeRefs) {
      if (s.kind !== 'db') storeByName[s.name] = s;
    }
  }
  const allNonDbStores = Object.values(storeByName).filter(s => s.bodyHtml !== undefined);

  // O(1) membership sets for DD-card endpoint clickability (CP25).
  // Built from the same source arrays as allExternals/allNonDbStores so they stay in sync.
  const ddExternalIds: Record<string, true> = {};
  for (const ext of allExternals) ddExternalIds[ext.id] = true;
  const ddNonDbStoreNames: Record<string, true> = {};
  for (const s of allNonDbStores) ddNonDbStoreNames[s.name] = true;

  // Entity ↔ process usage index (CP7): maps entityId → ProcessUsage[].
  // Built here so DictEntitySection can render a Processes table per entity.
  // Memoized — DictionaryView is keep-mounted and re-renders on every parent
  // state change; allDiagrams is the only dependency that affects the index.
  const entityUsageIndex = useMemo(() => buildEntityUsageIndex(allDiagrams), [allDiagrams]);

  // Per-diagram top-level processes (for the nav and DFD headings).
  const hasDiagrams = allDiagrams.length > 0;
  const hasProcesses = allProcessesDeep.length > 0;

  // Flow-item visibility sets (keyed by process id, external id, store name).
  const visibleProcessIds: Record<string, true> = {};
  const visibleExternalIds: Record<string, true> = {};
  const visibleStoreNames: Record<string, true> = {};

  if (!hasSearch) {
    for (const p of allProcessesDeep) visibleProcessIds[p.id] = true;
    for (const e of allExternals) visibleExternalIds[e.id] = true;
    for (const s of allNonDbStores) visibleStoreNames[s.name] = true;
  } else {
    for (const p of allProcessesDeep) {
      if (processMatchesSearch(p, term)) visibleProcessIds[p.id] = true;
    }
    for (const e of allExternals) {
      if (externalMatchesSearch(e, term)) visibleExternalIds[e.id] = true;
    }
    for (const s of allNonDbStores) {
      if (storeMatchesSearch(s, term)) visibleStoreNames[s.name] = true;
    }
  }

  const totalFlowVisible =
    Object.keys(visibleProcessIds).length +
    Object.keys(visibleExternalIds).length +
    Object.keys(visibleStoreNames).length;

  const hasAnyVisible = totalVisible > 0 || totalFlowVisible > 0;

  // CP9: stable dep signals for the highlight effect — avoids inline JSON.stringify
  // allocations on every render. Each is a sorted join of keys; changes only when
  // the visible set actually changes (i.e. after the filtered render lands in DOM).
  const visibleSetKey = useMemo(
    () => Object.keys(visibleSet).sort().join('\0'),
    // visibleSet is rebuilt each render; its contents (not identity) matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [term, model.nodes],
  );
  const visibleProcessKey = useMemo(
    () => Object.keys(visibleProcessIds).sort().join('\0'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [term, allProcessesDeep],
  );
  const visibleExternalKey = useMemo(
    () => Object.keys(visibleExternalIds).sort().join('\0'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [term, allExternals],
  );
  const visibleStoreKey = useMemo(
    () => Object.keys(visibleStoreNames).sort().join('\0'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [term, allNonDbStores],
  );

  // CP9: DOM highlight — apply CSS Custom Highlight API ranges over the visible
  // DD content whenever the committed search term changes. Runs after render so
  // the newly-visible sections are in the DOM. Clears on empty search.
  // Using useLayoutEffect (not useEffect) so highlights are applied synchronously
  // after DOM mutations, before the browser paints — avoids a flash of unhighlighted text.
  useLayoutEffect(() => {
    const HIGHLIGHT_NAME = 'dd-search-highlight';

    // Always clear previous highlight first.
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    }

    if (!term || !hasSearch) return;
    if (typeof CSS === 'undefined' || !CSS.highlights) return;

    const container = document.querySelector<HTMLElement>('[data-ignatius="dict-view"]');
    if (!container) return;

    // Exclude the search input itself from highlighting.
    const searchInput = container.querySelector('.dict-search-input');

    const lowerTerm = term.toLowerCase();
    const ranges: Range[] = [];

    // Walk all text nodes under the dict-view container, excluding the search box.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // Skip text inside the search input.
        if (searchInput && searchInput.contains(node)) return NodeFilter.FILTER_REJECT;
        const text = node.nodeValue ?? '';
        return text.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    let node = walker.nextNode();
    while (node !== null) {
      const text = node.nodeValue ?? '';
      const lower = text.toLowerCase();
      let idx = lower.indexOf(lowerTerm);
      while (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + term.length);
        ranges.push(range);
        idx = lower.indexOf(lowerTerm, idx + 1);
      }
      node = walker.nextNode();
    }

    if (ranges.length > 0) {
      const highlight = new Highlight(...ranges);
      CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    }
  // Depend on the committed search term and the memoized visible-set key signals
  // so the effect re-runs after React re-renders the filtered items into the DOM.
  }, [term, visibleSetKey, visibleProcessKey, visibleExternalKey, visibleStoreKey]);

  // Client-side upgrade pass: entity bodies are rendered at parse time with
  // knownIds = entity IDs only, so a [[Customer]] reference in an entity body
  // emits a `.entity-link--missing` span even when Customer exists as a flow
  // external. After the DD mounts, walk all `.entity-link--missing` spans inside
  // the dict-view container and upgrade those whose target matches any known node
  // (entity / external / store / process) to live `<a class="entity-link">` links
  // wired to scrollToSection via their data-entity attribute.
  // Runs after every render so newly-visible bodies (after search) are covered.
  useEffect(() => {
    const container = document.querySelector<HTMLElement>('[data-ignatius="dict-view"]');
    if (!container) return;

    // Build a full set of all known IDs across all node kinds.
    const allKnownIds = new Set<string>();
    for (const n of model.nodes) allKnownIds.add(n.id);
    for (const ext of allExternals) allKnownIds.add(ext.id);
    for (const proc of allProcessesDeep) allKnownIds.add(proc.id);
    for (const store of allNonDbStores) allKnownIds.add(store.name);

    upgradeMissingLinksInContainer(container, allKnownIds);
  // Re-run whenever the set of visible items changes (model change, search, diagram load).
  }, [model, allExternals, allProcessesDeep, allNonDbStores, visibleSetKey, visibleProcessKey, visibleExternalKey, visibleStoreKey]);

  function scrollToProcess(processId: string) {
    const el = document.getElementById(`process-${processId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Build side-nav subtypeIds per-group for indent styling.
  function groupSubtypeIds(groupNodes: ModelNode[]): Record<string, true> {
    const ids: Record<string, true> = {};
    for (const c of model.subtypeClusters) {
      if (groupNodes.some(n => n.id === c.basetype)) {
        for (const m of c.members) ids[m] = true;
      }
    }
    return ids;
  }

  return (
    <>
      {/* Side nav panel — entity groups + process nav */}
      <nav
        className={`dict-nav-panel${dictNavOpen ? ' dict-nav-open' : ''}`}
        aria-label="Entity and process navigation"
      >
        <div className="dict-nav-inner">
          {groupOrder.map(key => {
            const cfg = model.groups[key];
            if (!cfg) return null;
            const sorted = groupOrderedNodes[key];
            if (!sorted || sorted.length === 0) return null;
            const stIds = groupSubtypeIds(sorted);
            const visibleNodes = sorted.filter(n => visibleSet[n.id]);
            if (visibleNodes.length === 0) return null;
            return (
              <div key={key} className="dict-nav-group">
                <div className="dict-nav-group-label" style={{ color: cfg.color }}>{cfg.label}</div>
                {visibleNodes.map(n => (
                  <a
                    key={n.id}
                    className={`dict-nav-link${stIds[n.id] ? ' dict-nav-subtype' : ''}`}
                    href={`#entity-${n.id}`}
                    onClick={e => { e.preventDefault(); scrollToEntity(n.id); }}
                  >
                    {n.id}
                  </a>
                ))}
              </div>
            );
          })}

          {/* Process nav groups */}
          {hasDiagrams && hasProcesses && (
            <div className="dict-nav-process-group">
              {allDiagrams.map(diagram => {
                // Collect all processes from this diagram recursively (matches body render).
                function collectNavProcesses(diagrams: FlowDiagram[]): FlowProcess[] {
                  const result: FlowProcess[] = [];
                  for (const d of diagrams) {
                    result.push(...d.processes);
                    result.push(...collectNavProcesses(d.subDfds));
                  }
                  return result;
                }
                const visibleProcs = collectNavProcesses([diagram]).filter(p => visibleProcessIds[p.id]);
                if (visibleProcs.length === 0) return null;
                // Sort processes hierarchically by dotted number (1 → 1.1 → 1.2 → 2 → 3).
                const sortedProcs = [...visibleProcs].sort(compareDottedProcesses);
                return (
                  <div key={diagram.id} className="dict-nav-group">
                    <div className="dict-nav-group-label">
                      {allDiagrams.length > 1 ? diagram.id : 'Processes'}
                    </div>
                    {sortedProcs.map(p => {
                      const depth = p.dottedNumber.split('.').length - 1;
                      const indentStyle = depth > 0
                        ? { paddingLeft: `calc(1rem + ${depth}rem)`, fontSize: '0.78rem' }
                        : undefined;
                      return (
                        <a
                          key={p.id}
                          className="dict-nav-link"
                          style={indentStyle}
                          href={`#process-${p.id}`}
                          onClick={e => { e.preventDefault(); scrollToProcess(p.id); }}
                        >
                          {p.dottedNumber} {p.label}
                        </a>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Main dict content */}
      <div className="dict-view" data-ignatius="dict-view">
        {/* Search — spans entities + processes + externals + stores */}
        <div className="dict-search">
          <input
            type="search"
            className="dict-search-input"
            placeholder="Search entities, columns, processes, stores…"
            value={searchText}
            onChange={e => onSearchChange(e.currentTarget.value)}
            aria-label="Search dictionary"
          />
        </div>

        {/* Reader legend */}
        <details className="dict-reader-legend" open>
          <summary>How to read this</summary>
          <div className="dict-reader-legend-grid">
            <section className="dict-reader-legend-cell">
              <h3>Groups</h3>
              <ul className="dict-legend-list">
                {Object.entries(model.groups).map(([key, cfg]) => (
                  <li key={key} className="dict-legend-item">
                    <span className="dict-swatch" style={{ background: cfg.color }} />
                    <span className="dict-legend-label">{cfg.label}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="dict-reader-legend-cell">
              <h3>Classification</h3>
              <div className="dict-reader-legend-badges">
                {(['independent', 'dependent', 'associative', 'subtype', 'classifier'] as const).map(k => (
                  <span
                    key={k}
                    className="dict-badge"
                    style={{ background: `var(--badge-${k}-bg)`, color: `var(--badge-${k}-fg)` }}
                  >
                    {k}
                  </span>
                ))}
              </div>
              <p className="dict-reader-legend-note">Derived from the model — never authored directly.</p>
            </section>
            <section className="dict-reader-legend-cell">
              <h3>Predicate pills</h3>
              <div className="dict-reader-legend-pills">
                <span className="dict-predicate-pill dict-predicate-pill--primary">
                  is owned by<span className="dict-predicate-arrow"> →</span>
                </span>
                <span className="dict-predicate-pill dict-predicate-pill--inverse">
                  <span className="dict-predicate-arrow">← </span>owns
                </span>
              </div>
              <p className="dict-reader-legend-note">
                First pill: child's perspective. Second: parent as subject.
              </p>
            </section>
            <section className="dict-reader-legend-cell">
              <h3>Relationship type</h3>
              <p className="dict-reader-legend-note">
                <strong>Identifying</strong> — child PK contains parent PK.<br />
                <strong>Referential</strong> — FK reference, independent identity.
              </p>
            </section>
            <section className="dict-reader-legend-cell">
              <h3>Cardinality</h3>
              <p className="dict-reader-legend-note">
                Read as <code>parent → child</code>. <code>1 → many</code> = one parent, many children.
              </p>
            </section>
          </div>
        </details>

        {/* No-results message when search matches nothing across all kinds */}
        {hasSearch && !hasAnyVisible && (
          <p className="dict-no-results">No results match "{term}"</p>
        )}

        {/* Entity sections by group */}
        {groupOrder.map(key => {
          const cfg = model.groups[key];
          if (!cfg) return null;
          const sorted = groupOrderedNodes[key];
          if (!sorted || sorted.length === 0) return null;
          const visibleNodes = sorted.filter(n => visibleSet[n.id]);
          if (visibleNodes.length === 0) return null;
          return (
            <section key={key} className="dict-group-section">
              <div
                className="dict-group-header"
                style={{ borderLeft: `4px solid ${cfg.color}`, paddingLeft: '1rem' }}
              >
                <h1 className="dict-group-title" style={{ color: cfg.color }}>{cfg.label}</h1>
                {cfg.desc && (
                  <div
                    className="dict-group-desc"
                    dangerouslySetInnerHTML={{ __html: cfg.desc }}
                  />
                )}
              </div>
              {visibleNodes.map(n => (
                <DictEntitySection
                  key={n.id}
                  node={n}
                  edges={model.edges}
                  subtypeClusters={model.subtypeClusters}
                  entityErrors={entityErrors}
                  missingTargets={missingTargets}
                  onNavigate={scrollToSection}
                  onNavigateMissing={scrollToMissing}
                  processUsages={entityUsageIndex.get(n.id)}
                  onScrollToProcess={scrollToProcess}
                />
              ))}
            </section>
          );
        })}

        {/* Ungrouped entities */}
        {ungrouped.filter(n => visibleSet[n.id]).map(n => (
          <DictEntitySection
            key={n.id}
            node={n}
            edges={model.edges}
            subtypeClusters={model.subtypeClusters}
            entityErrors={entityErrors}
            missingTargets={missingTargets}
            onNavigate={scrollToSection}
            onNavigateMissing={scrollToMissing}
            processUsages={entityUsageIndex.get(n.id)}
            onScrollToProcess={scrollToProcess}
          />
        ))}

        {/* Missing entity placeholders */}
        {[...missingTargets].map(id => (
          <section key={id} id={`missing-${id}`} className="dict-missing-section">
            <h2>{id} (omitted)</h2>
            <p>This entity was referenced but does not exist in the model.</p>
          </section>
        ))}

        {/* ── Process-model section (CP5) ── */}
        {hasDiagrams && (
          <>
            <h2 className="flow-dict-section-heading">Process Model</h2>

            {/* Per-DFD process sections */}
            {allDiagrams.map(diagram => {
              // Recursively collect processes from this diagram and its sub-DFDs.
              function collectVisible(diagrams: FlowDiagram[]): FlowProcess[] {
                const result: FlowProcess[] = [];
                for (const d of diagrams) {
                  for (const p of d.processes) {
                    if (visibleProcessIds[p.id]) result.push(p);
                  }
                  result.push(...collectVisible(d.subDfds));
                }
                return result;
              }
              const visibleProcs = collectVisible([diagram]);
              if (visibleProcs.length === 0) return null;

              return (
                <div key={diagram.id}>
                  {allDiagrams.length > 1 && (
                    <h3 className="flow-dfd-heading" id={`dfd-${diagram.id}`}>{diagram.id}</h3>
                  )}
                  {visibleProcs.map(proc => (
                    <DictProcessSection
                      key={proc.id}
                      process={proc}
                      allProcesses={allProcessesDeep}
                      flowErrors={flowFindings.flowErrors}
                      onScrollToEntity={scrollToEntity}
                      onScrollToSection={scrollToSection}
                      externalIds={ddExternalIds}
                      nonDbStoreNames={ddNonDbStoreNames}
                    />
                  ))}
                </div>
              );
            })}

            {/* External entity sections */}
            {allExternals.filter(e => visibleExternalIds[e.id]).length > 0 && (
              <div className="flow-stores">
                {allExternals
                  .filter(e => visibleExternalIds[e.id])
                  .map(ext => (
                    <DictExternalSection key={ext.id} external={ext}>
                      {ext.bodyHtml && (
                        <div
                          className="dict-entity-body"
                          dangerouslySetInnerHTML={{ __html: ext.bodyHtml }}
                          onClick={handleDdBodyClick}
                        />
                      )}
                    </DictExternalSection>
                  ))
                }
              </div>
            )}

            {/* Non-db store sections — rendered under a dedicated "Data Stores" heading */}
            {allNonDbStores.filter(s => visibleStoreNames[s.name]).length > 0 && (
              <>
                <h2 className="flow-dict-section-heading">Data Stores</h2>
                <div className="flow-stores">
                  {allNonDbStores
                    .filter(s => visibleStoreNames[s.name])
                    .map(store => (
                      <DictStoreSection key={store.name} store={store}>
                        {store.bodyHtml && (
                          <div
                            className="dict-entity-body"
                            dangerouslySetInnerHTML={{ __html: store.bodyHtml }}
                            onClick={handleDdBodyClick}
                          />
                        )}
                      </DictStoreSection>
                    ))
                  }
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// FindingsPanel — persistent top-right panel listing all current findings.
//
// Renders when totalFindings > 0; hidden when zero (no empty chrome).
// Each row is a <details> accordion; opening an entity-scoped row fires
// onNavigate so the graph viewport pans + zooms + selects that entity.
// Global-scoped rows expand inline only (no entity to navigate to).
// ---------------------------------------------------------------------------

type FindingRow =
  | { kind: 'entity'; ruleId: RuleId; entityId: string; severity: 'warning'; message: string }
  | { kind: 'global'; ruleId: RuleId; severity: 'error'; location: string; reason: string }
  | { kind: 'flow'; ruleId: RuleId; severity: 'warning' | 'error'; location: string; message: string };

function buildFindingRows(
  globalErrors: GlobalError[],
  entityErrors: EntityError[],
  flowErrors?: FlowError[],
): FindingRow[] {
  const rows: FindingRow[] = [
    ...globalErrors.map((e): FindingRow => ({
      kind: 'global',
      ruleId: e.ruleId,
      severity: 'error',
      location: `${e.omitted.kind}:${e.omitted.id}`,
      reason: e.reason,
    })),
    ...entityErrors.map((e): FindingRow => ({
      kind: 'entity',
      ruleId: e.ruleId,
      entityId: e.entityId,
      severity: 'warning',
      message: e.message,
    })),
    ...(flowErrors ?? []).map((e): FindingRow => ({
      kind: 'flow',
      ruleId: e.ruleId,
      severity: e.severity,
      location: e.processId ? `${e.flowId}/${e.processId}` : e.flowId,
      message: e.message,
    })),
  ];

  // Sort: errors before warnings, then ruleId alphabetical, then location/entityId.
  rows.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
    const aLoc = a.kind === 'entity' ? a.entityId : a.location;
    const bLoc = b.kind === 'entity' ? b.entityId : b.location;
    return aLoc.localeCompare(bLoc);
  });

  return rows;
}

function FindingsPanel({
  globalErrors,
  entityErrors,
  flowErrors,
  collapsed,
  onCollapse,
  onExpand,
  onNavigate,
}: {
  globalErrors: GlobalError[];
  entityErrors: EntityError[];
  flowErrors?: FlowError[];
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onNavigate: (entityId: string) => void;
}) {
  const rows = buildFindingRows(globalErrors, entityErrors, flowErrors);
  const total = rows.length;

  if (total === 0) return null;

  if (collapsed) {
    return (
      <aside className="findings-panel findings-panel--collapsed">
        <button className="findings-panel-badge" onClick={onExpand}>
          ⚠ {total} {total === 1 ? 'issue' : 'issues'}
        </button>
      </aside>
    );
  }

  return (
    <aside className="findings-panel">
      <header className="findings-panel-header">
        <h3>Issues ({total})</h3>
        <button className="findings-panel-collapse" onClick={onCollapse} aria-label="Collapse panel">
          −
        </button>
      </header>
      <ul className="findings-panel-list">
        {rows.map((row, i) => {
          const rule = RULES[row.ruleId];
          const location = row.kind === 'entity' ? row.entityId : row.location;
          const detail = row.kind === 'entity' || row.kind === 'flow' ? row.message : row.reason;

          return (
            <li key={i}>
              <details
                onToggle={(e) => {
                  // Only navigate on open (not on close), and only for entity rows.
                  if ((e.target as HTMLDetailsElement).open && row.kind === 'entity') {
                    onNavigate(row.entityId);
                  }
                }}
              >
                <summary className="finding-summary">
                  <span className={`finding-severity finding-severity--${row.severity}`}>
                    {row.severity === 'error' ? 'ERR' : 'WARN'}
                  </span>
                  <span className="finding-rule">{row.ruleId}</span>
                  <span className="finding-location">{location}</span>
                </summary>
                <div className="finding-detail">
                  {rule && (
                    <>
                      <strong className="finding-detail-title">{rule.title}</strong>
                      <p className="finding-detail-explanation">{rule.explanation}</p>
                    </>
                  )}
                  <p className="finding-detail-message">{detail}</p>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// The graph viewer renders IDEF1X notation: entity identity by corner shape,
// relationship dependency by line style, cardinality by crow's-foot end markers,
// and subtype completeness by the discriminator diamond. The legend reproduces
// each symbol with the same theme CSS vars the graph uses so it tracks the active
// palette. Geometry mirrors src/markers.ts (bars, hollow circle, fanning prongs).
// When view === 'flow', renders the DFD node-kind legend using the themed FlowPalette.
function LegendModal({ onClose, view, themeMode, kindPalette }: {
  onClose: () => void;
  view: ViewName;
  themeMode: ThemeMode;
  kindPalette?: Record<FlowKindKey, FlowKindEntry>;
}) {
  const identifying = 'var(--color-edge-identifying)';
  const referential = 'var(--color-edge-referential)';

  if (view === 'flow') {
    const p: FlowPalette = themeMode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
    const kp = kindPalette ?? resolveFlowKindPalette(themeMode);

    // Per-kind store entries for the legend.
    const kindRows: Array<{ key: FlowKindKey; label: string; desc: string }> = [
      { key: 'db',     label: 'DB store',     desc: 'Data entity backed by a relational table (db:).' },
      { key: 'cache',  label: 'Cache',        desc: 'In-memory or distributed key-value cache.' },
      { key: 'queue',  label: 'Queue',        desc: 'Message queue or event bus.' },
      { key: 'file',   label: 'File store',   desc: 'Flat file, log, or blob storage.' },
      { key: 'doc',    label: 'Document',     desc: 'Document store (JSON/XML).' },
      { key: 'manual', label: 'Manual store', desc: 'Physical or human-operated store.' },
      { key: 'other',  label: 'Other store',  desc: 'Any store kind not covered above.' },
    ];

    return (
      <Modal title="Legend" onClose={onClose} className="legend-modal">
        <section className="legend-section">
          <h2 className="legend-section-title">Node kinds</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <span className="legend-entity" style={{ background: p.procFill, borderColor: p.procBorder, borderWidth: 2, borderStyle: 'solid', borderRadius: 6 }} />
            </span>
            <span className="legend-text">
              <strong className="legend-term">Process</strong>
              <span className="legend-desc">A numbered transformation that receives inputs and produces outputs.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <span className="legend-entity" style={{ background: kp.external.bg, borderColor: kp.external.border, borderWidth: 2, borderStyle: 'solid', borderRadius: 2 }} />
            </span>
            <span className="legend-text">
              <strong className="legend-term">External entity</strong>
              <span className="legend-desc">A source or sink of data that lies outside the system boundary.</span>
            </span>
          </div>
        </section>
        <section className="legend-section">
          <h2 className="legend-section-title">Data store kinds</h2>
          {kindRows.map(({ key, label, desc }) => (
            <div key={key} className="legend-row">
              <span className="legend-symbol">
                <span className="legend-entity" style={{ background: kp[key].bg, borderColor: kp[key].border, borderWidth: 2, borderStyle: 'solid', borderTopLeftRadius: 2, borderBottomLeftRadius: 2, borderTopRightRadius: 0, borderBottomRightRadius: 0 }} />
              </span>
              <span className="legend-text">
                <strong className="legend-term">{label}</strong>
                <span className="legend-desc">{desc}</span>
              </span>
            </div>
          ))}
        </section>
      </Modal>
    );
  }

  return (
    <Modal title="Legend" onClose={onClose} className="legend-modal">
        <section className="legend-section">
          <h2 className="legend-section-title">Entities</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <span className="legend-entity legend-entity--independent" />
            </span>
            <span className="legend-text">
              <strong className="legend-term">Independent entity</strong>
              <span className="legend-desc">Sharp corners. Identified by its own attributes — its primary key holds no foreign keys.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <span className="legend-entity legend-entity--dependent" />
            </span>
            <span className="legend-text">
              <strong className="legend-term">Dependent entity</strong>
              <span className="legend-desc">Rounded corners. Its identity depends on a parent — the primary key inherits a foreign key.</span>
            </span>
          </div>
        </section>

        <section className="legend-section">
          <h2 className="legend-section-title">Relationships</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="60" height="20" viewBox="0 0 60 20">
                <line x1="2" y1="10" x2="58" y2="10" stroke={identifying} strokeWidth="2" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Identifying</strong>
              <span className="legend-desc">Solid line. The parent key migrates into the child's primary key — the child cannot exist without the parent.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="60" height="20" viewBox="0 0 60 20">
                <line x1="2" y1="10" x2="58" y2="10" stroke={referential} strokeWidth="1.4" strokeDasharray="5 4" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Non-identifying</strong>
              <span className="legend-desc">Dashed line. The parent key migrates into a non-key column — a plain reference.</span>
            </span>
          </div>
        </section>

        <section className="legend-section">
          <h2 className="legend-section-title">Cardinality</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="24" viewBox="0 0 64 24">
                <line x1="2" y1="12" x2="40" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="40" y1="2" x2="40" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="47" y1="2" x2="47" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Exactly one</strong>
              <span className="legend-desc">Two bars. Mandatory and singular — one and only one.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="24" viewBox="0 0 64 24">
                <line x1="2" y1="12" x2="36" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="36" y1="2" x2="36" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="49" cy="12" r="6" fill="var(--color-background)" stroke={identifying} strokeWidth="1.8" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Zero or one</strong>
              <span className="legend-desc">Bar and hollow circle. Optional and singular — at most one.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="24" viewBox="0 0 64 24">
                <line x1="2" y1="12" x2="34" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="34" y1="12" x2="54" y2="2" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="34" y1="12" x2="54" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="34" y1="12" x2="54" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Many</strong>
              <span className="legend-desc">Crow's foot. Many on this end — zero or more.</span>
            </span>
          </div>
        </section>

        <section className="legend-section">
          <h2 className="legend-section-title">Subtypes</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="28" viewBox="0 0 64 28">
                <line x1="2" y1="14" x2="20" y2="14" stroke={identifying} strokeWidth="1.5" />
                <polygon points="32,4 44,14 32,24 20,14" fill="var(--color-background)" stroke={identifying} strokeWidth="2" />
                <line x1="44" y1="14" x2="62" y2="14" stroke={identifying} strokeWidth="1.5" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Inclusive subtype</strong>
              <span className="legend-desc">Plain diamond. A supertype row may belong to several subtypes — categories can overlap.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="28" viewBox="0 0 64 28">
                <line x1="2" y1="14" x2="20" y2="14" stroke={identifying} strokeWidth="1.5" />
                <polygon points="32,4 44,14 32,24 20,14" fill="var(--color-background)" stroke={identifying} strokeWidth="2" />
                <text x="32" y="14" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" fill={identifying}>X</text>
                <line x1="44" y1="14" x2="62" y2="14" stroke={identifying} strokeWidth="1.5" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Exclusive subtype</strong>
              <span className="legend-desc">Diamond marked X. Each supertype row is exactly one of the subtypes — categories are mutually exclusive.</span>
            </span>
          </div>
        </section>
    </Modal>
  );
}

// ── ZoomControl ──────────────────────────────────────────────────────────────
// View-agnostic zoom control: receives a zoom percentage + four handlers.
// No cytoscape or SVG internals inside — each view supplies its own adapter.
// 100% = the fit-to-view baseline (not cytoscape's internal zoom===1).

interface ZoomControlProps {
  percent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetPercent: (pct: number) => void;
  onReset: () => void;
}

function ZoomControl({ percent, onZoomIn, onZoomOut, onSetPercent, onReset }: ZoomControlProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function commitDraft() {
    setEditing(false);
    const parsed = parseInt(draft, 10);
    if (!isNaN(parsed) && parsed > 0) {
      onSetPercent(parsed);
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitDraft();
    if (e.key === 'Escape') setEditing(false);
  }

  function startEdit() {
    setDraft(String(percent));
    setEditing(true);
  }

  return (
    <div className="zoom-control" data-testid="zoom-control">
      <button className="zoom-control-btn" onClick={onZoomOut} title="Zoom out (−10%)" aria-label="Zoom out">−</button>
      {editing ? (
        <input
          className="zoom-control-input"
          type="text"
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={handleKeyDown}
          aria-label="Zoom percent"
        />
      ) : (
        <button
          className="zoom-control-readout"
          onClick={startEdit}
          title="Click to set zoom percent"
          aria-label={`Current zoom ${percent}%, click to edit`}
        >
          {percent}%
        </button>
      )}
      <button className="zoom-control-btn" onClick={onZoomIn} title="Zoom in (+10%)" aria-label="Zoom in">+</button>
      <button className="zoom-control-reset" onClick={onReset} title="Reset to fit view (100%)" aria-label="Reset zoom">⌂</button>
    </div>
  );
}

export function App() {
  const graphRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [findings, setFindings] = useState<{
    globalErrors: GlobalError[];
    entityErrors: EntityError[];
  }>({ globalErrors: [], entityErrors: [] });
  // Hoisted flow diagram state — populated by the unified app-level SSE effect so the
  // data survives view switches (graph→flow→graph leaves the subscription alive).
  // null = not yet fetched; [] = fetch returned empty / static mode with no model.
  const [flowDiagrams, setFlowDiagrams] = useState<FlowDiagram[] | null>(null);
  // Flow findings (flowErrors + globalErrors) from /api/flow — shared across all
  // views so the flow path AND future CP6 db-store dialog can read flow findings.
  // Seam for CP6: entity findings already live in `findings` above.
  const [flowFindings, setFlowFindings] = useState<{
    flowErrors: FlowError[];
    globalErrors: GlobalError[];
  }>({ flowErrors: [], globalErrors: [] });
  // Flow surface: ref to the FlowChrome React component for imperative state updates.
  const flowChromeRef = useRef<FlowChromeHandle>(null);
  // Flow surface: drill handlers registered by initFlowGraphCore via chromeCallbacks.onRegisterHandlers.
  // Stored in refs so the FlowChrome callbacks can call them without DOM extension.
  const flowDrillUpRef = useRef<((idx: number) => void) | null>(null);
  const flowSelectDiagramRef = useRef<((id: string) => void) | null>(null);
  // Retheme callback: updates the flow SVG palette without tearing down the renderer.
  const flowRethemeRef = useRef<((mode: 'dark' | 'light') => void) | null>(null);
  // Flow reset layout: registered by initFlowGraphCore so the shared FAB can trigger it.
  const flowResetLayoutRef = useRef<(() => void) | null>(null);
  // Tracks the currently selected top-level DFD id across SSE re-renders so the
  // renderer effect preserves the user's selection when flowDiagrams updates.
  // null = not yet selected (use diagrams[0] on first render).
  // Seeded from #dfd= on initial load so deep-linked DFDs render directly.
  const activeFlowDiagramIdRef = useRef<string | null>(
    (() => {
      const h = parseHash(location.hash);
      return (h.view === 'flow' && h.dfd) ? h.dfd : null;
    })(),
  );
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [cyInitError, setCyInitError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ModelNode | null>(null);
  const [showEntityModal, setShowEntityModal] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(() => {
    return localStorage.getItem('ignatius-minimap') === 'true';
  });
  const [cyReady, setCyReady] = useState(false);
  const [copyConfirm, setCopyConfirm] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Dictionary state — keep-mounted so search text + scroll survive view switches.
  const [dictSearchText, setDictSearchText] = useState('');
  const [dictNavOpen, setDictNavOpen] = useState(false);
  // Pending scroll target: set by onNavigateToProcess, consumed by the view-switch
  // useEffect once the dict container is visible and the process anchor exists.
  const pendingScrollProcessIdRef = useRef<string | null>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  // Set by the cytoscape useEffect; lets modal navigation update the hash
  // without re-entering the useEffect closure.
  const navigateToEntityRef = useRef<(id: string) => void>(() => {});
  function navigateToEntity(id: string) {
    navigateToEntityRef.current(id);
  }
  // Pan-free entity opener: selects the node and shows the rich SelectedEntityModal
  // WITHOUT panning the graph. Used by the flow viewer's db: store ⓘ badge so the
  // rich dialog opens even when the ERD graph is not mounted (flow surface).
  //
  // `fromFlow` marks the context: when true, the modal's FK/body/process-usage links
  // navigate in-place over the flow via flowOpenRef instead of switching views.
  function openEntityById(id: string, fromFlow = false) {
    const node = model?.nodes.find(n => n.id === id);
    if (node) {
      setEntityModalOpenedFromFlow(fromFlow);
      setSelected(node);
      setShowEntityModal(true);
    }
  }
  // Ref so the flow effect closure always calls the LIVE opener + reads the LIVE
  // model — without adding `model` to [view, flowDiagrams] deps (which would
  // rebuild/teardown the flow renderer on every entity-only SSE edit).
  const openEntityByIdRef = useRef<(id: string, fromFlow?: boolean) => void>(openEntityById);
  openEntityByIdRef.current = openEntityById;

  // Tracks whether the currently-open SelectedEntityModal was launched from the
  // Flows view (true) or from the Graph/DD view (false). Controls which nav handlers
  // are passed to the modal: flow-context → in-place via flowOpenRef; graph-context → graph pan / setView(dict).
  const [entityModalOpenedFromFlow, setEntityModalOpenedFromFlow] = useState(false);

  // When the flow surface registers its `open` dispatcher, we store it here so the
  // flow-context SelectedEntityModal can route process-usage links in-place without
  // switching to the Dictionary view.
  const flowOpenRef = useRef<((token: string) => void) | null>(null);
  // Ref to the live entity model — passed as a getter to buildFlowDocResolver so
  // the resolver's entity-id classification always sees the current model.
  const entityModelRef = useRef<Model | undefined>(undefined);
  entityModelRef.current = model ?? undefined;
  // Direct pan+zoom+select for the findings panel — bypasses hash roundtrip
  // so the viewport update is synchronous when a user clicks a panel row.
  const panelNavigateRef = useRef<(id: string) => void>(() => {});
  const menuRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  // Mirrors minimapOpen for the cy useEffect to read on mount without
  // adding minimapOpen to its dep array (which would rebuild the graph).
  const minimapOpenRef = useRef<boolean>(false);
  minimapOpenRef.current = minimapOpen;
  // Holds the active navigator instance so the runtime-toggle effect and
  // the cy effect's cleanup share a single source of truth.
  const navRef = useRef<NavigatorInstance | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (window.__THEME_MODE__) return window.__THEME_MODE__;
    const stored = localStorage.getItem('ignatius-theme');
    const initial: ThemeMode = stored === 'light' ? 'light' : 'dark';
    return initial;
  });
  // Ref so viewport/position listeners always read the current mode without needing cy rebuild
  const themeModeRef = useRef<ThemeMode>(themeMode);
  // Ref so drag-save and layoutstop-restore listeners always read the live
  // layoutKey (updated by SSE rebuilds) without forcing a graph rebuild.
  // Mirror of the themeModeRef / findingsRef pattern.
  const layoutKeyRef = useRef<string>('');
  // Set by the cy-init effect; lets the FAB "Reset layout" button clear the
  // saved arrangement and re-run ELK from outside the effect closure.
  const resetLayoutRef = useRef<(() => void) | null>(null);
  // Zoom control state for the Graph view.
  // zoomPercent: live readout (100 = fit-to-view baseline). Updated by cy 'zoom' event.
  const [zoomPercent, setZoomPercent] = useState(100);
  // The cy.zoom() value at the last cy.fit() — used to anchor 100% to fit, not cy==1.
  const zoomBaselineRef = useRef<number>(1);
  // Adapter refs wired by the cy-init effect so ZoomControl handlers work outside the closure.
  const cyZoomInRef = useRef<(() => void) | null>(null);
  const cyZoomOutRef = useRef<(() => void) | null>(null);
  const cySetPercentRef = useRef<((pct: number) => void) | null>(null);
  const cyZoomResetRef = useRef<(() => void) | null>(null);
  // Zoom control state for the Flows view.
  // flowZoomPercent: live readout (100 = SVG scale 1 = fit baseline).
  // Updated by onZoomChange callback from FlowDiagramSvg.
  const [flowZoomPercent, setFlowZoomPercent] = useState(100);
  // Adapter refs wired by onRegisterZoomControl from FlowDiagramSvg.
  const flowZoomToRef = useRef<((scale: number) => void) | null>(null);
  const flowResetFitRef = useRef<(() => void) | null>(null);
  // Live-scale mirror so onZoomIn/onZoomOut always read the current scale, not
  // the stale closure value captured from flowZoomPercent state.
  const flowScaleRef = useRef(1);
  // Layout algorithm mode. 'organic' = ELK stress (force-directed hub-and-spoke,
  // the default); 'hierarchical' = ELK layered (ranked rows). Toggled from the FAB
  // and persisted in localStorage so the last choice survives reloads.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    const stored = localStorage.getItem('ignatius-layout-mode');
    return stored === 'hierarchical' ? 'hierarchical' : 'organic';
  });
  // Ref mirror so the init + reset paths read the live mode without a graph rebuild.
  const layoutModeRef = useRef<LayoutMode>(layoutMode);
  layoutModeRef.current = layoutMode;
  // Set by the cy-init effect; re-runs the layout in a given mode from the FAB toggle.
  const applyLayoutModeRef = useRef<((mode: LayoutMode) => void) | null>(null);

  // In-app view: 'graph' | 'dict' | 'flow'. Seeded from the hash #view= param on load;
  // defaults to 'graph'. The hash always takes priority so deep links work.
  const [view, setView] = useState<ViewName>(() => {
    const fromHash = parseHash(location.hash).view;
    return fromHash ?? 'graph';
  });
  // Ref so effects can read the current view without re-running on every change.
  const viewRef = useRef<ViewName>(view);
  viewRef.current = view;

  // Write view into hash whenever it changes (does not clobber entity/zoom/pan).
  useEffect(() => {
    const current = parseHash(location.hash);
    const next: HashState = { ...current, view };
    const serialized = serializeHash(next);
    history.replaceState({}, '', serialized ? '#' + serialized : location.pathname);
  }, [view]);

  // Back/forward navigation: read #view= and #dfd= from hash and update state.
  useEffect(() => {
    function onPopState() {
      const fromHash = parseHash(location.hash);
      const newView = fromHash.view;
      if (newView && newView !== viewRef.current) {
        setView(newView);
      }
      // When staying on (or navigating back to) the flow view, swap the DFD
      // client-side via the registered selectDiagramById handler — no full reload.
      // selectDiagramById handles both top-level DFDs and sub-DFD ids, rebuilding
      // the breadcrumb stack so drill-up remains functional after back-nav.
      const newDfd = fromHash.dfd;
      if (newDfd && (newView === 'flow' || viewRef.current === 'flow')) {
        flowSelectDiagramRef.current?.(newDfd);
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Unified app-level data + SSE effect (CP3): runs once on mount, survives all
  // view switches. One EventSource drives refreshes for Graph, Flows, and Dictionary.
  // WHY unified: a single subscription avoids double-firing on every model-changed
  // event and makes the subscription count auditable (one = correct; two = bug).
  // WHY app-level: editing a .md must refresh ALL views, regardless of which is active.
  // Boot: co-fetches /api/model + /api/flow in parallel via Promise.all.
  // SSE: one model-changed listener re-fetches both in parallel.
  useEffect(() => {
    const mode = window.__IGNATIUS_MODE__;

    if (mode === 'static') {
      // Static mode: model + flows baked in at generation time, no SSE needed.
      if (window.__MODEL__) {
        const rawModel = window.__MODEL__;
        const validation = validateModel(rawModel);
        setModel(validation.cleanedModel);
        setFindings({
          globalErrors: validation.globalErrors,
          entityErrors: validation.entityErrors,
        });
        layoutKeyRef.current = window.__LAYOUT_KEY__ ?? '';
      }
      const rawDiagrams = window.__FLOW_MODEL__;
      if (rawDiagrams && rawDiagrams.length > 0) setFlowDiagrams(rawDiagrams);
      return;
    }

    // ── Live mode ─────────────────────────────────────────────────────────────

    type ModelApiPayload = {
      model: Model;
      parseGlobalErrors: GlobalError[];
      validation: { cleanedModel: Model; globalErrors: GlobalError[]; entityErrors: EntityError[] };
      layoutKey?: string;
    };

    type FlowApiPayload = {
      diagrams: FlowDiagram[];
      flowLayoutKeys: Record<string, string>;
      entityModel?: Model;
      validation?: FlowValidationResult;
    };

    // Named helper: apply an /api/model response into shared state.
    function applyModelPayload(payload: ModelApiPayload) {
      const allGlobal = [...payload.parseGlobalErrors, ...payload.validation.globalErrors];
      setModel(payload.validation.cleanedModel);
      setFindings({
        globalErrors: allGlobal,
        entityErrors: payload.validation.entityErrors,
      });
      layoutKeyRef.current = payload.layoutKey ?? '';
    }

    // Named helper: apply an /api/flow response into shared state.
    // Keeps window globals in sync (initFlowGraphCore reads them).
    function applyFlowPayload(payload: FlowApiPayload) {
      const { diagrams, flowLayoutKeys, entityModel, validation } = payload;
      if (diagrams && diagrams.length > 0) {
        window.__FLOW_MODEL__ = diagrams;
        window.__FLOW_LAYOUT_KEYS__ = flowLayoutKeys;
        if (entityModel) window.__MODEL__ = entityModel;
        setFlowDiagrams(diagrams);
      } else if (validation && (validation.flowErrors.length > 0 || validation.globalErrors.length > 0)) {
        // Parse/validation error produced zero diagrams — clear stale diagrams so the
        // flow view shows the findings panel instead of the previous (now-invalid) DFD.
        window.__FLOW_MODEL__ = [];
        window.__FLOW_LAYOUT_KEYS__ = flowLayoutKeys;
        setFlowDiagrams([]);
      }
      // When diagrams.length === 0 AND no errors: genuinely empty (no flows/ dir or empty
      // flows dir) — leave existing state untouched so boot and SSE behave consistently.
      if (validation) {
        setFlowFindings({
          flowErrors: validation.flowErrors,
          globalErrors: validation.globalErrors,
        });
      }
    }

    // Boot: co-fetch both endpoints once.
    function doModelFetch(): Promise<ModelApiPayload> {
      return fetch('/api/model').then(r => r.json());
    }
    function doFlowFetch(): Promise<FlowApiPayload> {
      return fetch('/api/flow').then(r => r.json());
    }

    Promise.all([doModelFetch(), doFlowFetch()])
      .then(([modelPayload, flowPayload]) => {
        applyModelPayload(modelPayload);
        applyFlowPayload(flowPayload);
      })
      .catch(err => console.error('[ignatius] boot co-fetch failed:', err));

    // One EventSource for all views.
    const es = new EventSource('/events');
    es.addEventListener('model-changed', () => {
      Promise.all([doModelFetch(), doFlowFetch()])
        .then(([modelPayload, flowPayload]) => {
          applyModelPayload(modelPayload);
          applyFlowPayload(flowPayload);
          setBannerDismissed(false);
          setSelected(prev => {
            if (!prev) return null;
            const updated = modelPayload.validation.cleanedModel.nodes.find(n => n.id === prev.id);
            return updated ?? null;
          });
        })
        .catch(err => console.error('[ignatius] SSE refetch failed:', err));
    });

    return () => es.close();
  }, []);

  // Flow renderer effect — view-keyed. Builds the flow SVG renderer when entering
  // 'flow' view; tears it down (unmounting React roots + clearing __IGNATIUS_FLOW_READY__)
  // when leaving. Data lives in the app-level flow effect above — no EventSource here.
  useEffect(() => {
    if (view !== 'flow') return;
    const container = graphRef.current;
    if (!container) return;

    // Tracks whether the first onActiveDiagramChange call has fired in this effect
    // run. The first call is always an auto-select (initial render) and must use
    // replaceState; all subsequent calls are user-driven and use pushState.
    let initialActivationDone = false;

    // Wire chrome callbacks so the FlowChrome component's state stays in sync
    // with the imperative SVG render core.
    const chromeCallbacks: FlowChromeCallbacks = {
      onStackChange: (stack) => {
        flowChromeRef.current?.setStack(stack);
      },
      onDiagramsChange: (all, activeId) => {
        flowChromeRef.current?.setDiagrams(all, activeId);
      },
      onRegisterHandlers: (drillUp, selectDiagram) => {
        flowDrillUpRef.current = drillUp;
        flowSelectDiagramRef.current = selectDiagram;
      },
      onViewChange: (data) => {
        flowChromeRef.current?.setMinimap(data);
      },
      onResetLayout: (fn) => {
        flowResetLayoutRef.current = fn;
      },
      onRegisterPanTo: (fn) => {
        flowChromeRef.current?.setMinimapPanTo(fn);
      },
      onRegisterRetheme: (fn) => {
        flowRethemeRef.current = fn;
      },
      onActiveDiagramChange: (id) => {
        activeFlowDiagramIdRef.current = id;
        window.__IGNATIUS_ACTIVE_FLOW_DFD__ = id;
        // Write the active DFD id into the URL hash so the view is deep-linkable.
        // Preserve existing hash fields (view, entity, zoom, pan) but always force
        // view=flow and update dfd to the current diagram id.
        const current = parseHash(location.hash);
        const next: HashState = { ...current, view: 'flow', dfd: id };
        const serialized = serializeHash(next);
        const newHash = serialized ? '#' + serialized : location.pathname;
        // Use replaceState on the very first activation in this effect run — the
        // initial auto-select of diagrams[0] or the preserved prevId. This avoids
        // polluting history: Back after switching to the flow view should return to
        // the pre-flow state, not loop through #view=flow (no dfd).
        // All subsequent activations (user-driven select/drill/drill-up) use pushState
        // so Back/Forward can replay each step. The local `initialActivationDone` flag
        // tracks this within the closure lifetime; it resets on each effect re-run
        // (i.e. on SSE re-render that rebuilds the renderer).
        if (!initialActivationDone || location.hash === newHash) {
          history.replaceState({}, '', newHash);
        } else {
          history.pushState({}, '', newHash);
        }
        initialActivationDone = true;
      },
      onZoomChange: (s) => {
        // SVG scale 1 = fit baseline = 100%. Round to nearest integer for the readout.
        flowScaleRef.current = s;
        setFlowZoomPercent(Math.round(s * 100));
      },
      onRegisterZoomControl: (ctrl) => {
        flowZoomToRef.current = ctrl ? ctrl.zoomTo : null;
        flowResetFitRef.current = ctrl ? ctrl.resetFit : null;
        // Reset readout to 100% when a new diagram mounts (scale starts at 1 = fit).
        if (ctrl) setFlowZoomPercent(100);
      },
    };
    // In live mode use hoisted flowDiagrams (set by the app-level flow effect above).
    // In static mode fall back to window.__FLOW_MODEL__ (no SSE, globals set at page-gen time).
    // Either way: no EventSource inside the renderer.
    const diagrams = window.__IGNATIUS_MODE__ === 'live'
      ? (flowDiagrams ?? [])
      : (window.__FLOW_MODEL__ ?? []);

    if (diagrams.length === 0) {
      // Data not yet arrived (live) or not injected (static). Nothing to render.
      return;
    }

    // Preserve the user's selected DFD across SSE re-renders.
    // Pass prevId as-is (top-level OR sub-DFD) — initFlowGraphCore resolves it
    // via findDiagramPath and falls back to diagrams[0] only when unresolvable
    // (stale/deleted id). No top-level-membership pre-filter here.
    const prevId = activeFlowDiagramIdRef.current;
    const startId = prevId ?? diagrams[0]!.id;

    // Pass a getter (not a snapshot) for the entity model so the resolver always
    // reads the LIVE entity-id set even when model changes via SSE without
    // triggering a flow-effect re-run. In static mode the model never changes, so
    // a getter over the ref still works correctly (entityModelRef.current = the
    // injected window.__MODEL__ parsed once at boot).
    const getEntityModel = window.__IGNATIUS_MODE__ === 'live'
      ? () => entityModelRef.current
      : () => window.__MODEL__;

    // Wrap the opener in a stable function that calls through the ref — so
    // FlowSurface always invokes the CURRENT openEntityById (which reads the
    // latest model) even after SSE updates that don't rebuild the flow renderer.
    // fromFlow=true so the modal's FK/body/process-usage links route in-place.
    const stableOpenEntity = (id: string) => openEntityByIdRef.current(id, true);

    // CP21: build the token-keyed usage index for ext/store Processes sections.
    const nodeUsageIndex = buildFlowNodeUsageIndex(diagrams);

    const cleanup = initFlowGraphCore(
      container,
      diagrams,
      startId,
      (id) => {
        activeFlowDiagramIdRef.current = id;
        window.__IGNATIUS_ACTIVE_FLOW_DFD__ = id;
      },
      chromeCallbacks,
      themeModeRef.current,
      getEntityModel,
      stableOpenEntity,
      (open) => { flowOpenRef.current = open; },
      () => entityModelRef.current?.theme,
      nodeUsageIndex,
    );
    return cleanup;
  }, [view, flowDiagrams]);

  // Re-theme the flow SVG whenever the theme changes while on the flow view.
  // Uses the registered retheme callback (set by initFlowGraphCore) which calls
  // root.render() with the new themeMode — React reconciles in-place without
  // unmounting, so the selected DFD and drill-down stack are preserved.
  useEffect(() => {
    if (view === 'flow') flowRethemeRef.current?.(themeMode);
  }, [themeMode, view]);

  // After a view switch to dict, execute any pending process-scroll that was set
  // by onNavigateToProcess. rAF is not enough — React may not have painted the dict
  // container yet when rAF fires. Running inside a committed useEffect guarantees
  // the DOM is up to date before we attempt scrollIntoView.
  useEffect(() => {
    if (view !== 'dict') return;
    const processId = pendingScrollProcessIdRef.current;
    if (!processId) return;
    pendingScrollProcessIdRef.current = null;
    // Use a short rAF inside the effect so the dict container has fully un-hidden
    // before we query the element (keep-mounted dict uses display:none visibility).
    requestAnimationFrame(() => {
      const el = document.getElementById(`process-${processId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [view]);

  // Apply CSS custom properties whenever the theme or mode changes
  useEffect(() => {
    if (model) applyThemeCssVars(model.theme, themeMode);
  }, [model, themeMode]);

  // Keep ref in sync with state so viewport listeners see the current mode
  useEffect(() => {
    themeModeRef.current = themeMode;
  }, [themeMode]);

  // Re-apply Cytoscape styles when mode changes (without rebuilding the graph).
  // Guard on view — buildStyles is ERD-only; must not run against a flow graph.
  useEffect(() => {
    if (view !== 'graph') return;
    if (!cyRef.current || !model || !svgRef.current) return;
    cyRef.current.style(buildStyles(model.groups, model.theme, themeMode));
    updateMarkers(cyRef.current, svgRef.current, model.theme, themeMode);
    const badgeIds = new Set(findings.entityErrors.map(e => e.entityId));
    drawWarningBadges(cyRef.current, svgRef.current, badgeIds);
  }, [themeMode]);

  // Toggle minimap at runtime WITHOUT rebuilding cy. The cy useEffect owns
  // the navigator's lifecycle whenever cy itself is being created/destroyed
  // — see its body for the mount-on-create + cleanup-before-cy.destroy()
  // path. This effect only handles the user-driven open/close after cy is
  // already alive.
  //
  // Why split? cytoscape-navigator's render is throttled; its trailing
  // setTimeout fires INDEPENDENTLY of cy's listener registry. If
  // nav.destroy() runs AFTER cy.destroy() — which is what happens in
  // StrictMode dev-double-invoke when two unrelated effects each manage
  // their own lifecycle — the trailing tick lands on a null renderer and
  // throws "Cannot read properties of null (reading 'png')". By making nav
  // teardown strictly nested inside cy teardown, the race is closed.
  useEffect(() => {
    if (!cyReady) return; // cy effect handles mount-time; ignore the readiness-flip itself.
    const cy = cyRef.current;
    if (!cy) return;

    // Gate on the same condition as the container: view must be 'graph'.
    // When the user switches to flow/dict, the #minimap-panel container unmounts
    // but this effect would not re-run without 'view' in the deps — leaving the
    // navigator alive with its cy 'resize' subscription. On return, cy is
    // destroyed/recreated, and the leaked navigator's trailing ResizeObserver calls
    // cy.boundingBox() on a destroyed core → headless() reads null → crash.
    if (view !== 'graph') {
      if (navRef.current) {
        teardownNavigator(navRef.current, minimapRef.current);
        navRef.current = null;
      }
      return;
    }

    if (minimapOpen) {
      // Mount once; the container is conditionally rendered, so guard on it.
      if (!navRef.current && minimapRef.current) navRef.current = mountNavigator(cy);
    } else if (navRef.current) {
      // Close: React has already unmounted the container (minimapRef.current is
      // null by now), so tear down on navRef alone. Bailing on a null container
      // would leak the navigator — still subscribed to cy 'resize' — and a
      // trailing resize after the next cy.destroy() throws on the null core.
      teardownNavigator(navRef.current, minimapRef.current);
      navRef.current = null;
    }
  }, [minimapOpen, cyReady, view]);

  function toggleTheme() {
    const next: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
    localStorage.setItem('ignatius-theme', next);
    setThemeMode(next);
  }

  function toggleMinimapOpen() {
    const next = !minimapOpen;
    localStorage.setItem('ignatius-minimap', String(next));
    setMinimapOpen(next);
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopyConfirm(true);
      setMenuOpen(false);
      setTimeout(() => setCopyConfirm(false), 1500);
    });
  }

  // Close menu on outside click or Esc
  useEffect(() => {
    if (!menuOpen) return;

    function onMouseDown(e: MouseEvent) {
      if (!(e.target instanceof Node)) return;
      const fab = fabRef.current;
      const menu = menuRef.current;
      if (!fab || !menu) return;
      if (!fab.contains(e.target) && !menu.contains(e.target)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        fabRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  // Ref so badge-drawing always sees current findings without adding findings to
  // the cy useEffect dep array (which would rebuild the graph on each live update).
  const findingsRef = useRef(findings);
  findingsRef.current = findings;

  useEffect(() => {
    // ERD graph renderer: only active when view === 'graph'.
    // On view leave, the cleanup below destroys Cytoscape and clears __IGNATIUS_CY__.
    if (view !== 'graph') return;
    if (!model || !graphRef.current) return;

    // Capture as a non-null binding so nested closures don't re-check
    const modelNonNull = model;
    const elements: cytoscape.ElementDefinition[] = [];

    // Build a set of subtype edges (child→parent) so we can rewire them through joiners
    const subtypeEdgeKeys = new Set<string>();
    for (const cluster of model.subtypeClusters) {
      for (const member of cluster.members) {
        subtypeEdgeKeys.add(`${member}-${cluster.basetype}`);
      }
    }

    for (const node of model.nodes) {
      elements.push({
        data: {
          id: node.id,
          label: wrapEntityLabel(node.id),
          classification: node.classification,
          group: node.group ?? '',
        },
      });
    }

    // Add compound cluster nodes, joiner nodes, and rewire subtype edges
    for (const cluster of model.subtypeClusters) {
      const clusterId = `_cluster_${cluster.basetype}_${cluster.exclusive ? 'x' : 'i'}`;
      const joinerId = `_joiner_${cluster.basetype}_${cluster.exclusive ? 'x' : 'i'}`;

      // Invisible compound parent that groups the subtypes
      elements.push({
        data: {
          id: clusterId,
          label: '',
          cluster: 'true',
        },
      });

      // Joiner sits between basetype and compound (not inside it)
      elements.push({
        data: {
          id: joinerId,
          label: cluster.exclusive ? 'X' : '',
          joiner: 'true',
          exclusive: String(cluster.exclusive),
        },
      });

      // Edge from basetype to joiner
      elements.push({
        data: {
          id: `${cluster.basetype}-${joinerId}`,
          source: cluster.basetype,
          target: joinerId,
          identifying: 'true',
          edgeLabel: '',
          parentCard: '1',
          childCard: '',
          subtypeEdge: 'true',
        },
      });

      // Each subtype is a child of the compound, with edge from joiner
      for (const member of cluster.members) {
        // Set parent on the existing node element
        const nodeEl = elements.find(e => e.data.id === member);
        if (nodeEl) nodeEl.data.parent = clusterId;

        elements.push({
          data: {
            id: `${joinerId}-${member}`,
            source: joinerId,
            target: member,
            identifying: 'true',
            edgeLabel: '',
            parentCard: '',
            childCard: '0..1',
            subtypeEdge: 'true',
          },
        });
      }
    }

    for (const edge of model.edges) {
      // Skip subtype edges — they've been rewired through joiners
      if (subtypeEdgeKeys.has(`${edge.source}-${edge.target}`)) continue;

      elements.push({
        data: {
          id: `${edge.source}-${edge.target}`,
          source: edge.target,
          target: edge.source,
          identifying: String(edge.identifying),
          predicateFwd: edge.predicate.fwd,
          predicateRev: edge.predicate.rev,
          edgeLabel: edge.predicate.fwd,
          predicateMode: 'fwd',
          parentCard: edge.cardinality.parent,
          childCard: edge.cardinality.child,
        },
      });
    }

    const longestPredicate = model.edges.reduce(
      (max, e) => Math.max(max, e.predicate.fwd.length), 0
    );
    const charWidth = 6; // ~6px per char at font-size 10
    const markerPadding = 50; // room for markers on both ends
    const layerPadding = 30; // extra breathing room between layers
    const layerSpacing = Math.max(110, longestPredicate * charWidth + markerPadding + layerPadding);

    // Two switchable layout algorithms (FAB toggle):
    //   hierarchical → ELK layered  (ranked rows; identification reads top-down)
    //   organic      → ELK stress   (force-directed hub-and-spoke; relatedness reads spatially)
    // Stress edge length scales off the layered layer spacing so the two feel comparable.
    const buildLayoutOpts = (mode: LayoutMode): cytoscape.LayoutOptions => {
      if (mode === 'organic') {
        return {
          name: 'elk',
          elk: {
            algorithm: 'stress',
            // Roomier than layered so hubs (and their cluster fans) land farther
            // apart — leaves space for fanSubtypeClusters and minimises collisions.
            'elk.stress.desiredEdgeLength': String(Math.max(280, Math.round(layerSpacing * 1.6))),
            'elk.spacing.nodeNode': String(Math.max(120, model.theme.spacing.nodeSep)),
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
          },
        } as cytoscape.LayoutOptions;
      }
      return {
        name: 'elk',
        elk: {
          algorithm: 'layered',
          'elk.direction': 'DOWN',
          'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
          'elk.spacing.nodeNode': String(model.theme.spacing.nodeSep),
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
          // Greedy post-pass: swap adjacent nodes whenever it removes a crossing.
          'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
          // More crossing-minimization iterations (default 7). Slower, fewer crossings.
          'elk.layered.thoroughness': '30',
          'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
          // Pull edges toward straight lines, reducing near-crossings.
          'elk.layered.nodePlacement.favorStraightEdges': 'true',
          'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
          'elk.layered.compaction.postCompaction.strategy': 'NONE',
          'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        },
      } as cytoscape.LayoutOptions;
    };

    const elkLayoutOpts = buildLayoutOpts(layoutModeRef.current);

    let cy: cytoscape.Core;
    try {
      cy = cytoscape({
        container: graphRef.current,
        elements,
        layout: elkLayoutOpts,
        style: buildStyles(model.groups, model.theme, themeMode),
        minZoom: 0.3,
        maxZoom: 3,
        // Tamed wheel sensitivity — cytoscape default (~1) is too aggressive for
        // precise navigation. 0.2 gives a small, controllable step per scroll notch.
        wheelSensitivity: 0.2,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ignatius] Cytoscape init failed:', msg);
      setCyInitError(msg);
      return;
    }
    window.__IGNATIUS_CY__ = cy;
    window.__IGNATIUS_CY_GEN__ = (window.__IGNATIUS_CY_GEN__ ?? 0) + 1;

    if (!svgRef.current) {
      svgRef.current = createMarkerOverlay(graphRef.current);
    }
    const svg = svgRef.current;

    const redrawMarkers = () => {
      if (cy.destroyed()) return;
      updateMarkers(cy, svg, model.theme, themeModeRef.current);
      // Draw warning badges for entities with findings on top of crow's-foot markers.
      // Reads findingsRef so badge set stays current without adding findings as a dep.
      const badgeIds = new Set(findingsRef.current.entityErrors.map(e => e.entityId));
      drawWarningBadges(cy, svg, badgeIds);
    };



    // Tracks the last hash string we wrote ourselves, to break the hashchange feedback loop.
    let lastWrittenHash = '';

    // Debounced writer: pan+zoom+entity all share one 200ms window.
    let writeTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleHashWrite(next: HashState) {
      if (writeTimer !== null) clearTimeout(writeTimer);
      writeTimer = setTimeout(() => {
        writeTimer = null;
        const serialized = serializeHash(next);
        lastWrittenHash = serialized;
        history.replaceState({}, '', serialized ? '#' + serialized : location.pathname);
      }, 200);
    }

    // Reads current viewport (zoom + pan only) into a HashState — no entity lookup.
    // Always includes the current view so hash writes don't clobber #view=.
    function viewportState(): HashState {
      const zoom = cy.zoom();
      const pan = cy.pan();
      return {
        view: viewRef.current,
        zoom: Math.round(zoom * 1000) / 1000,
        pan: { x: Math.round(pan.x), y: Math.round(pan.y) },
      };
    }

    // Reads current viewport + selected entity into a HashState for writing.
    function currentHashState(): HashState {
      const state = viewportState();
      const sel = cy.$('node:selected').first();
      if (sel.length > 0 && !String(sel.id()).startsWith('_')) {
        state.entity = sel.id();
      }
      return state;
    }

    // Applies a parsed HashState to the cy instance.
    // Order: zoom → pan → entity select+center.
    function applyHashState(state: HashState) {
      if (state.zoom !== undefined) {
        cy.zoom(state.zoom);
      }
      if (state.pan !== undefined) {
        cy.pan(state.pan);
      }
      if (state.entity !== undefined) {
        const target = cy.$(`#${CSS.escape(state.entity)}`);
        if (target.length > 0) {
          cy.elements().unselect();
          target.select();
          // Only center if no explicit pan was supplied
          if (state.pan === undefined) {
            cy.center(target);
          }
          const node = modelNonNull.nodes.find(n => n.id === state.entity);
          if (node) {
            setSelected(node);
            setShowEntityModal(true);
          }
        }
        // Unknown entity: silently ignore
      }
    }

    const layoutStore = createLayoutStore();
    cy.one('layoutstop', () => {
      // Restore saved positions (if any) BEFORE fitting, so the fit centers on
      // the user-arranged layout. All-or-nothing: key match → restore all; miss → ELK stands.
      const savedKey = layoutKeyRef.current;
      const saved = savedKey ? layoutStore.load(savedKey) : null;
      if (saved) {
        for (const [id, pos] of Object.entries(saved)) {
          const node = cy.$id(id);
          // Skip compound parents (subtype-cluster boxes): setting a parent's
          // position translates its children, displacing them from their own
          // saved absolute positions. Restore children only; the parent's
          // bounding box recomputes around them.
          if (!node.empty() && !node.isParent()) node.position(pos);
        }
      } else if (layoutModeRef.current === 'organic') {
        // Organic initial layout (e.g. an SSE rebuild while toggled to organic):
        // arrange clusters into fans and clear overlaps so it doesn't render messy.
        arrangeOrganic(cy);
      }

      cy.fit(undefined, 30);
      redrawMarkers();

      // Anchor 100% to this fit zoom so the readout is intuitive.
      zoomBaselineRef.current = cy.zoom();
      setZoomPercent(100);

      // Restore state from URL hash after layout settles (no race with ELK)
      const initialState = parseHash(location.hash);
      if (Object.keys(initialState).length > 0) {
        applyHashState(initialState);
      }
    });

    cy.on('viewport', () => {
      redrawMarkers();
      scheduleHashWrite(currentHashState());
    });

    // Zoom control readout — keep zoomPercent in sync with every wheel/pinch/button zoom.
    cy.on('zoom', () => {
      const baseline = zoomBaselineRef.current;
      if (baseline > 0) {
        setZoomPercent(Math.round(cy.zoom() / baseline * 100));
      }
    });

    // Zoom adapter functions — wired to refs so the ZoomControl can call them.
    // All zoom operations go about the viewport center (rendered/screen coordinates).
    const getViewportCenter = () => {
      const el = graphRef.current;
      if (!el) return { x: 0, y: 0 };
      return { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    };

    cyZoomInRef.current = () => {
      const step = 0.1;
      const next = cy.zoom() * (1 + step);
      const clamped = Math.min(next, cy.maxZoom());
      cy.zoom({ level: clamped, renderedPosition: getViewportCenter() });
    };

    cyZoomOutRef.current = () => {
      const step = 0.1;
      const next = cy.zoom() / (1 + step);
      const clamped = Math.max(next, cy.minZoom());
      cy.zoom({ level: clamped, renderedPosition: getViewportCenter() });
    };

    cySetPercentRef.current = (pct: number) => {
      const target = zoomBaselineRef.current * (pct / 100);
      const clamped = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), target));
      cy.zoom({ level: clamped, renderedPosition: getViewportCenter() });
    };

    cyZoomResetRef.current = () => {
      cy.fit(undefined, 30);
      zoomBaselineRef.current = cy.zoom();
      setZoomPercent(100);
    };

    cy.on('position', redrawMarkers);

    cy.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id();
      const node = model.nodes.find(n => n.id === nodeId);
      if (node) {
        setSelected(node);
        setShowEntityModal(true);
        // Use nodeId directly — cy.$('node:selected') hasn't updated yet at tap time.
        scheduleHashWrite({ ...viewportState(), entity: nodeId });
      }
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelected(null);
        setShowEntityModal(false);
        // Clear entity from hash when background tap deselects.
        scheduleHashWrite(viewportState());
      }
    });

    // Expose hash writes to JSX paths outside this closure (e.g. modal links).
    navigateToEntityRef.current = (id: string) => {
      scheduleHashWrite({ ...viewportState(), entity: id });
    };

    // Clears saved arrangement for the current layoutKey and re-runs ELK from scratch.
    // cy.one('layoutstop') at init already fired — the reset closure handles fit/markers itself.
    resetLayoutRef.current = () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      layoutStore.clear(layoutKeyRef.current);
      const mode = layoutModeRef.current;
      const lo = cy.layout(buildLayoutOpts(mode));
      lo.one('layoutstop', () => {
        if (mode === 'organic') arrangeOrganic(cy);
        cy.fit(undefined, 30);
        redrawMarkers();
        // Re-anchor zoom baseline after a fresh layout fit.
        zoomBaselineRef.current = cy.zoom();
        setZoomPercent(100);
      });
      lo.run();
    };

    // Switch layout algorithm live from the FAB toggle — re-runs ELK in the
    // requested mode and refits, without rebuilding the graph or clearing saved
    // positions. (Drag-to-save still overrides on the next 'free' event.)
    applyLayoutModeRef.current = (mode) => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      const lo = cy.layout(buildLayoutOpts(mode));
      lo.one('layoutstop', () => {
        // Organic layout stretches identifying edges and can collide nearby fans;
        // re-arrange clusters into tidy fans and clear overlaps before fitting.
        if (mode === 'organic') arrangeOrganic(cy);
        cy.fit(undefined, 30);
        redrawMarkers();
        // Re-anchor zoom baseline after a layout mode switch.
        zoomBaselineRef.current = cy.zoom();
        setZoomPercent(100);
      });
      lo.run();
    };

    // Direct navigate for the findings panel: select + center immediately, then sync hash.
    panelNavigateRef.current = (id: string) => {
      const target = cy.$(`#${CSS.escape(id)}`);
      if (target.length === 0) return;
      cy.elements().unselect();
      target.select();
      cy.center(target);
      const node = modelNonNull.nodes.find(n => n.id === id);
      if (node) setSelected(node);
      scheduleHashWrite({ ...viewportState(), entity: id });
    };

    // hashchange: re-apply if different from what we last wrote (avoids feedback loops)
    function onHashChange() {
      const newHash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
      if (newHash === lastWrittenHash) return;
      lastWrittenHash = newHash;
      applyHashState(parseHash(location.hash));
    }
    window.addEventListener('hashchange', onHashChange);

    // Compute screen-direction-aware arrow placement.
    // Cytoscape autorotate flips text 180° when the edge angle would render it
    // upside-down. We bake the arrow into the label, so it must flip with the text.
    // Returns the verb wrapped with an arrow that always visually points to the
    // intended end (child for fwd, parent for rev) on screen.
    function applyArrow(edge: cytoscape.EdgeSingular, verb: string, dir: 'fwd' | 'rev'): string {
      if (!verb) return '';
      const s = edge.sourceEndpoint();
      const t = edge.targetEndpoint();
      if (!s || !t || !Number.isFinite(s.x) || !Number.isFinite(t.x)) {
        return dir === 'fwd' ? `${verb} →` : `← ${verb}`;
      }
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      // Autorotate flips when the edge angle would point text upside-down.
      // The flip threshold matches the model-coordinate direction (dx<0).
      const flipped = dx < 0;
      if (dir === 'fwd') return flipped ? `← ${verb}` : `${verb} →`;
      return flipped ? `${verb} →` : `← ${verb}`;
      // Suppress unused-var if dy isn't read; reserved for future tuning.
      void dy;
    }

    // Refresh all edge labels with current direction-aware arrows. Called after
    // layout, drag, and on mount once nodes have positions. Reads predicateMode
    // so hovered child-end edges (showing rev) also re-orient during drag.
    function refreshArrows() {
      cy.edges().forEach((edge) => {
        const fwd = edge.data('predicateFwd');
        if (fwd === undefined) return;
        const mode = edge.data('predicateMode') as 'fwd' | 'rev' | undefined;
        if (mode === 'rev') {
          const rev = edge.data('predicateRev');
          edge.data('edgeLabel', applyArrow(edge, rev, 'rev'));
        } else {
          edge.data('edgeLabel', applyArrow(edge, fwd, 'fwd'));
        }
      });
    }

    cy.on('layoutstop', refreshArrows);
    cy.on('position', 'node', refreshArrows);
    cy.on('drag', 'node', refreshArrows);
    cy.on('free', 'node', refreshArrows);
    // Initial pass: edges were created with raw verb text — apply arrows once
    // positions are settled. Defer one tick so the initial layout completes.
    setTimeout(refreshArrows, 0);

    // Save node positions to localStorage on drag-end (~400ms debounced).
    // Keyed by layoutKeyRef so SSE rebuilds always write under the current key.
    // Skip when the key is absent (e.g. server hasn't responded yet).
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    cy.on('free', 'node', () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const key = layoutKeyRef.current;
        if (!key) return;
        const positions: Record<string, { x: number; y: number }> = {};
        cy.nodes().forEach((node) => {
          const pos = node.position();
          positions[node.id()] = { x: pos.x, y: pos.y };
        });
        layoutStore.save(key, positions);
      }, 400);
    });

    // Walk the key-inheritance lineage upward from a node to the root(s).
    // Graph edges run parent→child, so an incoming edge points to a child; we
    // follow only identifying edges (key inherited) and stop at referential
    // ones — signifying you can reach the root because the key travels with you.
    // Joiner nodes (basetype→joiner→subtype) are identifying, so subtype lineage
    // passes through them transparently up to the basetype and beyond.
    function collectLineage(start: cytoscape.NodeCollection) {
      let acc = cy.collection();
      let frontier = start;
      const seen = new Set<string>([start.id()]);
      while (frontier.nonempty()) {
        const inEdges = frontier.incomers('edge[identifying = "true"]');
        if (inEdges.empty()) break;
        const parents = inEdges.sources();
        acc = acc.union(inEdges).union(parents);
        frontier = parents.filter((p) => {
          if (seen.has(p.id())) return false;
          seen.add(p.id());
          return true;
        });
      }
      return acc;
    }

    // Walk the key-inheritance lineage DOWNWARD from a node to its leaves: follow
    // outgoing identifying edges (parent→child) so a node's identifying children —
    // and, through joiners, a basetype's subtypes — light up alongside its ancestry.
    function collectDescendants(start: cytoscape.NodeCollection) {
      let acc = cy.collection();
      let frontier = start;
      const seen = new Set<string>([start.id()]);
      while (frontier.nonempty()) {
        const outEdges = frontier.outgoers('edge[identifying = "true"]');
        if (outEdges.empty()) break;
        const children = outEdges.targets();
        acc = acc.union(outEdges).union(children);
        frontier = children.filter((c) => {
          if (seen.has(c.id())) return false;
          seen.add(c.id());
          return true;
        });
      }
      return acc;
    }

    // Hover handlers: swap incident edge labels to the node's perspective, restore on mouseout.
    // On mouseover node N: edges where N is the child (edge.target() === N) flip to rev.
    // On mouseout: all connected edges restore to fwd.
    cy.on('mouseover', 'node', (evt) => {
      const n = evt.target;
      n.connectedEdges().forEach((edge) => {
        const rev = edge.data('predicateRev');
        if (rev === undefined) return; // cluster/joiner edges — skip
        if (edge.target().id() === n.id()) {
          edge.data('predicateMode', 'rev');
          edge.data('edgeLabel', applyArrow(edge, rev, 'rev'));
        }
      });
      const direct = n.closedNeighborhood().union(n);
      const joiners = direct.nodes('[joiner = "true"]');
      const lineage = collectLineage(n);
      const descendants = collectDescendants(n);
      const keep = direct.union(joiners.incomers()).union(lineage).union(descendants);
      const keepWithAncestors = keep.union(keep.ancestors());
      cy.elements().difference(keepWithAncestors).addClass('faded');
      n.addClass('hover-focus');
      redrawMarkers();
    });

    cy.on('mouseout', 'node', (evt) => {
      const n = evt.target;
      n.connectedEdges().forEach((edge) => {
        const fwd = edge.data('predicateFwd');
        if (fwd === undefined) return;
        edge.data('predicateMode', 'fwd');
        edge.data('edgeLabel', applyArrow(edge, fwd, 'fwd'));
      });
      cy.elements().removeClass('faded');
      cy.nodes().removeClass('hover-focus');
      redrawMarkers();
    });

    cyRef.current = cy;

    // Mount navigator HERE — inside the cy lifecycle — so its teardown is
    // guaranteed to run before cy.destroy() nulls the renderer. See the
    // toggle effect above for the why.
    if (minimapOpenRef.current && minimapRef.current) {
      navRef.current = mountNavigator(cy);
    }

    setCyReady(true);
    return () => {
      // Tear down nav FIRST so any pending throttled tick is cancelled
      // before cy.destroy() nulls _private.renderer.
      if (navRef.current) {
        teardownNavigator(navRef.current, minimapRef.current);
        navRef.current = null;
      }
      if (writeTimer !== null) clearTimeout(writeTimer);
      if (saveTimer !== null) clearTimeout(saveTimer);
      window.removeEventListener('hashchange', onHashChange);
      navigateToEntityRef.current = () => {};
      panelNavigateRef.current = () => {};
      resetLayoutRef.current = null;
      applyLayoutModeRef.current = null;
      cyZoomInRef.current = null;
      cyZoomOutRef.current = null;
      cySetPercentRef.current = null;
      cyZoomResetRef.current = null;
      cy.destroy();
      cyRef.current = null;
      window.__IGNATIUS_CY__ = undefined;
      setCyReady(false);
      if (svgRef.current) {
        svgRef.current.remove();
        svgRef.current = null;
      }
    };
  }, [model, view]);

  const groupEntries = model ? Object.entries(model.groups) : [];

  const branding = model?.branding;
  const logoSrc = branding
    ? (themeMode === 'dark' ? branding.logo.dark : branding.logo.light)
    : undefined;

  // Error fallback — cytoscape init threw; render banner instead of blank canvas
  if (cyInitError) {
    return (
      <div className="graph-error-fallback">
        <div className="graph-error-fallback-box">
          <h2>Graph failed to render</h2>
          <p>The graph initializer encountered an error. The model may contain data that Cytoscape cannot process. Check the global errors below and correct the model.</p>
          <pre>{cyInitError}</pre>
        </div>
      </div>
    );
  }

  // Memoize the entity ↔ process usage index so it is only rebuilt when the flow
  // diagrams list changes — not on every render (finding 5).
  const entityUsageIndex = useMemo(
    () => (flowDiagrams ? buildEntityUsageIndex(flowDiagrams) : null),
    [flowDiagrams],
  );

  // Full set of flow + entity node IDs for the flow-opened SelectedEntityModal's
  // upgrade pass. Memoized so it only rebuilds when diagrams or model changes.
  const appAllFlowNodeIds = useMemo(
    () => (flowDiagrams ? buildAllFlowNodeIds(flowDiagrams, model ?? undefined) : null),
    [flowDiagrams, model],
  );

  const showBanner = !bannerDismissed && findings.globalErrors.length > 0;
  const isFlowSurface = view === 'flow';
  const isLiveMode = window.__IGNATIUS_MODE__ === 'live';
  // Callbacks wired to the imperative drill handlers registered via chromeCallbacks.onRegisterHandlers.
  function handleFlowDrillUp(idx: number) {
    flowDrillUpRef.current?.(idx);
  }
  function handleFlowSelectDiagram(id: string) {
    flowSelectDiagramRef.current?.(id);
  }

  return (
    <div className="app">
      {/* ── ERD surface chrome (hidden on flow surface) ── */}
      {!isFlowSurface && showBanner && (
        <div className="graph-global-banner" role="alert">
          <button
            className="graph-global-banner-close"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
          >
            ×
          </button>
          {findings.globalErrors.map((err, i) => (
            <div key={i} className="graph-global-banner-row">
              <strong>{RULES[err.ruleId]?.title ?? err.ruleId}:</strong>
              <span>{err.reason}</span>
            </div>
          ))}
        </div>
      )}

      {/* Shared: the container div that hosts both Cytoscape (ERD) and SVG (flow) */}
      <div className="graph-panel" ref={graphRef} />

      {/* ── DictionaryView (CP4) — keep-mounted via CSS hide; search + scroll survive detours ── */}
      {model ? (
        <div style={{ display: view === 'dict' ? 'block' : 'none' }}>
          <DictionaryView
            model={model}
            findings={findings}
            flowDiagrams={flowDiagrams}
            flowFindings={flowFindings}
            searchText={dictSearchText}
            onSearchChange={setDictSearchText}
            dictNavOpen={dictNavOpen}
            onToggleNav={() => setDictNavOpen(prev => !prev)}
          />
        </div>
      ) : view === 'dict' ? (
        <div
          style={{ position: 'fixed', inset: 0, background: 'var(--color-background)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          data-ignatius="dict-loading"
        >
          <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
        </div>
      ) : null}

      {/* ── Flow surface chrome ── */}
      {isFlowSurface && (
        <FlowChrome
          ref={flowChromeRef}
          onSelectDiagram={handleFlowSelectDiagram}
          onDrillUp={handleFlowDrillUp}
          themeMode={themeMode}
        />
      )}

      {/* ── ERD surface chrome (hidden on flow surface) ── */}
      {view === 'graph' && minimapOpen && <div ref={minimapRef} id="minimap-panel" className="minimap" />}
      {/* Zoom control — Graph view: wired to cytoscape adapter */}
      {view === 'graph' && cyReady && (
        <ZoomControl
          percent={zoomPercent}
          onZoomIn={() => cyZoomInRef.current?.()}
          onZoomOut={() => cyZoomOutRef.current?.()}
          onSetPercent={(pct) => cySetPercentRef.current?.(pct)}
          onReset={() => cyZoomResetRef.current?.()}
        />
      )}
      {/* Zoom control — Flows view: wired to SVG zoom adapter (CP23) */}
      {view === 'flow' && (flowDiagrams?.length ?? 0) > 0 && (
        <ZoomControl
          percent={flowZoomPercent}
          onZoomIn={() => {
            const ctrl = flowZoomToRef.current;
            if (ctrl) ctrl(Math.min(4, flowScaleRef.current * 1.1));
          }}
          onZoomOut={() => {
            const ctrl = flowZoomToRef.current;
            if (ctrl) ctrl(Math.max(0.2, flowScaleRef.current / 1.1));
          }}
          onSetPercent={(pct) => {
            const ctrl = flowZoomToRef.current;
            const clamped = Math.max(20, Math.min(400, pct));
            if (ctrl) ctrl(clamped / 100);
          }}
          onReset={() => flowResetFitRef.current?.()}
        />
      )}
      {branding && (
        <div className="branding-block">
          {logoSrc && (
            <img className="branding-logo" src={logoSrc} alt={branding.title} />
          )}
          <div className="branding-text">
            <h1 className="branding-title">{branding.title}</h1>
            <p className="branding-subtitle">{branding.subtitle}</p>
          </div>
        </div>
      )}
      {/* ── Shared chrome: theme toggle, FAB (all views) ── */}
      <button className="theme-toggle" onClick={toggleTheme} title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        {themeMode === 'dark' ? '☀' : '☾'}
      </button>
      <button
        ref={fabRef}
        className={`fab${menuOpen ? ' fab--open' : ''}`}
        onClick={() => setMenuOpen(prev => !prev)}
        title="Actions"
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        {groupEntries.length > 0 ? (
          <span className="fab-dots">
            {groupEntries.slice(0, 4).map(([name, cfg]) => (
              <span key={name} className="fab-dot" style={{ background: cfg.color }} />
            ))}
          </span>
        ) : (
          <span className="fab-icon">⋯</span>
        )}
      </button>
      {menuOpen && (
        <div ref={menuRef} className="fab-menu" role="menu">
          {/* View-switch items — shown for the other two views */}
          {view !== 'graph' && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); setView('graph'); }}
            >
              Data Graph
            </button>
          )}
          {view !== 'dict' && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); setView('dict'); }}
            >
              Dictionary
            </button>
          )}
          {view !== 'flow' && isLiveMode && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); setView('flow'); }}
            >
              Data Flows
            </button>
          )}
          {/* Legend — graph and flow only; Dictionary has no node iconography to explain */}
          {view !== 'dict' && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); setShowLegend(true); }}
            >
              Legend
            </button>
          )}
          {/* Graph-specific action items */}
          {view === 'graph' && (
            <>
              {groupEntries.length > 0 && (
                <button
                  className="fab-menu-item"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); setShowGroups(true); }}
                >
                  Groups
                </button>
              )}
              <button
                className="fab-menu-item"
                role="menuitem"
                onClick={() => { toggleMinimapOpen(); setMenuOpen(false); }}
              >
                {minimapOpen ? 'Hide minimap' : 'Show minimap'}
              </button>
              <button
                className="fab-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  const next = layoutMode === 'organic' ? 'hierarchical' : 'organic';
                  setLayoutMode(next);
                  localStorage.setItem('ignatius-layout-mode', next);
                  applyLayoutModeRef.current?.(next);
                }}
              >
                {layoutMode === 'organic' ? 'Hierarchical layout' : 'Organic layout'}
              </button>
              <button
                className="fab-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); resetLayoutRef.current?.(); }}
              >
                Reset layout
              </button>
            </>
          )}
          {/* Flow-specific action items */}
          {view === 'flow' && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); flowResetLayoutRef.current?.(); }}
            >
              Reset layout
            </button>
          )}
          {/* Dict-specific action items */}
          {view === 'dict' && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); setDictNavOpen(prev => !prev); }}
            >
              Toggle sidebar
            </button>
          )}
          {/* Copy link — graph and dict */}
          {(view === 'graph' || view === 'dict') && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={handleCopyLink}
            >
              Copy link
            </button>
          )}
        </div>
      )}
      {copyConfirm && (
        <div className="fab-copy-toast">Copied!</div>
      )}
      {showGroups && (
        <Modal title="Groups" onClose={() => setShowGroups(false)}>
          {groupEntries.map(([name, cfg]) => (
            <div key={name} className="group-card">
              <div className="group-card-header">
                <span className="legend-swatch" style={{ background: cfg.color }} />
                <strong>{cfg.label}</strong>
              </div>
              {cfg.desc && (
                <div className="doc-body" dangerouslySetInnerHTML={{ __html: cfg.desc }} />
              )}
            </div>
          ))}
        </Modal>
      )}
      {showLegend && <LegendModal onClose={() => setShowLegend(false)} view={view} themeMode={themeMode} kindPalette={resolveFlowKindPalette(themeMode, model?.theme?.flowKinds)} />}
      {selected && showEntityModal && (
        <SelectedEntityModal
          selected={selected}
          model={model}
          entityErrors={
            window.__IGNATIUS_MODE__ === 'static'
              ? findings.entityErrors.filter(e => !RULES[e.ruleId]?.liveOnly)
              : findings.entityErrors
          }
          onClose={() => { setShowEntityModal(false); setEntityModalOpenedFromFlow(false); }}
          onNavigate={(id) => {
            if (entityModalOpenedFromFlow) {
              // Flow context: open the target entity in-place (no graph pan).
              // Preserve the fromFlow flag so chained navigations stay in-place.
              openEntityById(id, true);
            } else {
              const target = model?.nodes.find(n => n.id === id);
              if (target) {
                setSelected(target);
                navigateToEntity(id);
              }
            }
          }}
          processUsages={entityUsageIndex?.get(selected.id)}
          onNavigateToProcess={(processId) => {
            if (entityModalOpenedFromFlow && flowOpenRef.current) {
              // Flow context: open the target process dialog in-place over the flow.
              // Close entity modal first so only one dialog is visible at a time.
              setShowEntityModal(false);
              setEntityModalOpenedFromFlow(false);
              flowOpenRef.current(`proc:${processId}`);
            } else {
              setShowEntityModal(false);
              // Record the target before setView so the dict-view useEffect picks it
              // up after React commits the view switch and the DOM is ready.
              pendingScrollProcessIdRef.current = processId;
              setView('dict');
            }
          }}
          allFlowNodeIds={entityModalOpenedFromFlow && appAllFlowNodeIds ? appAllFlowNodeIds : undefined}
        />
      )}
      {branding && (
        <footer className="branding-footer">
          <span className="branding-copyright">
            &copy; {branding.copyright.year} {branding.copyright.holder}
          </span>
          {branding.poweredBy && (
            <span className="branding-powered">
              powered by{' '}
              <a href="https://noorm.dev" target="_blank" rel="noopener noreferrer">
                Noorm
              </a>
            </span>
          )}
        </footer>
      )}
      <FindingsPanel
        globalErrors={
          view === 'flow'
            ? flowFindings.globalErrors
            : view === 'dict'
              ? [...findings.globalErrors, ...flowFindings.globalErrors]
              : findings.globalErrors
        }
        entityErrors={
          view === 'flow'
            ? []
            : window.__IGNATIUS_MODE__ === 'static'
              ? findings.entityErrors.filter(e => !RULES[e.ruleId]?.liveOnly)
              : findings.entityErrors
        }
        flowErrors={view === 'flow' || view === 'dict' ? flowFindings.flowErrors : undefined}
        collapsed={panelCollapsed}
        onCollapse={() => setPanelCollapsed(true)}
        onExpand={() => setPanelCollapsed(false)}
        onNavigate={(id) => panelNavigateRef.current(id)}
      />
    </div>
  );
}
