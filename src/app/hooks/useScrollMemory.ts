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

/** Remembers `ref`'s scrollTop under `key` in sessionStorage and restores it when `deps` change,
 *  re-applying it as content grows until the user scrolls, something else moves the view, or HOLD_MS passes. */
export function useScrollMemory(
  ref: RefObject<HTMLElement | null>,
  key: string,
  deps: DependencyList,
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
    if (!el) return;
    const target = readSaved(key);
    if (target === null) return;
    const restore = () => {
      el.scrollTop = target;
      restoredTopRef.current = el.scrollTop;
    };
    restore();
    const retry = Math.abs(el.scrollTop - target) < 1 ? 0 : requestAnimationFrame(restore);

    // The first notification is the observer's initial report, not growth.
    let primed = false;
    const growth = new ResizeObserver(() => {
      if (primed) restore();
      primed = true;
    });
    for (const child of Array.from(el.children)) growth.observe(child);
    // Scroll anchoring would chase the content that grows above, and its
    // scroll event would read as someone else moving the view.
    el.style.overflowAnchor = 'none';
    const stop = () => {
      cancelAnimationFrame(retry);
      growth.disconnect();
      clearTimeout(timer);
      el.style.removeProperty('overflow-anchor');
      el.removeEventListener('scroll', onScroll);
      for (const type of USER_SCROLL_INPUT) el.removeEventListener(type, stop);
    };
    const onScroll = () => {
      if (el.scrollTop !== restoredTopRef.current) stop();
    };
    const timer = setTimeout(stop, HOLD_MS);
    el.addEventListener('scroll', onScroll, { passive: true });
    for (const type of USER_SCROLL_INPUT) el.addEventListener(type, stop, { passive: true });
    return stop;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
