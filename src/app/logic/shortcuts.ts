/**
 * shortcuts.ts — pure keyboard-shortcut resolver for the unified SPA.
 *
 * Pure module: no DOM, no React, no Bun/Node imports. Browser-safe and
 * unit-testable with plain event-like objects.
 *
 * Keymap (active when editable=false and no modifier held):
 *   g → view graph   (any view)
 *   d → view dict    (any view)
 *   f → view flow    (any view)
 *   l → toggleLayout (view==='graph' only; null otherwise)
 *   b → toggleLens   (view==='dict'  only; null otherwise)
 *
 * Guards checked before the switch:
 *   1. editable === true → null
 *   2. ctrlKey || metaKey || altKey || shiftKey → null
 *
 * Key matching is done on e.key.toLowerCase() so capslock does not block
 * actions (shift is already guarded, preventing Shift+G etc.).
 *
 * Modifier-gated zoom (Cmd/Ctrl + =/+ / -/_ / 0): resolved BEFORE the bare-key
 * guards, so it works regardless of the editable context and is gated on
 * ctrl/meta (NOT alt/shift). These map to the browser's own zoom chord, which
 * we intercept and route to the active canvas instead of the page. Bare =/-/0
 * with no modifier are NOT hijacked — they fall through to null.
 */

import type { ViewName } from '../hash-router';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal keyboard-event-like shape consumed by resolveShortcut. */
export interface ShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type ShortcutAction =
  | { type: 'view'; view: ViewName }
  | { type: 'toggleLayout' }
  | { type: 'toggleLens' }
  | { type: 'zoomIn' }
  | { type: 'zoomOut' }
  | { type: 'zoomReset' };

// ---------------------------------------------------------------------------
// resolveShortcut
// ---------------------------------------------------------------------------

/**
 * Resolve a keyboard event to a ShortcutAction, or null if no action applies.
 *
 * @param e       - Keyboard event (or minimal event-like object)
 * @param view    - Currently active view
 * @param editable - True when the event target is an editable element (input,
 *                   textarea, select, contenteditable, or inside an open modal)
 */
export function resolveShortcut(
  e: ShortcutKeyEvent,
  view: ViewName,
  editable: boolean,
): ShortcutAction | null {
  const key = e.key.toLowerCase();

  // Modifier-gated zoom: Cmd/Ctrl + =/+ / -/_ / 0. Resolved FIRST so it bypasses
  // the editable guard (these are not typed characters — they are the browser's
  // own page-zoom chord, which we steal for the active canvas). Gated on
  // ctrl/meta ONLY: alt or shift held with these keys → no zoom.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
    switch (key) {
      case '=':
      case '+': return { type: 'zoomIn' };
      case '-':
      case '_': return { type: 'zoomOut' };
      case '0': return { type: 'zoomReset' };
    }
  }

  // Guard 1: typing context (bare keys only)
  if (editable) return null;

  // Guard 2: modifier chords (bare keys only — any modifier suppresses)
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;

  switch (key) {
    case 'g': return { type: 'view', view: 'graph' };
    case 'd': return { type: 'view', view: 'dict' };
    case 'f': return { type: 'view', view: 'flow' };
    case 'l': return view === 'graph' ? { type: 'toggleLayout' } : null;
    case 'b': return view === 'dict'  ? { type: 'toggleLens'   } : null;
    default:  return null;
  }
}
