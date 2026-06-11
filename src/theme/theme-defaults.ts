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

// ── Flow kind colors ─────────────────────────────────────────────────────────

/** One color triple per DFD store/external kind, per mode. */
export type FlowKindEntry = {
  bg: string;
  fg: string;
  border: string;
};

/**
 * All DFD store kinds plus `external` (EE default).
 * `db` mirrors today's store fill; `external` mirrors today's ext green.
 * Other kinds get distinct, mode-appropriate colors.
 */
export const FLOW_KIND_KEYS = ['db', 'cache', 'queue', 'file', 'doc', 'manual', 'other', 'external'] as const;
export type FlowKindKey = (typeof FLOW_KIND_KEYS)[number];

type FlowKindsPalette = Record<FlowKindKey, FlowKindEntry>;

export const defaultFlowKinds: Record<ThemeMode, FlowKindsPalette> = {
  dark: {
    // db — unchanged from today's store fill (#3d2e00 / #d29922 / #f2d49b)
    db:       { bg: '#3d2e00', fg: '#f2d49b', border: '#d29922' },
    // cache — amber
    cache:    { bg: '#451a03', fg: '#fcd34d', border: '#d97706' },
    // queue — violet
    queue:    { bg: '#2e1065', fg: '#c4b5fd', border: '#7c3aed' },
    // file — lime
    file:     { bg: '#1a2e05', fg: '#bef264', border: '#65a30d' },
    // doc — sky
    doc:      { bg: '#082f49', fg: '#7dd3fc', border: '#0284c7' },
    // manual — rose
    manual:   { bg: '#4c0519', fg: '#fda4af', border: '#e11d48' },
    // other — slate
    other:    { bg: '#1e293b', fg: '#94a3b8', border: '#475569' },
    // external — unchanged from today's ext green (#1a3a1a / #b7f0c4 / #3fb950)
    external: { bg: '#1a3a1a', fg: '#b7f0c4', border: '#3fb950' },
  },
  light: {
    // db — unchanged from today's store fill (#fef9c3 / #713f12 / #ca8a04)
    db:       { bg: '#fef9c3', fg: '#713f12', border: '#ca8a04' },
    // cache — light amber
    cache:    { bg: '#fef3c7', fg: '#92400e', border: '#d97706' },
    // queue — light violet
    queue:    { bg: '#ede9fe', fg: '#4c1d95', border: '#7c3aed' },
    // file — light lime
    file:     { bg: '#f7fee7', fg: '#365314', border: '#65a30d' },
    // doc — light sky
    doc:      { bg: '#e0f2fe', fg: '#0c4a6e', border: '#0284c7' },
    // manual — light rose
    manual:   { bg: '#fff1f2', fg: '#881337', border: '#e11d48' },
    // other — light slate
    other:    { bg: '#f1f5f9', fg: '#334155', border: '#64748b' },
    // external — unchanged from today's ext green (#dcfce7 / #14532d / #16a34a)
    external: { bg: '#dcfce7', fg: '#14532d', border: '#16a34a' },
  },
};

export type ThemeConfig = {
  dark: ThemePalette;
  light: ThemePalette;
  spacing: ThemeSpacing;
  /** Per-kind DFD store/external colors. Partial overrides are deep-merged over defaults. */
  flowKinds?: Partial<Record<FlowKindKey, Partial<{ dark: Partial<FlowKindEntry>; light: Partial<FlowKindEntry> }>>>;
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
    nodeSep: 60,
    markerOffset: 10,
    markerScale: [0.5, 2.5],
  },
};

export function mergeTheme(partial: Partial<{
  dark: Partial<ThemePalette>;
  light: Partial<ThemePalette>;
  spacing: Partial<ThemeSpacing>;
  flowKinds: Partial<Record<FlowKindKey, Partial<{ dark: Partial<FlowKindEntry>; light: Partial<FlowKindEntry> }>>>;
}>): ThemeConfig {
  const mergedFlowKinds: ThemeConfig['flowKinds'] = partial.flowKinds
    ? { ...partial.flowKinds }
    : undefined;
  return {
    dark: { ...defaultTheme.dark, ...(partial.dark ?? {}) },
    light: { ...defaultTheme.light, ...(partial.light ?? {}) },
    spacing: { ...defaultTheme.spacing, ...(partial.spacing ?? {}) },
    ...(mergedFlowKinds !== undefined ? { flowKinds: mergedFlowKinds } : {}),
  };
}

/**
 * Resolve the fully-merged kind palette for a given mode.
 * User overrides (from theme.flowKinds) are merged over the defaults at the
 * FlowKindEntry level, so a partial `{ bg: '#...' }` wins without wiping fg/border.
 */
export function resolveFlowKindPalette(
  mode: ThemeMode,
  flowKinds?: ThemeConfig['flowKinds'],
): Record<FlowKindKey, FlowKindEntry> {
  const defaults = defaultFlowKinds[mode];
  if (!flowKinds) return defaults;

  const result = { ...defaults };
  for (const key of FLOW_KIND_KEYS) {
    const override = flowKinds[key];
    if (!override) continue;
    const modeOverride = override[mode];
    if (!modeOverride) continue;
    result[key] = { ...defaults[key], ...modeOverride };
  }
  return result;
}
