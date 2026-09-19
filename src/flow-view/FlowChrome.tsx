/**
 * FlowChrome.tsx — floating UI shell for the flow-viewer surface.
 *
 * Renders all chrome AROUND the SVG diagram:
 *   - breadcrumb chips top-left, offset to clear the fixed .branding-block rendered by App.tsx;
 *     the root chip opens the flow index, and a ▾ on each chip opens a menu of the
 *     diagrams at that chip's level (docs/spec/large-model-nav.md)
 *   - the flow index (FlowIndex) over the canvas
 *   - minimap bottom-left: live SVG overview of the current diagram + viewport rect
 *
 * Theme toggle and FAB are shared app-level chrome (App.tsx) — not rendered here.
 *
 * Driven by the imperative core (initFlowGraphCore) via a forwarded ref exposing:
 *   handle.setStack(stack)             — called on every breadcrumb change
 *   handle.setDiagrams(all)            — called on initial mount + SSE re-renders
 *   handle.setMinimap(data)            — called on pan/zoom/drag to update minimap
 *   handle.toggleIndex()               — keyboard `i`
 *
 * The imperative core's onDrillUp and onSelectPath callbacks are provided
 * back to it via props (the chrome owns the UI; the core owns the SVG).
 *
 * Also writes the --flow-search-bar-top CSS custom property (measured off the
 * breadcrumb row) so App.tsx's flow search bar clears the breadcrumb chips at
 * any drill depth (graph-flow-search CP5, SC12) — see the effect below.
 */

import { useState, useImperativeHandle, forwardRef, useRef, useLayoutEffect, useCallback } from 'react';
import type { FlowDiagram } from '../flows/flow-parse';
import type { MinimapData } from './FlowDiagramSvg';
import { DARK_PALETTE, LIGHT_PALETTE } from './FlowDiagramSvg';
import { defaultDiagramPath, levelEntries, resolveDiagramPath, type FlowLevelEntry } from './flow-nav';
import { SYNTHETIC_DIAGRAM_IDS } from '../flows/flow-derive-levels';
import { FlowIndex } from './FlowIndex';
import { LevelMenu } from './LevelMenu';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BreadcrumbEntry {
  label: string;
  diagramId: string;
}

export interface FlowChromeHandle {
  setStack: (stack: BreadcrumbEntry[]) => void;
  setDiagrams: (all: FlowDiagram[]) => void;
  setMinimap: (data: MinimapData) => void;
  /** Register a function that pans the main SVG to a world coordinate. */
  setMinimapPanTo: (fn: ((worldX: number, worldY: number) => void) | null) => void;
  /** Open the flow index, or close it when open. */
  toggleIndex: () => void;
}

export interface FlowChromeProps {
  /** Called with a diagram's id path (root first) picked from the index or a level menu */
  onSelectPath: (ids: string[]) => void;
  /** Called when the user clicks an ancestor crumb (index in stack) or the back button */
  onDrillUp: (idx: number) => void;
  /** Current theme mode — drives minimap palette + chrome color vars */
  themeMode: 'dark' | 'light';
  /** Model `name:` — titles the flow index. */
  modelName?: string;
  /** Model `description:` — describes the root and whole-system entries. */
  modelDescription?: string;
}

// ── Minimap component ─────────────────────────────────────────────────────

const MINIMAP_W = 176;
const MINIMAP_H = 92;

// Map world-space coordinate to minimap-space coordinate
function worldToMinimap(
  wx: number, wy: number,
  worldBounds: MinimapData['worldBounds'],
): { x: number; y: number } {
  const scaleX = MINIMAP_W / worldBounds.w;
  const scaleY = MINIMAP_H / worldBounds.h;
  return {
    x: (wx - worldBounds.x) * scaleX,
    y: (wy - worldBounds.y) * scaleY,
  };
}

function FlowMinimap({
  data,
  onPan,
  themeMode,
}: {
  data: MinimapData;
  onPan: (worldX: number, worldY: number) => void;
  themeMode: 'dark' | 'light';
}) {
  const { worldBounds, nodeBoxes, viewport } = data;
  const scaleX = MINIMAP_W / worldBounds.w;
  const scaleY = MINIMAP_H / worldBounds.h;

  // Viewport rect in minimap space.
  // The viewport represents the SVG's visible area in world coords.
  // In vb space: the SVG window shows vbW × vbH of vb space.
  // With the inner-<g> transform (translate(tx,ty) scale(scale)):
  //   The visible vb rect is [0,0]→[vbW,vbH] in vb coords.
  //   In world coords: top-left = (vbX - tx) / scale, size = (vbW / scale, vbH / scale)
  // Note: vbX/vbY are embedded in worldBounds (the viewBox origin = worldBounds.x/y).
  const { tx, ty, scale, svgW: _svgW, svgH: _svgH } = viewport;
  // vbW and vbH are represented via worldBounds.w/h (the viewBox matches world bounds at scale=1)
  const vbW = worldBounds.w;
  const vbH = worldBounds.h;

  // World coords of the viewport top-left
  const vpWorldX = worldBounds.x + (-tx / scale);
  const vpWorldY = worldBounds.y + (-ty / scale);
  // World size of the viewport
  const vpWorldW = vbW / scale;
  const vpWorldH = vbH / scale;

  // Minimap coords of the viewport rect
  const vpMinX = (vpWorldX - worldBounds.x) * scaleX;
  const vpMinY = (vpWorldY - worldBounds.y) * scaleY;
  const vpMinW = vpWorldW * scaleX;
  const vpMinH = vpWorldH * scaleY;

  // Clamp the viewport rect to minimap bounds
  const clampedX = Math.max(0, Math.min(MINIMAP_W, vpMinX));
  const clampedY = Math.max(0, Math.min(MINIMAP_H, vpMinY));
  const clampedW = Math.max(10, Math.min(MINIMAP_W - clampedX, vpMinW));
  const clampedH = Math.max(10, Math.min(MINIMAP_H - clampedY, vpMinH));

  // Use the same palette the SVG nodes use — consistent minimap ↔ diagram colors.
  const p = themeMode === 'light' ? LIGHT_PALETTE : DARK_PALETTE;

  // Node fill colors (type → fill/stroke from palette)
  const typeFill: Record<string, string> = {
    process: p.procFill,
    external: p.extFill,
    store: p.storeFill,
  };
  const typeStroke: Record<string, string> = {
    process: p.procBorder,
    external: p.extBorder,
    store: p.storeBorder,
  };

  // Handle click/drag in minimap → pan the main view to center on that world point.
  function handleMinimapPointer(e: React.PointerEvent<SVGSVGElement>) {
    if (e.type === 'pointerdown') {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (e.type !== 'pointerdown' && e.type !== 'pointermove') return;
    if (e.buttons === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    // Convert minimap coords back to world coords
    const worldX = worldBounds.x + (localX / MINIMAP_W) * worldBounds.w;
    const worldY = worldBounds.y + (localY / MINIMAP_H) * worldBounds.h;
    onPan(worldX, worldY);
  }

  return (
    <svg
      width={MINIMAP_W}
      height={MINIMAP_H}
      viewBox={`0 0 ${MINIMAP_W} ${MINIMAP_H}`}
      style={{ display: 'block', borderRadius: '3px', cursor: 'crosshair' }}
      onPointerDown={handleMinimapPointer}
      onPointerMove={handleMinimapPointer}
    >
      {/* Background — uses the canvas color from the active palette */}
      <rect x={0} y={0} width={MINIMAP_W} height={MINIMAP_H} fill={p.canvas} />

      {/* Node boxes */}
      {nodeBoxes.map((box, i) => {
        const { x: mx, y: my } = worldToMinimap(box.x, box.y, worldBounds);
        const mw = Math.max(2, box.w * scaleX);
        const mh = Math.max(2, box.h * scaleY);
        return (
          <rect
            key={i}
            x={mx} y={my} width={mw} height={mh}
            fill={typeFill[box.type] ?? p.border}
            stroke={typeStroke[box.type] ?? p.muted}
            strokeWidth={0.5}
            rx={1}
          />
        );
      })}

      {/* Viewport rect — accent color from palette */}
      <rect
        x={clampedX}
        y={clampedY}
        width={clampedW}
        height={clampedH}
        fill={`${p.accent}14`}
        stroke={p.accent}
        strokeWidth={1.5}
        rx={2}
      />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export const FlowChrome = forwardRef<FlowChromeHandle, FlowChromeProps>(
  function FlowChrome(
    { onSelectPath, onDrillUp, themeMode, modelName, modelDescription },
    ref,
  ) {
    const [stack, setStack] = useState<BreadcrumbEntry[]>([]);
    const [allDiagrams, setAllDiagrams] = useState<FlowDiagram[]>([]);
    const [minimapData, setMinimapData] = useState<MinimapData | null>(null);
    const [indexOpen, setIndexOpen] = useState(false);
    // Index into `stack` of the crumb whose level menu is open.
    const [menuCrumb, setMenuCrumb] = useState<number | null>(null);
    // Minimap pan callback: calls the registered pan handler from the core.
    const minimapPanRef = useRef<((worldX: number, worldY: number) => void) | null>(null);
    // Breadcrumb row ref — measured below so the flow search bar (App.tsx) can
    // clear it (graph-flow-search CP5, SC12).
    const breadcrumbRef = useRef<HTMLDivElement>(null);

    // Search-bar collision avoidance (SC12): the breadcrumb chip row grows
    // WIDER with drill depth (single line, no wrap — see the div's flex rules
    // below) but its HEIGHT never changes, so tracking its measured bottom
    // edge is enough to guarantee the horizontally-centered flow search bar
    // never overlaps it at any depth. Mirrors App.tsx's --search-bar-top
    // banner-offset idiom (ResizeObserver → CSS custom property); scoped
    // locally here — via its own --flow-search-bar-top var, not the banner's
    // — since FlowChrome owns the breadcrumb DOM and the banner is never
    // shown on the flow surface anyway (see styles.css .viewer-search-bar--flow).
    useLayoutEffect(() => {
      const el = breadcrumbRef.current;
      const root = document.documentElement;
      if (!el) {
        root.style.removeProperty('--flow-search-bar-top');
        return;
      }
      const GAP = 12; // matches --search-bar-top's no-banner fallback gap
      function applyOffset() {
        const rect = el!.getBoundingClientRect();
        root.style.setProperty('--flow-search-bar-top', `${rect.bottom + GAP}px`);
      }
      applyOffset();
      const ro = new ResizeObserver(applyOffset);
      ro.observe(el);
      return () => {
        ro.disconnect();
        root.style.removeProperty('--flow-search-bar-top');
      };
    }, []);

    const toggleIndex = useCallback(() => {
      setMenuCrumb(null);
      setIndexOpen(open => !open);
    }, []);

    useImperativeHandle(ref, () => ({
      setStack(s: BreadcrumbEntry[]) {
        setStack(s);
        setMenuCrumb(null);
      },
      setDiagrams(all: FlowDiagram[]) { setAllDiagrams(all); },
      setMinimap(data: MinimapData) { setMinimapData(data); },
      setMinimapPanTo(fn: ((worldX: number, worldY: number) => void) | null) {
        minimapPanRef.current = fn;
      },
      toggleIndex,
    }), [toggleIndex]);

    // Register a pan handler from the SVG component via the core callback.
    // The core passes this into the minimap; we store it on a ref so clicking
    // the minimap fires the most-recently-registered handler.
    function handleMinimapPan(worldX: number, worldY: number) {
      minimapPanRef.current?.(worldX, worldY);
    }

    const closeIndex = useCallback(() => setIndexOpen(false), []);
    const closeMenu = useCallback(() => setMenuCrumb(null), []);

    const stackIds = stack.map(s => s.diagramId);
    const pathDiagrams = resolveDiagramPath(allDiagrams, stackIds) ?? [];

    // The diagrams a crumb can switch between: its parent's sub-DFDs, or the
    // roots for the first crumb.
    function crumbLevel(i: number): FlowLevelEntry[] {
      const parent = i === 0 ? null : pathDiagrams[i - 1];
      if (parent === undefined) return [];
      return levelEntries(parent, allDiagrams, modelDescription);
    }

    function pickSibling(i: number, entry: FlowLevelEntry) {
      setMenuCrumb(null);
      if (entry.diagramId === stackIds[i]) return;
      onSelectPath([...stackIds.slice(0, i), entry.diagramId]);
    }

    function selectFromIndex(ids: string[]) {
      setIndexOpen(false);
      onSelectPath(ids);
    }

    // Context and the System overview are levels leveling derives, not diagrams
    // anyone authored: they get no crumb. The house button stands for the
    // overview the Flows view opens on and reaches it from any depth.
    const isDerived = (crumb: BreadcrumbEntry) => SYNTHETIC_DIAGRAM_IDS.has(crumb.diagramId);
    const current = stack.at(-1);
    const onDerived = current !== undefined && isDerived(current);
    const hasDrillDepth = stack.length > 1 && !onDerived;
    const homeIds = defaultDiagramPath(allDiagrams).map(d => d.id);
    const atHome = homeIds.length > 0 && homeIds.join('/') === stackIds.join('/');

    function renderCrumb(crumb: BreadcrumbEntry, i: number) {
      const isCurrent = i === stack.length - 1;
      const siblings = crumbLevel(i);
      const hasMenu = siblings.length > 1;
      const menuOpen = menuCrumb === i;
      return (
        <div
          className={`flow-crumb${isCurrent ? ' flow-crumb--current' : ''}`}
          data-ignatius="flow-crumb"
        >
          {isCurrent
            ? <span className="flow-crumb__label">{crumb.label}</span>
            : <button type="button" className="flow-crumb__label" onClick={() => onDrillUp(i)}>{crumb.label}</button>}
          {hasMenu && (
            <button
              type="button"
              className="flow-crumb__menu"
              data-ignatius="flow-crumb-menu-button"
              aria-label={`Other diagrams at the level of ${crumb.label}`}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => { setIndexOpen(false); setMenuCrumb(menuOpen ? null : i); }}
            >
              ▾
            </button>
          )}
          {menuOpen && (
            <LevelMenu
              heading={i === 0 ? 'Top level' : isDerived(stack[i - 1]!) ? 'Process flows' : `In ${stack[i - 1]!.label}`}
              entries={siblings}
              currentId={crumb.diagramId}
              onPick={entry => pickSibling(i, entry)}
              onClose={closeMenu}
            />
          )}
        </div>
      );
    }

    return (
      <>
        {/* ── Breadcrumb chips — top-left ── */}
        <div
          ref={breadcrumbRef}
          data-ignatius="flow-breadcrumbs"
          className="flow-crumbs"
        >
          <span className="flow-crumbs__sep">/</span>
          <button
            type="button"
            className={`flow-crumb flow-crumb--index${indexOpen ? ' flow-crumb--open' : ''}`}
            data-ignatius="flow-index-button"
            aria-expanded={indexOpen}
            aria-keyshortcuts="i"
            title="Flow index (i)"
            onClick={toggleIndex}
          >
            <span aria-hidden="true" className="flow-crumb__icon">☰</span>
            Process Flows
          </button>

          {homeIds.length > 0 && (
            <div className="flow-crumbs__step">
              <span className="flow-crumbs__sep">/</span>
              <button
                type="button"
                className={`flow-crumb flow-crumb--home${atHome ? ' flow-crumb--current' : ''}`}
                data-ignatius="flow-home-button"
                aria-label="Flow overview"
                aria-current={atHome ? 'page' : undefined}
                title="Flow overview"
                onClick={() => { if (!atHome) onSelectPath(homeIds); }}
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                  <path d="M2 7.5 8 2.5l6 5" />
                  <path d="M3.75 6.5V13.5h3.25V9.75h2V13.5h3.25V6.5" />
                </svg>
              </button>
            </div>
          )}

          {stack.map((crumb, i) => isDerived(crumb) ? null : (
            <div key={`${i}:${crumb.diagramId}`} className="flow-crumbs__step">
              <span className="flow-crumbs__sep">/</span>
              {renderCrumb(crumb, i)}
            </div>
          ))}

          {hasDrillDepth && (
            <button
              type="button"
              className="flow-crumbs__back"
              onClick={() => onDrillUp(stack.length - 2)}
            >
              ← Back
            </button>
          )}
        </div>

        {indexOpen && allDiagrams.length > 0 && (
          <FlowIndex
            diagrams={allDiagrams}
            activePath={stackIds}
            modelName={modelName}
            modelDescription={modelDescription}
            onSelectPath={selectFromIndex}
            onClose={closeIndex}
          />
        )}

        {/* ── Minimap — bottom-left ── */}
        <div className="flow-minimap-wrapper">
          <div className="flow-minimap-canvas">
            {minimapData ? (
              <FlowMinimap data={minimapData} onPan={handleMinimapPan} themeMode={themeMode} />
            ) : (
              /* Placeholder before first render */
              <div style={{
                width: '100%', height: '100%',
                background: 'var(--color-surface, #161b22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  position: 'absolute',
                  left: '4%', top: '4%',
                  width: '90%', height: '90%',
                  border: '1.5px solid var(--color-link, #58a6ff)',
                  background: 'color-mix(in srgb, var(--color-link) 6%, transparent)',
                  borderRadius: '2px',
                  pointerEvents: 'none',
                }} />
              </div>
            )}
          </div>
        </div>

      </>
    );
  },
);
