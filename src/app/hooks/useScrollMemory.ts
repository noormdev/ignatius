import { useEffect, useLayoutEffect, useRef } from 'react';
import type { DependencyList, RefObject } from 'react';

const HOLD_MS = 2000;
const USER_SCROLL_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

function readSaved(key: string): number | null {
  try {
    const saved = Number(sessionStorage.getItem(key) ?? '');
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  } catch {
    return null;
  }
}

/** Scrolls `el` to `target()` and re-applies it as content grows, until the reader scrolls or HOLD_MS passes.
 *  `onApply` sees each scrollTop the hold produces. Returns a stop function. */
export function holdScroll(el: HTMLElement, target: () => number, onApply?: (top: number) => void): () => void {
  let applied: number | null = null;
  const apply = () => {
    el.scrollTop = target();
    applied = el.scrollTop;
    onApply?.(applied);
  };
  apply();
  let retry = requestAnimationFrame(apply);

  // Every report re-applies, the observer's first one included: content shown a moment ago
  // (a view switch) has often grown before that first report arrives.
  const growth = new ResizeObserver(apply);
  for (const child of Array.from(el.children)) growth.observe(child);
  // Scroll anchoring would chase the content that grows above, and its
  // scroll event would read as someone else moving the view.
  el.style.overflowAnchor = 'none';
  const stop = () => {
    cancelAnimationFrame(retry);
    retry = 0;
    growth.disconnect();
    clearTimeout(timer);
    el.style.removeProperty('overflow-anchor');
    el.removeEventListener('scroll', onScroll);
    for (const type of USER_SCROLL_INPUT) el.removeEventListener(type, stop);
  };
  // Content that shrinks for a moment (a diagram swapping its placeholder) clamps scrollTop to the
  // new bottom; that is the browser, not someone moving the view, so the hold carries on.
  const onScroll = () => {
    if (el.scrollTop === applied) return;
    const clamped = el.scrollTop >= el.scrollHeight - el.clientHeight - 1 && target() > el.scrollTop;
    if (!clamped) {
      stop();
      return;
    }
    applied = el.scrollTop;
    onApply?.(applied);
  };
  const timer = setTimeout(stop, HOLD_MS);
  el.addEventListener('scroll', onScroll, { passive: true });
  for (const type of USER_SCROLL_INPUT) el.addEventListener(type, stop, { passive: true });
  return stop;
}

/** Remembers `ref`'s scrollTop under `key` in sessionStorage and restores it when `deps` change, holding it as
 *  content grows (`holdScroll`). `shouldRestore` returning false skips a restore, e.g. when a deep link names the target. */
export function useScrollMemory(
  ref: RefObject<HTMLElement | null>,
  key: string,
  deps: DependencyList,
  shouldRestore: () => boolean = () => true,
): void {
  // The scrollTop a restore produced; its scroll events must not save, or a
  // value clamped by short content would overwrite the real one.
  const restoredTopRef = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const save = () => {
      frame = 0;
      if (el.scrollTop === restoredTopRef.current) return;
      try {
        sessionStorage.setItem(key, String(el.scrollTop));
      } catch {}
    };
    const onScroll = () => {
      if (el.scrollTop === restoredTopRef.current) return;
      restoredTopRef.current = null;
      if (frame === 0) frame = requestAnimationFrame(save);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ref, key]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !shouldRestore()) return;
    const saved = readSaved(key);
    if (saved === null) return;
    return holdScroll(el, () => saved, top => { restoredTopRef.current = top; });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
