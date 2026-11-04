import { useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

/**
 * Open modals, outermost first. Every instance listens for ESC, Tab and focusin
 * on `document`, so without this only-the-top-entry check a stacked dialog would
 * dismiss the modal that opened it along with itself, and both would fight over focus.
 *
 * Backdrop clicks need no equivalent guard: React bubbles a stacked dialog's click
 * through its opener's `.modal-frame`, portal or not, and that handler stops propagation.
 */
const modalStack: object[] = [];

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]',
].map(sel => `${sel}:not([tabindex="-1"])`).join(', ');

const MIN_WIDTH = 360;
const WIDTH_KEY_PREFIX = 'ignatius-modal-width:';

function savedWidth(key: string): number | null {
  const width = Number(localStorage.getItem(key));
  return Number.isFinite(width) && width >= MIN_WIDTH ? width : null;
}

/** Skips elements with no layout box, such as those inside a closed `<details>`. */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.getClientRects().length > 0);
}

/**
 * Shared modal primitive. Owns the backdrop, stop-propagation, close button,
 * header with title, ESC to close, a Tab focus trap while on top of the stack,
 * and focus restore to the opener on unmount.
 * All four dialog variants render their content as children.
 * `headerExtra` renders inside `.modal-header` after the `<h1>` (for badges etc.).
 * `stacked` marks a dialog opened from within another one — it lifts the
 * backdrop above the opener's.
 * Either side edge drags to resize; the width persists per `className` in
 * localStorage, and a double-click on an edge restores the default.
 */
export function Modal({ title, onClose, children, className, headerExtra, stacked }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  headerExtra?: ReactNode;
  stacked?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const widthKey = `${WIDTH_KEY_PREFIX}${className ?? 'content'}`;
  const [width, setWidth] = useState(() => savedWidth(widthKey));

  // Read through a ref so the listener effect can stay mount-only. Keying it on
  // `onClose` instead would re-push this modal's stack entry on every render
  // that passes a fresh closure, handing ESC back to an opener that a stacked
  // dialog is currently covering.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement;

    // Pushed before focusing so a modal underneath, no longer on top, ignores
    // the focusin this modal's own close button fires.
    const entry = {};
    modalStack.push(entry);
    closeRef.current?.focus();

    const isTop = () => modalStack[modalStack.length - 1] === entry;

    function onKeyDown(e: KeyboardEvent) {
      if (!isTop()) return;
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      const modal = modalRef.current;
      if (e.key !== 'Tab' || !modal) return;
      const focusable = focusableIn(modal);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const outside = !modal.contains(active);
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    }

    function onFocusIn(e: FocusEvent) {
      const modal = modalRef.current;
      if (!isTop() || !modal || !(e.target instanceof Node) || modal.contains(e.target)) return;
      focusableIn(modal)[0]?.focus();
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      const i = modalStack.indexOf(entry);
      if (i !== -1) modalStack.splice(i, 1);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // The frame is centred, so each edge moves by half the width change: the width grows by twice the drag.
  function startResize(e: ReactPointerEvent<HTMLDivElement>, side: -1 | 1) {
    const frame = e.currentTarget.parentElement;
    if (!frame || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = frame.getBoundingClientRect().width;
    let latest = startWidth;
    const onMove = (ev: PointerEvent) => {
      latest = Math.min(window.innerWidth * 0.96, Math.max(MIN_WIDTH, startWidth + 2 * side * (ev.clientX - startX)));
      setWidth(latest);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (latest !== startWidth) localStorage.setItem(widthKey, String(Math.round(latest)));
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function resetWidth() {
    localStorage.removeItem(widthKey);
    setWidth(null);
  }

  const backdropClass = stacked ? 'modal-backdrop modal-backdrop-stacked' : 'modal-backdrop';
  const frameStyle = width === null ? undefined : { width: `${width}px`, maxWidth: '96vw' };

  return (
    <div className={backdropClass} onClick={onClose}>
      <div className="modal-frame" style={frameStyle} onClick={e => e.stopPropagation()}>
        <div
          className={`modal${className ? ` ${className}` : ''}`}
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <button className="modal-close" onClick={onClose} ref={closeRef}>×</button>
          <div className="modal-header">
            <h1 id={titleId}>{title}</h1>
            {headerExtra}
          </div>
          {children}
        </div>
        <div className="modal-resize modal-resize--left" title="Drag to resize, double-click to reset" onPointerDown={e => startResize(e, -1)} onDoubleClick={resetWidth} />
        <div className="modal-resize modal-resize--right" title="Drag to resize, double-click to reset" onPointerDown={e => startResize(e, 1)} onDoubleClick={resetWidth} />
      </div>
    </div>
  );
}
