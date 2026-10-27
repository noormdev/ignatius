import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Open modals, outermost first. Every instance listens for ESC, Tab and focusin
 * on `document`, so without this only-the-top-entry check a stacked dialog would
 * dismiss the modal that opened it along with itself, and both would fight over focus.
 *
 * Backdrop clicks need no equivalent guard: React bubbles a stacked dialog's click
 * through its opener's `.modal`, portal or not, and that handler stops propagation.
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

  const backdropClass = stacked ? 'modal-backdrop modal-backdrop-stacked' : 'modal-backdrop';

  return (
    <div className={backdropClass} onClick={onClose}>
      <div
        className={`modal${className ? ` ${className}` : ''}`}
        onClick={e => e.stopPropagation()}
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
    </div>
  );
}
