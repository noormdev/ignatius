import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Shared modal primitive. Owns the backdrop, stop-propagation, close button,
 * header with title, and ONE ESC keydown listener (added/removed on mount).
 * All four dialog variants render their content as children.
 * `headerExtra` renders inside `.modal-header` after the `<h1>` (for badges etc.).
 */
export function Modal({ title, onClose, children, className, headerExtra }: {
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
