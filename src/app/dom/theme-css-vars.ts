import { semanticColors, type ThemeConfig, type ThemeMode } from '../../theme/theme-defaults';
import { blendHex } from '../logic/color';

export function applyThemeCssVars(theme: ThemeConfig, mode: ThemeMode) {
  const p = mode === 'light' ? theme.light : theme.dark;
  const root = document.documentElement;
  root.classList.remove('theme-dark', 'theme-light');
  root.classList.add(`theme-${mode}`);
  root.style.setProperty('--color-background', p.background);
  root.style.setProperty('--color-surface', p.surface);
  root.style.setProperty('--color-border', p.border);
  root.style.setProperty('--color-text', p.text);
  root.style.setProperty('--color-text-muted', p.textMuted);
  root.style.setProperty('--color-text-secondary', p.text + 'cc');
  // surface-alt: halfway between background and surface (for dividers)
  root.style.setProperty('--color-surface-alt', blendHex(p.background, p.surface, 0.5));
  root.style.setProperty('--color-edge-identifying', p.edgeIdentifying);
  root.style.setProperty('--color-edge-referential', p.edgeReferential);

  // Semantic classification badge colors — mode-aware
  const sc = semanticColors[mode];
  root.style.setProperty('--badge-independent-bg', sc.independent.bg);
  root.style.setProperty('--badge-independent-fg', sc.independent.fg);
  root.style.setProperty('--badge-dependent-bg', sc.dependent.bg);
  root.style.setProperty('--badge-dependent-fg', sc.dependent.fg);
  root.style.setProperty('--badge-classifier-bg', sc.classifier.bg);
  root.style.setProperty('--badge-classifier-fg', sc.classifier.fg);
  root.style.setProperty('--badge-subtype-bg', sc.subtype.bg);
  root.style.setProperty('--badge-subtype-fg', sc.subtype.fg);
  root.style.setProperty('--badge-associative-bg', sc.associative.bg);
  root.style.setProperty('--badge-associative-fg', sc.associative.fg);
  root.style.setProperty('--color-link', sc.link);

  // CP9: DD search-highlight color — yellow with opacity for contrast in both modes.
  root.style.setProperty(
    '--dd-search-highlight',
    mode === 'dark' ? 'rgba(255, 215, 0, 0.40)' : 'rgba(255, 195, 0, 0.50)',
  );

  // Direction-badge colors (read/write/readwrite) — mode-aware so they adapt on
  // theme switch. Dark: slightly brighter tints; light: slightly more saturated.
  if (mode === 'dark') {
    root.style.setProperty('--color-badge-read-bg', 'rgba(59, 130, 246, 0.15)');
    root.style.setProperty('--color-badge-read-fg', '#58a6ff');
    root.style.setProperty('--color-badge-write-bg', 'rgba(16, 185, 129, 0.15)');
    root.style.setProperty('--color-badge-write-fg', '#3fb950');
    root.style.setProperty('--color-badge-rw-bg', 'rgba(139, 92, 246, 0.15)');
    root.style.setProperty('--color-badge-rw-fg', '#b083f0');
  } else {
    root.style.setProperty('--color-badge-read-bg', 'rgba(5, 80, 174, 0.10)');
    root.style.setProperty('--color-badge-read-fg', '#0550ae');
    root.style.setProperty('--color-badge-write-bg', 'rgba(26, 127, 55, 0.10)');
    root.style.setProperty('--color-badge-write-fg', '#1a7f37');
    root.style.setProperty('--color-badge-rw-bg', 'rgba(130, 80, 223, 0.10)');
    root.style.setProperty('--color-badge-rw-fg', '#6639ba');
  }
}
