import type { MermaidThemeConfig } from './mermaid-theme';

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

/** Compact cap symbols used consistently anywhere a DFD store kind is identified. */
export const FLOW_STORE_KIND_SYMBOLS: Record<Exclude<FlowKindKey, 'external'>, string> = {
  db: 'D',
  cache: 'C',
  queue: 'Q',
  file: 'F',
  doc: 'Do',
  manual: 'M',
  other: 'O',
};

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
  /** Mermaid node style keys and per-mode `themeVariables` overrides; read through resolveMermaidStyle(). */
  mermaid?: MermaidThemeConfig;
  /** ignatius.yml key paths dropped from `theme.mermaid`; validateModel reports each one. */
  invalidMermaidKeys?: string[];
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
  mermaid: unknown;
}>): ThemeConfig {
  // Carried through as the user's RAW overrides — deliberately NOT merged against
  // the defaults here. `resolveFlowKindPalette()` does that merge per mode, at the
  // FlowKindEntry level, so a partial `{ bg }` override keeps the default fg/border.
  // So `ThemeConfig.flowKinds` after this call is the override set, not the
  // resolved palette; read it through resolveFlowKindPalette(), never directly.
  const mergedFlowKinds: ThemeConfig['flowKinds'] = partial.flowKinds
    ? { ...partial.flowKinds }
    : undefined;
  const { mermaid, invalidKeys } = readMermaidTheme(partial.mermaid);
  const dark = { ...defaultTheme.dark, ...(partial.dark ?? {}) };
  const light = { ...defaultTheme.light, ...(partial.light ?? {}) };
  invalidKeys.push(...unsafeDiagramColors('dark', dark), ...unsafeDiagramColors('light', light));
  return {
    dark,
    light,
    spacing: { ...defaultTheme.spacing, ...(partial.spacing ?? {}) },
    ...(mergedFlowKinds !== undefined ? { flowKinds: mergedFlowKinds } : {}),
    ...(mermaid !== undefined ? { mermaid } : {}),
    ...(invalidKeys.length > 0 ? { invalidMermaidKeys: invalidKeys } : {}),
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Mermaid writes themeVariables into the SVG's <style> unsanitized. This is its own directive
// pattern plus `-`, which generic font names need and which cannot end a declaration.
export const SAFE_MERMAID_VALUE = /^[\d "#%(),.;A-Za-z-]+$/;

// Six-digit hex only: label colours are picked by contrast against each fill.
const HEX_COLOR = /^#[\dA-Fa-f]{6}$/;

/** `undefined` when absent, `null` when not a finite number in [min, max]. */
function readNumberInRange(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/** The palette colours diagrams use. */
export const DIAGRAM_PALETTE_KEYS = ['background', 'surface', 'text', 'textMuted'] as const;

const MERMAID_KEYS = new Set(['stroke_width', 'radius', 'shadow', 'node_fills', 'dark', 'light']);

function unsafeDiagramColors(mode: ThemeMode, palette: ThemePalette): string[] {
  return DIAGRAM_PALETTE_KEYS.filter(key => !SAFE_MERMAID_VALUE.test(palette[key])).map(key => `theme.${mode}.${key}`);
}

const SAFE_CHARS = 'letters, digits, spaces and # % ( ) , . ; - "';

/** The `config.mermaid_theme_invalid` message for one key path from `ThemeConfig.invalidMermaidKeys`. */
export function mermaidKeyMessage(path: string): string {
  const key = path.split('.').slice(2).join('.');
  if (path.startsWith('theme.dark.') || path.startsWith('theme.light.')) {
    return `"${path}" is not used in Mermaid diagrams: it may hold only ${SAFE_CHARS}. Diagrams use the default color.`;
  }
  const problems: Record<string, string> = {
    '': 'must be a mapping',
    stroke_width: 'must be a number from 0 to 8',
    radius: 'must be a number from 0 to 32',
    shadow: 'must be true or false',
    node_fills: 'must be a list of 1 to 12 quoted "#rrggbb" colors',
    dark: 'must be a mapping of Mermaid variables',
    light: 'must be a mapping of Mermaid variables',
  };
  const [first = ''] = key.split('.');
  const problem = problems[key]
    ?? (MERMAID_KEYS.has(first)
      ? `must be a number or a string of ${SAFE_CHARS} only`
      : `is not a Mermaid theme key; use ${[...MERMAID_KEYS].join(', ')}`);
  return `"${path}" is ignored: it ${problem}.`;
}

/** Keep the valid parts of a raw `theme.mermaid` block; `invalidKeys` lists each dropped part by its ignatius.yml key path. */
function readMermaidTheme(raw: unknown): { mermaid?: MermaidThemeConfig; invalidKeys: string[] } {
  if (raw === undefined) return { invalidKeys: [] };
  if (!isPlainObject(raw)) return { invalidKeys: ['theme.mermaid'] };
  const mermaid: MermaidThemeConfig = {};
  const invalidKeys = Object.keys(raw).filter(key => !MERMAID_KEYS.has(key)).map(key => `theme.mermaid.${key}`);
  const strokeWidth = readNumberInRange(raw['stroke_width'], 0, 8);
  if (strokeWidth === null) invalidKeys.push('theme.mermaid.stroke_width');
  else if (strokeWidth !== undefined) mermaid.stroke_width = strokeWidth;
  const radius = readNumberInRange(raw['radius'], 0, 32);
  if (radius === null) invalidKeys.push('theme.mermaid.radius');
  else if (radius !== undefined) mermaid.radius = radius;
  const shadow = raw['shadow'];
  if (typeof shadow === 'boolean') mermaid.shadow = shadow;
  else if (shadow !== undefined) invalidKeys.push('theme.mermaid.shadow');
  const fills = raw['node_fills'];
  if (Array.isArray(fills) && fills.length > 0 && fills.length <= 12 && fills.every((f): f is string => typeof f === 'string' && HEX_COLOR.test(f))) {
    mermaid.node_fills = fills;
  } else if (fills !== undefined) invalidKeys.push('theme.mermaid.node_fills');
  for (const mode of ['dark', 'light'] satisfies ThemeMode[]) {
    const block = raw[mode];
    if (block === undefined) continue;
    if (!isPlainObject(block)) {
      invalidKeys.push(`theme.mermaid.${mode}`);
      continue;
    }
    const kept: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(block)) {
      if (typeof value === 'number' || (typeof value === 'string' && SAFE_MERMAID_VALUE.test(value))) kept[key] = value;
      else invalidKeys.push(`theme.mermaid.${mode}.${key}`);
    }
    mermaid[mode] = kept;
  }
  return { mermaid, invalidKeys };
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
