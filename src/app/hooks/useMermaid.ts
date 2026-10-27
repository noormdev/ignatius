import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { Model } from '../../model/parse';
import type { ThemeMode } from '../../theme/theme-defaults';
import { resolveMermaidThemeVariables } from '../../theme/mermaid-theme';
import { renderMermaidIn, rerenderAll } from '../logic/mermaid-render';

/** Renders `.mermaid-diagram` placeholders under `rootRef` as they appear or become visible, and again when the theme changes. */
export function useMermaid(rootRef: RefObject<HTMLElement | null>, model: Model | null, themeMode: ThemeMode): void {
  // A model reload hands over a new theme object; only a change in the key re-renders.
  const { themeVariables, variablesKey } = useMemo(() => {
    const variables = model ? resolveMermaidThemeVariables(model.theme, themeMode) : null;
    return { themeVariables: variables, variablesKey: JSON.stringify(variables) };
  }, [model, themeMode]);
  const renderedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || themeVariables === null) return;

    if (renderedKeyRef.current !== null && renderedKeyRef.current !== variablesKey) {
      void rerenderAll(root, themeVariables);
    }
    renderedKeyRef.current = variablesKey;

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
      void renderMermaidIn(root, themeVariables);
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
  }, [rootRef, variablesKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
