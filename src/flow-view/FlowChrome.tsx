/**
 * FlowChrome.tsx — floating UI shell for the flow-viewer surface.
 *
 * Renders all chrome AROUND the SVG diagram:
 *   - breadcrumb chips top-left, offset to clear the fixed .branding-block rendered by App.tsx
 *   - DFD nav card (floating left panel, shown when >1 top-level DFD)
 *   - findings aside top-right (green check when 0 findings)
 *   - theme-toggle circle top-right
 *   - FAB bottom-right with cross-nav links + legend + reset-layout inside the menu
 *   - minimap bottom-left: live SVG overview of the current diagram + viewport rect
 *
 * Driven by the imperative core (initFlowGraphCore) via a forwarded ref exposing:
 *   handle.setStack(stack)             — called on every breadcrumb change
 *   handle.setDiagrams(all, activeId)  — called on initial mount + SSE re-renders
 *   handle.setMinimap(data)            — called on pan/zoom/drag to update minimap
 *   handle.setResetLayout(fn)          — called once to register the reset callback
 *
 * The imperative core's onDrillUp and onSelectDiagram callbacks are provided
 * back to it via props (the chrome owns the UI; the core owns the SVG).
 */

import { useState, useImperativeHandle, forwardRef, useRef, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { FlowDiagram } from '../flow-parse';
import type { ThemeMode } from '../theme-defaults';
import type { GlobalError, EntityError } from '../validate';
import type { MinimapData } from './FlowDiagramSvg';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BreadcrumbEntry {
  label: string;
}

export interface FlowChromeHandle {
  setStack: (stack: BreadcrumbEntry[]) => void;
  setDiagrams: (all: FlowDiagram[], activeId: string) => void;
  setMinimap: (data: MinimapData) => void;
  setResetLayout: (fn: (() => void) | null) => void;
  /** Register a function that pans the main SVG to a world coordinate. */
  setMinimapPanTo: (fn: ((worldX: number, worldY: number) => void) | null) => void;
}

export interface FlowChromeProps {
  /** Current theme — read from localStorage / window globals on mount */
  themeMode: ThemeMode;
  /** Toggle theme callback (parent state owner) */
  onToggleTheme: () => void;
  /** Flow findings (global + per-process errors) */
  globalErrors: GlobalError[];
  entityErrors: EntityError[];
  /** Called when the user picks a different top-level DFD from the nav card */
  onSelectDiagram: (id: string) => void;
  /** Called when the user clicks an ancestor crumb (index in stack) or the back button */
  onDrillUp: (idx: number) => void;
  /** Live mode: whether to show the ERD / Data Dict cross-nav links */
  isLive: boolean;
  /** Process dict href (live: '/flow-dict', static: from __FLOW_DICT_HREF__) */
  flowDictHref: string | null;
}

// ── Color constants matching mock-e's CSS vars ────────────────────────────

const PROC_FILL = '#0d419d';
const PROC_BORDER = '#58a6ff';
const EXT_FILL = '#1a3a1a';
const EXT_BORDER = '#3fb950';
const STORE_FILL = '#3d2e00';
const STORE_BORDER = '#d29922';

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
}: {
  data: MinimapData;
  onPan: (worldX: number, worldY: number) => void;
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

  // Node fill colors (type → fill)
  const typeFill: Record<string, string> = {
    process: '#0d419d',
    external: '#1a3a1a',
    store: '#3d2e00',
  };
  const typeStroke: Record<string, string> = {
    process: '#58a6ff',
    external: '#3fb950',
    store: '#d29922',
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
      {/* Background */}
      <rect x={0} y={0} width={MINIMAP_W} height={MINIMAP_H} fill="#0e1116" />

      {/* Node boxes */}
      {nodeBoxes.map((box, i) => {
        const { x: mx, y: my } = worldToMinimap(box.x, box.y, worldBounds);
        const mw = Math.max(2, box.w * scaleX);
        const mh = Math.max(2, box.h * scaleY);
        return (
          <rect
            key={i}
            x={mx} y={my} width={mw} height={mh}
            fill={typeFill[box.type] ?? '#333'}
            stroke={typeStroke[box.type] ?? '#666'}
            strokeWidth={0.5}
            rx={1}
          />
        );
      })}

      {/* Viewport rect */}
      <rect
        x={clampedX}
        y={clampedY}
        width={clampedW}
        height={clampedH}
        fill="rgba(88,166,255,0.08)"
        stroke="#58a6ff"
        strokeWidth={1.5}
        rx={2}
      />
    </svg>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function FindingsAside({ globalErrors, entityErrors }: { globalErrors: GlobalError[]; entityErrors: EntityError[] }) {
  const total = globalErrors.length + entityErrors.length;
  return (
    <aside style={{
      position: 'absolute',
      top: '58px',
      right: '62px',
      width: '220px',
      background: 'var(--color-surface, #161b22)',
      border: '1px solid var(--color-border, #30363d)',
      borderRadius: '10px',
      padding: '12px 14px',
      zIndex: 28,
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600 }}>
        <span style={{
          width: '18px', height: '18px', borderRadius: '50%',
          background: total > 0 ? 'rgba(210,153,34,0.16)' : 'rgba(63,185,80,0.16)',
          color: total > 0 ? '#d29922' : '#3fb950',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '12px', flexShrink: 0,
        }}>
          {total > 0 ? '!' : '✓'}
        </span>
        {total} finding{total !== 1 ? 's' : ''}
      </div>
      {total === 0 && (
        <div style={{ marginTop: '6px', fontSize: '11.5px', color: 'var(--color-text-muted, #8b949e)', lineHeight: 1.5 }}>
          No issues found
        </div>
      )}
      {total > 0 && (
        <ul style={{ marginTop: '8px', listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {globalErrors.map((e, i) => (
            <li key={`g${i}`} style={{ fontSize: '11.5px', color: 'var(--color-text-muted, #8b949e)' }}>
              <span style={{ color: '#d29922', marginRight: '4px' }}>⚠</span>
              {e.reason}
            </li>
          ))}
          {entityErrors.map((e, i) => (
            <li key={`e${i}`} style={{ fontSize: '11.5px', color: 'var(--color-text-muted, #8b949e)' }}>
              <span style={{ color: '#d29922', marginRight: '4px' }}>⚠</span>
              {e.entityId}: {e.message}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

interface LegendItemProps {
  fill: string;
  border: string;
  label: string;
  openRight?: boolean;
}

function LegendItem({ fill, border, label, openRight }: LegendItemProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 12px', fontSize: '12px', color: 'var(--color-text, #e6edf3)' }}>
      <span style={{
        width: '22px', height: '14px', borderRadius: '3px', flexShrink: 0,
        background: fill,
        border: `1px solid ${border}`,
        borderRight: openRight ? 'none' : `1px solid ${border}`,
      }} />
      {label}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export const FlowChrome = forwardRef<FlowChromeHandle, FlowChromeProps>(
  function FlowChrome(
    { themeMode, onToggleTheme, globalErrors, entityErrors,
      onSelectDiagram, onDrillUp, isLive, flowDictHref },
    ref,
  ) {
    const [stack, setStack] = useState<BreadcrumbEntry[]>([]);
    const [allDiagrams, setAllDiagrams] = useState<FlowDiagram[]>([]);
    const [activeDiagramId, setActiveDiagramId] = useState<string>('');
    const [menuOpen, setMenuOpen] = useState(false);
    const [minimapData, setMinimapData] = useState<MinimapData | null>(null);
    // Tracked in state (not a ref) so setting it triggers a re-render and the
    // "Reset layout" button reliably appears even when no other re-render fires.
    const [resetLayout, setResetLayout] = useState<(() => void) | null>(null);
    // Minimap pan callback: calls the registered pan handler from the core.
    const minimapPanRef = useRef<((worldX: number, worldY: number) => void) | null>(null);

    // Stable wrapper so useImperativeHandle doesn't recreate the handle on every render.
    const handleSetResetLayout = useCallback((fn: (() => void) | null) => {
      // useState setter: wrap fn in another function so React doesn't treat it
      // as a functional update (fn would be invoked immediately otherwise).
      setResetLayout(fn ? () => fn : null);
    }, []);

    useImperativeHandle(ref, () => ({
      setStack(s: BreadcrumbEntry[]) { setStack(s); },
      setDiagrams(all: FlowDiagram[], activeId: string) {
        setAllDiagrams(all);
        setActiveDiagramId(activeId);
      },
      setMinimap(data: MinimapData) { setMinimapData(data); },
      setResetLayout: handleSetResetLayout,
      setMinimapPanTo(fn: ((worldX: number, worldY: number) => void) | null) {
        minimapPanRef.current = fn;
      },
    }), [handleSetResetLayout]);

    // Register a pan handler from the SVG component via the core callback.
    // The core passes this into the minimap; we store it on a ref so clicking
    // the minimap fires the most-recently-registered handler.
    function handleMinimapPan(worldX: number, worldY: number) {
      minimapPanRef.current?.(worldX, worldY);
    }

    const hasDrillDepth = stack.length > 1;
    const showNav = allDiagrams.length > 1;
    const topName = stack[0]?.label ?? activeDiagramId;

    return (
      <>
        {/* ── Breadcrumb chips — top-left ── */}
        <div style={{
          position: 'absolute',
          top: '18px',
          left: '240px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          zIndex: 30,
        }}>
          <span style={{ color: 'var(--color-text-muted, #8b949e)', fontSize: '13px' }}>/</span>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--color-surface, #161b22)',
            border: '1px solid var(--color-border, #30363d)',
            borderRadius: '8px',
            padding: '7px 12px',
            fontSize: '13px',
            color: 'var(--color-text, #e6edf3)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
          }}>
            Process Flows
          </div>

          {(topName || stack.length > 0) && (
            <>
              <span style={{ color: 'var(--color-text-muted, #8b949e)', fontSize: '13px' }}>/</span>
              {stack.slice(0, -1).map((crumb, i) => (
                <div key={crumb.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => onDrillUp(i)}
                    style={{
                      background: 'var(--color-surface, #161b22)',
                      border: '1px solid var(--color-border, #30363d)',
                      borderRadius: '8px',
                      padding: '7px 12px',
                      fontSize: '13px',
                      color: 'var(--color-text-muted, #8b949e)',
                      cursor: 'pointer',
                      boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
                      fontFamily: 'inherit',
                    }}
                  >
                    {crumb.label}
                  </button>
                  <span style={{ color: 'var(--color-text-muted, #8b949e)', fontSize: '13px' }}>/</span>
                </div>
              ))}
              {stack.length > 0 && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'var(--color-surface, #161b22)',
                  border: '1px solid rgba(88,166,255,0.4)',
                  borderRadius: '8px',
                  padding: '7px 12px',
                  fontSize: '13px',
                  color: '#cfe2ff',
                  boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
                }}>
                  {stack[stack.length - 1]!.label}
                </div>
              )}
            </>
          )}

          {hasDrillDepth && (
            <button
              onClick={() => onDrillUp(stack.length - 2)}
              style={{
                background: 'none',
                border: '1px solid var(--color-border, #30363d)',
                borderRadius: '6px',
                color: 'var(--color-text-muted, #8b949e)',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '4px 8px',
                fontFamily: 'inherit',
              }}
            >
              ← Back
            </button>
          )}
        </div>

        {/* ── DFD nav card — floating top-left below branding ── */}
        {showNav && (
          <div style={{
            position: 'absolute',
            top: '72px',
            left: '20px',
            width: '196px',
            background: 'rgba(22,27,34,0.82)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            border: '1px solid var(--color-border, #30363d)',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
            padding: '14px 12px',
            zIndex: 25,
          }}>
            <h2 style={{
              fontSize: '11px',
              letterSpacing: '1.2px',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted, #8b949e)',
              marginBottom: '14px',
              fontWeight: 700,
            }}>
              Process Flows
            </h2>
            {allDiagrams.map(d => {
              const isActive = d.id === activeDiagramId || (stack[0]?.label === d.id);
              return (
                <button
                  key={d.id}
                  onClick={() => { onSelectDiagram(d.id); setActiveDiagramId(d.id); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    color: isActive ? 'var(--color-link, #58a6ff)' : 'var(--color-text, #e6edf3)',
                    marginBottom: '4px',
                    cursor: 'pointer',
                    background: isActive ? 'rgba(88,166,255,0.12)' : 'none',
                    border: 'none',
                    fontWeight: isActive ? 600 : 400,
                    textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{
                    width: '7px', height: '7px', borderRadius: '50%',
                    background: isActive ? 'var(--color-link, #58a6ff)' : 'var(--color-text-muted, #8b949e)',
                    flexShrink: 0,
                  }} />
                  {d.id}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Findings aside + theme toggle — top-right cluster ── */}
        <FindingsAside globalErrors={globalErrors} entityErrors={entityErrors} />
        <button
          onClick={onToggleTheme}
          title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            position: 'absolute',
            top: '58px',
            right: '292px',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'var(--color-surface, #161b22)',
            border: '1px solid var(--color-border, #30363d)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '15px',
            color: 'var(--color-text-muted, #8b949e)',
            zIndex: 28,
            cursor: 'pointer',
          }}
        >
          {themeMode === 'dark' ? '☀' : '☾'}
        </button>

        {/* ── Minimap — bottom-left ── */}
        <div style={{
          position: 'absolute',
          left: showNav ? '228px' : '20px',
          bottom: '22px',
          width: `${MINIMAP_W + 12}px`,
          background: 'var(--color-surface, #161b22)',
          border: '1px solid var(--color-border, #30363d)',
          borderRadius: '8px',
          padding: '6px',
          zIndex: 27,
          boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{
            fontSize: '10px',
            color: 'var(--color-text-muted, #8b949e)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            marginBottom: '4px',
          }}>
            Minimap
          </div>
          <div style={{
            position: 'relative',
            width: `${MINIMAP_W}px`,
            height: `${MINIMAP_H}px`,
            border: '1px solid var(--color-border, #30363d)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            {minimapData ? (
              <FlowMinimap data={minimapData} onPan={handleMinimapPan} />
            ) : (
              /* Placeholder before first render */
              <div style={{
                width: '100%', height: '100%',
                background: 'var(--color-background, #0e1116)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  position: 'absolute',
                  left: '4%', top: '4%',
                  width: '90%', height: '90%',
                  border: '1.5px solid var(--color-link, #58a6ff)',
                  background: 'rgba(88,166,255,0.06)',
                  borderRadius: '2px',
                  pointerEvents: 'none',
                }} />
              </div>
            )}
          </div>
        </div>

        {/* ── FAB wrap — bottom-right ── */}
        <div style={{
          position: 'absolute',
          right: '26px',
          bottom: '26px',
          zIndex: 29,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '10px',
        }}>
          {menuOpen && (
            <div style={{
              background: 'var(--color-surface, #161b22)',
              border: '1px solid var(--color-border, #30363d)',
              borderRadius: '10px',
              padding: '6px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              minWidth: '158px',
            }}>
              {/* Cross-nav links */}
              {isLive && (
                <>
                  <a href="/" style={fabItemStyle}>
                    <span style={fabIconStyle}>◇</span> Data Graph
                  </a>
                  <a href="/dict" style={fabItemStyle}>
                    <span style={fabIconStyle}>≣</span> Data Dict
                  </a>
                </>
              )}
              {flowDictHref && (
                <a href={flowDictHref} style={fabItemStyle}>
                  <span style={fabIconStyle}>⇄</span> Process Dict
                </a>
              )}
              {/* Reset layout */}
              {resetLayout && (
                <button
                  onClick={() => {
                    resetLayout();
                    setMenuOpen(false);
                  }}
                  style={{ ...fabItemStyle, width: '100%', border: 'none', cursor: 'pointer' }}
                >
                  <span style={fabIconStyle}>↺</span> Reset layout
                </button>
              )}
              {/* Legend section */}
              <div style={{ borderTop: '1px solid var(--color-border, #30363d)', margin: '6px 0 4px', paddingTop: '6px' }}>
                <div style={{
                  fontSize: '10px',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-muted, #8b949e)',
                  padding: '0 12px 4px',
                }}>
                  Legend
                </div>
                <LegendItem fill={PROC_FILL} border={PROC_BORDER} label="process" />
                <LegendItem fill={EXT_FILL} border={EXT_BORDER} label="external" />
                <LegendItem fill={STORE_FILL} border={STORE_BORDER} label="data store" openRight />
              </div>
            </div>
          )}
          <button
            onClick={() => setMenuOpen(prev => !prev)}
            title="Actions"
            aria-expanded={menuOpen}
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              background: PROC_FILL,
              border: `1px solid ${PROC_BORDER}`,
              color: '#fff',
              fontSize: '26px',
              fontWeight: 300,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(13,65,157,0.55)',
              cursor: 'pointer',
              alignSelf: 'flex-end',
            }}
          >
            {menuOpen ? '×' : '+'}
          </button>
        </div>
      </>
    );
  },
);

// ── Shared inline styles ──────────────────────────────────────────────────

const fabItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '9px',
  padding: '8px 10px',
  borderRadius: '6px',
  fontSize: '12.5px',
  color: 'var(--color-text, #e6edf3)',
  cursor: 'pointer',
  textDecoration: 'none',
  fontFamily: 'inherit',
  background: 'none',
};

const fabIconStyle: CSSProperties = {
  width: '14px',
  textAlign: 'center',
  color: 'var(--color-text-muted, #8b949e)',
  flexShrink: 0,
};
