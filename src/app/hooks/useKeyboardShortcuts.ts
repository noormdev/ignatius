import { useEffect, useRef } from 'react';
import type { ViewName } from '../hash-router';
import { resolveShortcut } from '../logic/shortcuts';

interface KeyboardShortcutsConfig {
  view: ViewName;
  onView: (v: ViewName) => void;
  onToggleLayout: () => void;
  onToggleLens: () => void;
  /** Cmd/Ctrl + =/+ — zoom the active canvas in (no-op on dict). */
  onZoomIn: () => void;
  /** Cmd/Ctrl + -/_ — zoom the active canvas out (no-op on dict). */
  onZoomOut: () => void;
  /** Cmd/Ctrl + 0 — reset/fit the active canvas (no-op on dict). */
  onZoomReset: () => void;
  /** `?` — open the view-aware help overlay. */
  onHelp: () => void;
}

/**
 * useKeyboardShortcuts — registers exactly ONE global keydown listener for the
 * unified SPA keyboard shortcuts (g/d/f/l/b).
 *
 * Stale-closure hazard: the listener is registered once on mount. To avoid
 * capturing a stale `view`/callbacks reference, we keep the latest config in
 * a ref updated every render; the single listener reads from that ref.
 *
 * Editable guard: returns true when the event target is an input, textarea,
 * select, contenteditable element, or any element inside a `.modal` root.
 */
export function useKeyboardShortcuts({
  view,
  onView,
  onToggleLayout,
  onToggleLens,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onHelp,
}: KeyboardShortcutsConfig): void {
  // Latest config ref — updated synchronously on every render so the stable
  // listener closure never reads stale values.
  const configRef = useRef<KeyboardShortcutsConfig>({ view, onView, onToggleLayout, onToggleLens, onZoomIn, onZoomOut, onZoomReset, onHelp });
  configRef.current = { view, onView, onToggleLayout, onToggleLens, onZoomIn, onZoomOut, onZoomReset, onHelp };

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const target = e.target;

      // Editable guard: skip when focus is in an input-like element or inside a modal.
      let editable = false;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          editable = true;
        } else if (target.isContentEditable) {
          editable = true;
        } else if (target.closest('.modal') !== null) {
          editable = true;
        }
      }

      const cfg = configRef.current;
      const action = resolveShortcut(e, cfg.view, editable);
      if (action === null) return;

      // preventDefault for every matched action — critically, this is what
      // stops the browser from page-zooming on Cmd/Ctrl +/-/0 (the zoom
      // actions) before we route the zoom to the active canvas instead.
      e.preventDefault();

      switch (action.type) {
        case 'view': cfg.onView(action.view); break;
        case 'toggleLayout': cfg.onToggleLayout(); break;
        case 'toggleLens': cfg.onToggleLens(); break;
        case 'zoomIn': cfg.onZoomIn(); break;
        case 'zoomOut': cfg.onZoomOut(); break;
        case 'zoomReset': cfg.onZoomReset(); break;
        case 'help': cfg.onHelp(); break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []); // empty deps: listener registered once; configRef provides live values
}
