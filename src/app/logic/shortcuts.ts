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
  | { type: 'toggleLens' };

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
  // Guard 1: typing context
  if (editable) return null;

  // Guard 2: modifier chords
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;

  const key = e.key.toLowerCase();

  switch (key) {
    case 'g': return { type: 'view', view: 'graph' };
    case 'd': return { type: 'view', view: 'dict' };
    case 'f': return { type: 'view', view: 'flow' };
    case 'l': return view === 'graph' ? { type: 'toggleLayout' } : null;
    case 'b': return view === 'dict'  ? { type: 'toggleLens'   } : null;
    default:  return null;
  }
}
