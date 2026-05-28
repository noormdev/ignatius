export type ThemePalette = {
  background: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  edgeIdentifying: string;
  edgeReferential: string;
  pastelMix: number;
};

export type ThemeSpacing = {
  nodeSep: number;
  markerOffset: number;
  markerScale: [number, number];
};

// Semantic classification colors — fixed across all themes, not user-configurable
export const semanticColors = {
  independent: { bg: '#0d419d', fg: '#58a6ff' },
  dependent:   { bg: '#3d2e00', fg: '#d29922' },
  classifier:  { bg: '#1c2128', fg: '#8b949e' },
  subtype:     { bg: '#1a3a1a', fg: '#3fb950' },
  associative: { bg: '#3d1f00', fg: '#f0883e' },
  link:        '#58a6ff',
} as const;

export type ThemeConfig = {
  dark: ThemePalette;
  light: ThemePalette;
  spacing: ThemeSpacing;
};

export const defaultTheme: ThemeConfig = {
  dark: {
    background: '#0e1116',
    surface: '#161b22',
    border: '#30363d',
    text: '#e6edf3',
    textMuted: '#8b949e',
    edgeIdentifying: '#8b949e',
    edgeReferential: '#3d424a',
    pastelMix: 0.3,
  },
  light: {
    background: '#ffffff',
    surface: '#f6f8fa',
    border: '#d0d7de',
    text: '#1f2328',
    textMuted: '#656d76',
    edgeIdentifying: '#656d76',
    edgeReferential: '#b0b8c1',
    pastelMix: 0.15,
  },
  spacing: {
    nodeSep: 30,
    markerOffset: 10,
    markerScale: [0.5, 2.5],
  },
};

export function mergeTheme(partial: Partial<{
  dark: Partial<ThemePalette>;
  light: Partial<ThemePalette>;
  spacing: Partial<ThemeSpacing>;
}>): ThemeConfig {
  return {
    dark: { ...defaultTheme.dark, ...(partial.dark ?? {}) },
    light: { ...defaultTheme.light, ...(partial.light ?? {}) },
    spacing: { ...defaultTheme.spacing, ...(partial.spacing ?? {}) },
  };
}
