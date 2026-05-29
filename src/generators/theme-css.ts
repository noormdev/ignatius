import { semanticColors, type ThemeConfig } from '../theme-defaults';

function blendHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar * (1 - t) + br * t);
  const g = Math.round(ag * (1 - t) + bg * t);
  const bl = Math.round(ab * (1 - t) + bb * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

export function buildThemeCssVars(theme: ThemeConfig, mode: 'dark' | 'light'): string {
  const p = mode === 'dark' ? theme.dark : theme.light;
  const surfaceAlt = blendHex(p.background, p.surface, 0.5);

  return `
  --color-background: ${p.background};
  --color-surface: ${p.surface};
  --color-border: ${p.border};
  --color-text: ${p.text};
  --color-text-muted: ${p.textMuted};
  --color-text-secondary: ${p.text}cc;
  --color-surface-alt: ${surfaceAlt};
  --color-edge-identifying: ${p.edgeIdentifying};
  --color-edge-referential: ${p.edgeReferential};
  --badge-independent-bg: ${semanticColors[mode].independent.bg};
  --badge-independent-fg: ${semanticColors[mode].independent.fg};
  --badge-dependent-bg: ${semanticColors[mode].dependent.bg};
  --badge-dependent-fg: ${semanticColors[mode].dependent.fg};
  --badge-classifier-bg: ${semanticColors[mode].classifier.bg};
  --badge-classifier-fg: ${semanticColors[mode].classifier.fg};
  --badge-subtype-bg: ${semanticColors[mode].subtype.bg};
  --badge-subtype-fg: ${semanticColors[mode].subtype.fg};
  --badge-associative-bg: ${semanticColors[mode].associative.bg};
  --badge-associative-fg: ${semanticColors[mode].associative.fg};
  --color-link: ${semanticColors[mode].link};
`.trim();
}
