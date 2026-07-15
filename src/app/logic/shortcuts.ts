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
 *   / → search       (any view; ordinary bare key — unlike '?' it needs no
 *                      Shift, so it resolves in the normal switch below.
 *                      Cmd/Ctrl+k is a second, always-on route to the same
 *                      action — see "Modifier-gated zoom + search" below.)
 *   ? → help         (any view; needs Shift, so resolved before guard 2)
 *   arrows → pan     (graph/flow only; Shift multiplies the step, so resolved
 *                      before guard 2 like '?' — see "Arrow-key panning" below)
 *
 * Guards checked before the switch:
 *   1. editable === true → null
 *   2. ctrlKey || metaKey || altKey || shiftKey → null
 *
 * Exception: '?' (Shift+/) is resolved after guard 1 but before guard 2, since
 * the character itself requires Shift; it is still suppressed in editable context.
 *
 * Arrow-key panning (graph/flow views): each keydown pans the active canvas by
 * PAN_STEP screen px, or PAN_STEP_FAST with Shift held — keydown auto-repeat
 * makes holding a key scroll continuously. Resolved after guard 1 (arrows must
 * keep moving the text cursor in editable context) but before guard 2 (Shift is
 * the step multiplier here, not a suppressor); ctrl/meta/alt chords fall through
 * to null (Cmd/Alt+arrow is OS text/history navigation). The action's (dx, dy)
 * is the direction the VIEWPORT moves — consumers slide the content the
 * opposite way. Dict view → null, preserving native page scroll.
 *
 * Key matching is done on e.key.toLowerCase() so capslock does not block
 * actions (shift is already guarded, preventing Shift+G etc.).
 *
 * Modifier-gated zoom + search (Cmd/Ctrl + =/+ / -/_ / 0 / k): resolved
 * BEFORE the bare-key guards, so these work regardless of the editable
 * context and are gated on ctrl/meta (NOT alt/shift). The zoom keys map to
 * the browser's own zoom chord, which we intercept and route to the active
 * canvas instead of the page; Cmd/Ctrl+k maps to the conventional "focus
 * search" chord and resolves to the same { type: 'search' } action as '/' —
 * unlike '/', it fires even while typing elsewhere (not suppressed by the
 * editable guard). Bare =/-/0/k with no modifier are NOT hijacked — they
 * fall through to null (bare 'k' is simply unmapped, so it types normally).
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
  | { type: 'zoomReset' }
  | { type: 'help' }
  | { type: 'search' }
  | { type: 'pan'; dx: number; dy: number };

/** Arrow-key pan step per keydown, in screen px (viewport-movement delta). */
export const PAN_STEP = 10;
/** Arrow-key pan step per keydown with Shift held, in screen px. */
export const PAN_STEP_FAST = 50;

/** Viewport-movement delta per arrow key, at unit step. */
const PAN_DIRECTION: Record<string, { dx: number; dy: number }> = {
  arrowleft: { dx: -1, dy: 0 },
  arrowright: { dx: 1, dy: 0 },
  arrowup: { dx: 0, dy: -1 },
  arrowdown: { dx: 0, dy: 1 },
};

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

  // Modifier-gated zoom + search: Cmd/Ctrl + =/+ / -/_ / 0 / k. Resolved FIRST
  // so these bypass the editable guard (not typed characters — the zoom keys
  // are the browser's own page-zoom chord, which we steal for the active
  // canvas; 'k' is the conventional "focus search" chord). Gated on ctrl/meta
  // ONLY: alt or shift held with these keys → no action (same slot, same guard
  // for both groups).
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
    switch (key) {
      case '=':
      case '+': return { type: 'zoomIn' };
      case '-':
      case '_': return { type: 'zoomOut' };
      case '0': return { type: 'zoomReset' };
      case 'k': return { type: 'search' };
    }
  }

  // Guard 1: typing context (bare keys only)
  if (editable) return null;

  // Help overlay: '?' (Shift+/ on most layouts). Resolved AFTER the editable
  // guard but BEFORE the modifier guard, because '?' inherently needs Shift —
  // guard 2 would otherwise swallow it. Gated off ctrl/meta/alt so it never
  // collides with a browser chord.
  if (key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    return { type: 'help' };
  }

  // Arrow-key panning: like '?', resolved after the editable guard but before
  // the modifier guard — Shift selects the fast step instead of suppressing.
  // Gated to the two canvas views (dict keeps native scroll) and off
  // ctrl/meta/alt (OS text/history navigation chords pass through).
  const panDir = PAN_DIRECTION[key];
  if (panDir && (view === 'graph' || view === 'flow') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const step = e.shiftKey ? PAN_STEP_FAST : PAN_STEP;
    return { type: 'pan', dx: panDir.dx * step, dy: panDir.dy * step };
  }

  // Guard 2: modifier chords (bare keys only — any modifier suppresses)
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;

  switch (key) {
    case 'g': return { type: 'view', view: 'graph' };
    case 'd': return { type: 'view', view: 'dict' };
    case 'f': return { type: 'view', view: 'flow' };
    case 'l': return view === 'graph' ? { type: 'toggleLayout' } : null;
    case 'b': return view === 'dict'  ? { type: 'toggleLens'   } : null;
    case '/': return { type: 'search' };
    default:  return null;
  }
}
