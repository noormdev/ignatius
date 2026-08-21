import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Open modals, outermost first. Every instance listens for ESC on `document`,
 * so without this only-the-top-entry check a stacked dialog would dismiss the
 * modal that opened it along with itself.
 *
 * Backdrop clicks need no equivalent guard: a stacked backdrop renders inside
 * its opener's `.modal`, whose own handler already stops propagation.
 */
const modalStack: object[] = [];

/**
 * Shared modal primitive. Owns the backdrop, stop-propagation, close button,
 * header with title, and ONE ESC keydown listener (added/removed on mount).
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

  // Read through a ref so the listener effect can stay mount-only. Keying it on
  // `onClose` instead would re-push this modal's stack entry on every render
  // that passes a fresh closure, handing ESC back to an opener that a stacked
  // dialog is currently covering.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // Focus the close button so keyboard users can dismiss immediately.
    closeRef.current?.focus();

    const entry = {};
    modalStack.push(entry);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (modalStack[modalStack.length - 1] !== entry) return;
      onCloseRef.current();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const i = modalStack.indexOf(entry);
      if (i !== -1) modalStack.splice(i, 1);
    };
  }, []);

  const backdropClass = stacked ? 'modal-backdrop modal-backdrop-stacked' : 'modal-backdrop';

  return (
    <div className={backdropClass} onClick={onClose}>
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
