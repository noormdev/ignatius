import { useEffect, useRef } from 'react';
import type { ViewName } from '../hash-router';
import { resolveShortcut } from '../logic/shortcuts';

interface KeyboardShortcutsConfig {
  view: ViewName;
  onView: (v: ViewName) => void;
  onToggleLayout: () => void;
  onToggleLens: () => void;
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
}: KeyboardShortcutsConfig): void {
  // Latest config ref — updated synchronously on every render so the stable
  // listener closure never reads stale values.
  const configRef = useRef<KeyboardShortcutsConfig>({ view, onView, onToggleLayout, onToggleLens });
  configRef.current = { view, onView, onToggleLayout, onToggleLens };

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

      const { view: currentView, onView: currentOnView, onToggleLayout: currentOnToggleLayout, onToggleLens: currentOnToggleLens } = configRef.current;
      const action = resolveShortcut(e, currentView, editable);
      if (action === null) return;

      e.preventDefault();

      if (action.type === 'view') {
        currentOnView(action.view);
      } else if (action.type === 'toggleLayout') {
        currentOnToggleLayout();
      } else if (action.type === 'toggleLens') {
        currentOnToggleLens();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []); // empty deps: listener registered once; configRef provides live values
}
