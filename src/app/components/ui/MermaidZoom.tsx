import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { cloneDiagramMarkup } from '../../logic/mermaid-render';
import { Modal } from './Modal';

const MIN_SCALE = 0.1;
const MAX_SCALE = 12;
const BUTTON_STEP = 1.25;

type View = { scale: number; x: number; y: number };

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Keeps the diagram point under (cx, cy) fixed while the scale changes. */
function zoomAround(view: View, nextScale: number, cx: number, cy: number): View {
  const scale = clampScale(nextScale);
  const ratio = scale / view.scale;
  return { scale, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio };
}

/** Opens a clicked Mermaid diagram in a zoomable dialog. Listens on `document` in the capture phase: the markup is
 *  injected HTML, and a `Modal` frame stops a click's propagation. Stacked and portaled for the reasons `JsonValue`'s is. */
export function MermaidZoom() {
  const [markup, setMarkup] = useState<string | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!(e.target instanceof Element)) return;
      const svg = e.target.closest('.mermaid-diagram[data-rendered] > svg');
      if (!(svg instanceof SVGSVGElement)) return;
      setMarkup(cloneDiagramMarkup(svg));
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  if (markup === null) return null;
  return createPortal(
    <Modal title="Diagram" onClose={() => setMarkup(null)} className="mermaid-zoom-modal" stacked>
      <ZoomStage markup={markup} />
    </Modal>,
    document.body,
  );
}

function ZoomStage({ markup }: { markup: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  function diagramSize(): { width: number; height: number } | null {
    const box = contentRef.current?.querySelector('svg')?.viewBox.baseVal;
    return box?.width ? { width: box.width, height: box.height } : null;
  }

  function fit() {
    const viewport = viewportRef.current;
    const size = diagramSize();
    if (!viewport || !size) return;
    const scale = clampScale(Math.min(viewport.clientWidth / size.width, viewport.clientHeight / size.height, 2));
    setView({
      scale,
      x: (viewport.clientWidth - size.width * scale) / 2,
      y: (viewport.clientHeight - size.height * scale) / 2,
    });
  }

  function zoomAtCentre(nextScale: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setView(v => zoomAround(v, nextScale, viewport.clientWidth / 2, viewport.clientHeight / 2));
  }

  // The panel copy carries the inline sizing `fitPanel` gave it; the stage draws it at its natural size instead.
  useEffect(() => {
    const svg = contentRef.current?.querySelector('svg');
    const size = diagramSize();
    if (!svg || !size) return;
    svg.removeAttribute('style');
    svg.setAttribute('width', String(size.width));
    svg.setAttribute('height', String(size.height));
    fit();
  }, [markup]);

  // React registers wheel listeners as passive, and a passive listener cannot stop the page from scrolling.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      setView(v => zoomAround(v, v.scale * factor, e.clientX - rect.left, e.clientY - rect.top));
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  function startPan(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const viewport = e.currentTarget;
    viewport.setPointerCapture(e.pointerId);
    const start = { px: e.clientX, py: e.clientY, x: viewRef.current.x, y: viewRef.current.y };
    const onMove = (ev: PointerEvent) => {
      setView(v => ({ ...v, x: start.x + ev.clientX - start.px, y: start.y + ev.clientY - start.py }));
    };
    const onUp = () => {
      viewport.removeEventListener('pointermove', onMove);
      viewport.removeEventListener('pointerup', onUp);
      viewport.removeEventListener('pointercancel', onUp);
    };
    viewport.addEventListener('pointermove', onMove);
    viewport.addEventListener('pointerup', onUp);
    viewport.addEventListener('pointercancel', onUp);
  }

  return (
    <div className="mermaid-zoom">
      <div className="mermaid-zoom-controls">
        <button type="button" onClick={() => zoomAtCentre(view.scale / BUTTON_STEP)} aria-label="Zoom out">−</button>
        <button type="button" onClick={fit}>Fit</button>
        <button type="button" onClick={() => zoomAtCentre(1)}>1:1</button>
        <button type="button" onClick={() => zoomAtCentre(view.scale * BUTTON_STEP)} aria-label="Zoom in">+</button>
        <span className="mermaid-zoom-level">{Math.round(view.scale * 100)}%</span>
      </div>
      <div className="mermaid-zoom-viewport" ref={viewportRef} onPointerDown={startPan} data-ignatius="mermaid-zoom-viewport">
        <div
          className="mermaid-zoom-content"
          ref={contentRef}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      </div>
    </div>
  );
}
