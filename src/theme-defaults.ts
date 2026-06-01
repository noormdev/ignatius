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

export type ThemeMode = 'dark' | 'light';

type SemanticPalette = {
  independent: { bg: string; fg: string };
  dependent:   { bg: string; fg: string };
  classifier:  { bg: string; fg: string };
  subtype:     { bg: string; fg: string };
  associative: { bg: string; fg: string };
  link:        string;
};

// Semantic classification colors — mode-aware. Dark values optimized for dark
// surfaces (dark bg + bright fg); light values optimized for white surfaces
// (tinted bg + dark fg). Consumers index by active mode.
export const semanticColors = {
  dark: {
    independent: { bg: '#0d419d', fg: '#58a6ff' },
    dependent:   { bg: '#3d2e00', fg: '#d29922' },
    classifier:  { bg: '#1c2128', fg: '#8b949e' },
    subtype:     { bg: '#1a3a1a', fg: '#3fb950' },
    associative: { bg: '#3d1f00', fg: '#f0883e' },
    link:        '#58a6ff',
  },
  light: {
    independent: { bg: '#ddf4ff', fg: '#0550ae' },
    dependent:   { bg: '#fff8c5', fg: '#7d4e00' },
    classifier:  { bg: '#eaeef2', fg: '#24292f' },
    subtype:     { bg: '#dafbe1', fg: '#1a7f37' },
    associative: { bg: '#ffec9e', fg: '#9a6700' },
    link:        '#0969da',
  },
} satisfies Record<ThemeMode, SemanticPalette>;

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
    nodeSep: 45,
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
