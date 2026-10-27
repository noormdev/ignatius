import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { Model } from '../../model/parse';
import type { ThemeMode } from '../../theme/theme-defaults';
import { resolveMermaidStyle } from '../../theme/mermaid-theme';
import { renderMermaidIn, rerenderAll } from '../logic/mermaid-render';

/** Renders `.mermaid-diagram` placeholders under `rootRef` as they appear or become visible, and again when the theme changes. */
export function useMermaid(rootRef: RefObject<HTMLElement | null>, model: Model | null, themeMode: ThemeMode): void {
  // A model reload hands over a new theme object; only a change in the key re-renders.
  const { style, styleKey } = useMemo(() => {
    const resolved = model ? resolveMermaidStyle(model.theme, themeMode) : null;
    return { style: resolved, styleKey: JSON.stringify(resolved) };
  }, [model, themeMode]);
  const renderedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || style === null) return;

    if (renderedKeyRef.current !== null && renderedKeyRef.current !== styleKey) {
      void rerenderAll(root, style);
    }
    renderedKeyRef.current = styleKey;

    let frame = 0;
    // A hidden placeholder has a zero box; it gets one when an ancestor stops being display:none.
    const revealed = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (!entry.target.isConnected) revealed.unobserve(entry.target);
        if (entry.contentRect.width === 0 || (entry.target instanceof HTMLElement && entry.target.offsetParent === null)) continue;
        revealed.unobserve(entry.target);
        schedule();
      }
    });
    const pass = () => {
      frame = 0;
      void renderMermaidIn(root, style);
      for (const el of Array.from(root.querySelectorAll('.mermaid-diagram:not([data-rendered])'))) revealed.observe(el);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(pass);
    };
    const appeared = new MutationObserver(schedule);
    appeared.observe(root, { childList: true, subtree: true });
    schedule();
    return () => {
      appeared.disconnect();
      revealed.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [rootRef, styleKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
