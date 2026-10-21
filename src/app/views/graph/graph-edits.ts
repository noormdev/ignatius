import type { PositionMap } from './layout-store';

/** Class on a node the user removed from view. */
export const USER_HIDDEN_CLASS = 'user-hidden';

export type LayoutMode = 'hierarchical' | 'organic' | 'tree';

/** The order `L` and the FAB step through. */
const LAYOUT_CYCLE: readonly LayoutMode[] = ['organic', 'hierarchical', 'tree'];

export const LAYOUT_MODE_NAME: Record<LayoutMode, string> = {
  organic: 'Organic',
  hierarchical: 'Hierarchical',
  tree: 'Tree',
};

export function nextLayoutMode(mode: LayoutMode): LayoutMode {
  return LAYOUT_CYCLE[(LAYOUT_CYCLE.indexOf(mode) + 1) % LAYOUT_CYCLE.length] ?? 'organic';
}

/** A stored mode string, or organic when it is missing or unknown. */
export function parseLayoutMode(value: string | null): LayoutMode {
  return LAYOUT_CYCLE.find(mode => mode === value) ?? 'organic';
}

/** Where every node sits, which nodes the user removed from view, and the layout mode. */
export type GraphSnapshot = { positions: PositionMap; hidden: string[]; mode: LayoutMode };

/** What the shell needs to draw the edit controls. */
export type GraphEditState = { canUndo: boolean; canRedo: boolean; selectMode: boolean; hidden: string[] };

export interface EditHistory {
  /** Record the state from before a change. Drops anything that could be redone. */
  push(before: GraphSnapshot): void;
  /** The state before the last change, or null; `current` becomes redoable. */
  undo(current: GraphSnapshot): GraphSnapshot | null;
  /** The state the last undo left, or null; `current` becomes undoable. */
  redo(current: GraphSnapshot): GraphSnapshot | null;
  /** Drop the newest undo step without making it redoable. */
  discardLast(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

export function createEditHistory(limit = 100): EditHistory {
  const past: GraphSnapshot[] = [];
  const future: GraphSnapshot[] = [];

  function record(stack: GraphSnapshot[], snapshot: GraphSnapshot): void {
    stack.push(snapshot);
    if (stack.length > limit) stack.shift();
  }

  return {
    push(before) {
      record(past, before);
      future.length = 0;
    },
    undo(current) {
      const previous = past.pop();
      if (!previous) return null;
      record(future, current);
      return previous;
    },
    redo(current) {
      const next = future.pop();
      if (!next) return null;
      record(past, current);
      return next;
    },
    discardLast() {
      past.pop();
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
