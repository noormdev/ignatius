/**
 * motion.ts — hover timing and the animation cutoff shared by the Graph,
 * Dictionary, and Flows views (docs/spec/large-model-nav.md).
 *
 * A hover focus fades every element outside the hovered one's connections,
 * which on a large model means restyling hundreds of elements. Applying it on
 * pointer contact made a pointer crossing the canvas repaint the whole view
 * once per element it passed over.
 */

/** How long the pointer must rest on one target before its hover focus applies. */
export const HOVER_INTENT_MS = 300;

/**
 * Rendered-element count (nodes + edges, or cards) above which a view drops
 * its transitions and smooth scrolls and jumps straight to the end state.
 */
export const ANIMATION_ELEMENT_LIMIT = 150;

export function animationsAllowed(renderedElementCount: number): boolean {
  return renderedElementCount <= ANIMATION_ELEMENT_LIMIT;
}

/**
 * A view over the limit marks its root `data-motion="off"`; scrolling to an
 * element inside it jumps instead of animating. Callers outside the view (the
 * shell scrolling to a process) get the same answer without recounting.
 */
export function scrollBehaviorWithin(el: Element): ScrollBehavior {
  return el.closest('[data-motion="off"]') ? 'auto' : 'smooth';
}

export interface HoverIntent {
  /** Report the target now under the pointer (`null` = none). */
  set(target: string | null): void;
  /** Apply a target immediately, dropping any pending one. */
  applyNow(target: string | null): void;
  /** Drop any pending target without applying it. */
  cancel(): void;
  /** The target most recently applied. */
  applied(): string | null;
}

/**
 * Every change of hover target, including leaving to empty space, applies only
 * after the pointer has stayed on that target for `delayMs`. Moving A → B
 * keeps A's focus until B settles, so the view switches in one step instead of
 * clearing and re-fading. Reporting the same target again (pointer moves
 * inside one element) never restarts the wait.
 */
export function createHoverIntent(
  apply: (target: string | null) => void,
  delayMs: number = HOVER_INTENT_MS,
): HoverIntent {
  let applied: string | null = null;
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  }

  function applyNow(target: string | null): void {
    cancel();
    if (target === applied) return;
    applied = target;
    apply(target);
  }

  function set(target: string | null): void {
    if (timer !== null && target === pending) return;
    cancel();
    if (target === applied) return;
    pending = target;
    timer = setTimeout(() => applyNow(target), delayMs);
  }

  return { set, applyNow, cancel, applied: () => applied };
}
