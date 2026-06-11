/**
 * FlowChrome.tsx — floating UI shell for the flow-viewer surface.
 *
 * Renders all chrome AROUND the SVG diagram:
 *   - breadcrumb chips top-left, offset to clear the fixed .branding-block rendered by App.tsx
 *   - DFD nav card (floating left panel, shown when >1 top-level DFD)
 *   - findings aside top-right (green check when 0 findings)
 *   - minimap bottom-left: live SVG overview of the current diagram + viewport rect
 *
 * Theme toggle and FAB are shared app-level chrome (App.tsx) — not rendered here.
 *
 * Driven by the imperative core (initFlowGraphCore) via a forwarded ref exposing:
 *   handle.setStack(stack)             — called on every breadcrumb change
 *   handle.setDiagrams(all, activeId)  — called on initial mount + SSE re-renders
 *   handle.setMinimap(data)            — called on pan/zoom/drag to update minimap
 *
 * The imperative core's onDrillUp and onSelectDiagram callbacks are provided
 * back to it via props (the chrome owns the UI; the core owns the SVG).
 */

import { useState, useImperativeHandle, forwardRef, useRef } from 'react';
import type { FlowDiagram } from '../flows/flow-parse';
import type { MinimapData } from './FlowDiagramSvg';
import { DARK_PALETTE, LIGHT_PALETTE } from './FlowDiagramSvg';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BreadcrumbEntry {
  label: string;
}

export interface FlowChromeHandle {
  setStack: (stack: BreadcrumbEntry[]) => void;
  setDiagrams: (all: FlowDiagram[], activeId: string) => void;
  setMinimap: (data: MinimapData) => void;
  /** Register a function that pans the main SVG to a world coordinate. */
  setMinimapPanTo: (fn: ((worldX: number, worldY: number) => void) | null) => void;
}

export interface FlowChromeProps {
  /** Called when the user picks a different top-level DFD from the nav card */
  onSelectDiagram: (id: string) => void;
  /** Called when the user clicks an ancestor crumb (index in stack) or the back button */
  onDrillUp: (idx: number) => void;
  /** Current theme mode — drives minimap palette + chrome color vars */
  themeMode: 'dark' | 'light';
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
    { onSelectDiagram, onDrillUp, themeMode },
    ref,
  ) {
    const [stack, setStack] = useState<BreadcrumbEntry[]>([]);
    const [allDiagrams, setAllDiagrams] = useState<FlowDiagram[]>([]);
    const [activeDiagramId, setActiveDiagramId] = useState<string>('');
    const [minimapData, setMinimapData] = useState<MinimapData | null>(null);
    // Minimap pan callback: calls the registered pan handler from the core.
    const minimapPanRef = useRef<((worldX: number, worldY: number) => void) | null>(null);

    useImperativeHandle(ref, () => ({
      setStack(s: BreadcrumbEntry[]) { setStack(s); },
      setDiagrams(all: FlowDiagram[], activeId: string) {
        setAllDiagrams(all);
        setActiveDiagramId(activeId);
      },
      setMinimap(data: MinimapData) { setMinimapData(data); },
      setMinimapPanTo(fn: ((worldX: number, worldY: number) => void) | null) {
        minimapPanRef.current = fn;
      },
    }), []);

    // Register a pan handler from the SVG component via the core callback.
    // The core passes this into the minimap; we store it on a ref so clicking
    // the minimap fires the most-recently-registered handler.
    function handleMinimapPan(worldX: number, worldY: number) {
      minimapPanRef.current?.(worldX, worldY);
    }

    const hasDrillDepth = stack.length > 1;
    const showNav = allDiagrams.length > 1;
    const topName = stack[0]?.label
      ?? allDiagrams.find(d => d.id === activeDiagramId)?.title
      ?? activeDiagramId;

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
                  border: '1px solid var(--color-link, #58a6ff)',
                  borderRadius: '8px',
                  padding: '7px 12px',
                  fontSize: '13px',
                  color: 'var(--color-link, #58a6ff)',
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
            background: 'var(--color-surface-alt, var(--color-surface, #161b22))',
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
              const isActive = d.id === activeDiagramId;
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
                    background: isActive ? 'color-mix(in srgb, var(--color-link) 12%, transparent)' : 'none',
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
                  {d.title}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Minimap — bottom-left ── */}
        <div className="flow-minimap-wrapper" style={{
          left: showNav ? '228px' : '16px',
        }}>
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
