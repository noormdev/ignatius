import { useEffect, useState } from 'react';
import type { ThemeMode } from '../../theme/theme-defaults';
import { applyThemeCssVars } from '../dom/theme-css-vars';
import type { Model, ThemeConfig } from '../../model/parse';

// Theme-mode state, localStorage persistence, and applyThemeCssVars effect.
// Seeds from window.__THEME_MODE__ (static export) or localStorage.
//
// `model` is accepted so the CSS-vars effect re-fires on model changes (SSE
// live-reload may deliver a new model with the same themeConfig identity in a
// future refactor). Matches the base [model, themeMode] dependency semantics.
export function useThemeMode(themeConfig: ThemeConfig | undefined, model?: Model | null): {
  themeMode: ThemeMode;
  toggleTheme: () => void;
} {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (window.__THEME_MODE__) return window.__THEME_MODE__;
    const stored = localStorage.getItem('ignatius-theme');
    return stored === 'light' ? 'light' : 'dark';
  });

  // Apply CSS custom properties whenever the theme config, mode, or model changes.
  // Including model ensures CSS vars reapply after every SSE-triggered model refresh,
  // equivalent to the original [model, themeMode] deps in the monolithic App.tsx.
  useEffect(() => {
    if (themeConfig) applyThemeCssVars(themeConfig, themeMode);
  }, [themeConfig, themeMode, model]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleTheme() {
    const next: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
    localStorage.setItem('ignatius-theme', next);
    setThemeMode(next);
  }

  return { themeMode, toggleTheme };
}
