import { blendHex } from '../app/logic/color';
import {
  defaultFlowKinds,
  defaultTheme,
  DIAGRAM_PALETTE_KEYS,
  SAFE_MERMAID_VALUE,
  semanticColors,
  type ThemeConfig,
  type ThemeMode,
  type ThemePalette,
} from './theme-defaults';

/** `theme.mermaid` in ignatius.yml: node style keys, plus Mermaid `themeVariables` per mode under Mermaid's own key names. */
export type MermaidThemeConfig = {
  stroke_width?: number;
  radius?: number;
  shadow?: boolean;
  node_fills?: string[];
  dark?: Record<string, string | number>;
  light?: Record<string, string | number>;
};

export type MermaidThemeVariables = Record<string, string | number | Record<string, string | number>>;

/** What `mermaid.initialize` takes for one theme mode. */
export type MermaidStyle = { themeVariables: MermaidThemeVariables; themeCSS: string };

/** The entity colours at full strength, bright enough for black labels in both modes. */
export const DEFAULT_MERMAID_FILLS: readonly string[] = [
  semanticColors.dark.independent.fg,
  semanticColors.dark.dependent.fg,
  semanticColors.dark.subtype.fg,
  semanticColors.dark.associative.fg,
  defaultFlowKinds.dark.queue.fg,
];
const DEFAULT_MERMAID_STROKE_WIDTH = 3;
const DEFAULT_MERMAID_RADIUS = 8;

/** Keep in step with `body` in src/app/styles.css. */
const BODY_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const WHITE = '#ffffff';
const BLACK = '#000000';
const OUTLINE = BLACK;

// Every node outline except the start dot and the ER attribute rows, which share the `.node` group.
const NODE_SHAPE = ':is(rect, polygon, path, circle):not(.state-start):not(:is(.row-rect-odd, .row-rect-even, .divider) *)';

function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  const raw = m?.[1];
  if (raw === undefined) return 0.5;
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map(i => {
    const v = Number.parseInt(raw.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function labelOn(fill: string): string {
  return contrastRatio(BLACK, fill) >= contrastRatio(WHITE, fill) ? BLACK : WHITE;
}

/** The one label colour for a slot drawn on any of `fills`: the one whose worst contrast is best. */
function labelOnAll(fills: readonly string[]): string {
  const worst = (ink: string) => Math.min(...fills.map(fill => contrastRatio(ink, fill)));
  return worst(BLACK) >= worst(WHITE) ? BLACK : WHITE;
}

function erRowEven(fills: readonly string[]): string {
  return blendHex(WHITE, fills[0] ?? WHITE, 0.12);
}

function nodeFills(theme: ThemeConfig): readonly string[] {
  const fills = theme.mermaid?.node_fills;
  return fills && fills.length > 0 ? fills : DEFAULT_MERMAID_FILLS;
}

// Mermaid writes the palette into the diagram's <style> unescaped; mergeTheme reports each value replaced here.
function safePalette(theme: ThemeConfig, mode: ThemeMode): ThemePalette {
  const safe = { ...theme[mode] };
  for (const key of DIAGRAM_PALETTE_KEYS) {
    if (!SAFE_MERMAID_VALUE.test(safe[key])) safe[key] = defaultTheme[mode][key];
  }
  return safe;
}

/** Mermaid themeVariables for `mode`: palette-derived defaults for every diagram family (Mermaid fills
 *  an unnamed family with colours that ignore the theme), overridden by `theme.mermaid[mode]`. */
export function resolveMermaidThemeVariables(theme: ThemeConfig, mode: ThemeMode): MermaidThemeVariables {
  const p = safePalette(theme, mode);
  const ink = p.text;
  const inkSoft = p.textMuted;
  const paper = p.background;
  const sunk = blendHex(p.surface, p.background, 0.5);
  // Dark mode draws connectors in the muted text tone so they stay quieter than the nodes.
  const line = mode === 'light' ? ink : inkSoft;
  const label = mode === 'light' ? ink : blendHex(inkSoft, ink, 0.35);
  const series = nodeFills(theme);
  const fillAt = (i: number) => series[i % series.length] ?? WHITE;
  const onSeries = labelOnAll(series);
  const accent = fillAt(1);

  const vars: MermaidThemeVariables = {
    fontFamily: BODY_FONT,
    fontSize: '14px',
    background: paper,
    // Node fills, outlines and labels come from the theme CSS; these reach the shapes it does not paint.
    primaryColor: fillAt(0),
    primaryTextColor: labelOn(fillAt(0)),
    primaryBorderColor: OUTLINE,
    secondaryColor: fillAt(1),
    secondaryTextColor: labelOn(fillAt(1)),
    secondaryBorderColor: OUTLINE,
    tertiaryColor: fillAt(2),
    tertiaryTextColor: labelOn(fillAt(2)),
    tertiaryBorderColor: OUTLINE,
    lineColor: line,
    arrowheadColor: line,
    textColor: ink,
    titleColor: ink,
    edgeLabelBackground: paper,
    clusterBkg: paper,
    clusterBorder: OUTLINE,
    // The theme CSS draws the shadow; Mermaid's own is a light grey smudge on a dark surface.
    dropShadow: 'none',
    errorBkgColor: fillAt(3),
    errorTextColor: labelOn(fillAt(3)),

    actorBkg: fillAt(1),
    actorBorder: OUTLINE,
    actorTextColor: labelOn(fillAt(1)),
    actorLineColor: line,
    signalColor: line,
    signalTextColor: ink,
    labelBoxBkgColor: fillAt(0),
    labelBoxBorderColor: OUTLINE,
    labelTextColor: labelOn(fillAt(0)),
    loopTextColor: ink,
    noteBkgColor: fillAt(2),
    noteBorderColor: OUTLINE,
    noteTextColor: labelOn(fillAt(2)),
    activationBkgColor: fillAt(3),
    activationBorderColor: OUTLINE,
    sequenceNumberColor: labelOn(line),

    stateBkg: fillAt(0),
    stateLabelColor: ink,
    labelColor: ink,
    altBackground: sunk,
    compositeBackground: paper,
    compositeTitleBackground: sunk,
    compositeBorder: OUTLINE,
    transitionColor: line,
    transitionLabelColor: label,
    specialStateColor: inkSoft,
    innerEndBackground: inkSoft,

    classText: labelOn(fillAt(0)),
    relationColor: line,
    relationLabelColor: label,
    relationLabelBackground: paper,
    requirementBackground: fillAt(0),
    requirementBorderColor: OUTLINE,
    requirementTextColor: labelOn(fillAt(0)),

    // ER attribute rows stay light in both modes; their labels are black whatever the node fills.
    rowOdd: WHITE,
    rowEven: erRowEven(series),
    attributeBackgroundColorOdd: WHITE,
    attributeBackgroundColorEven: erRowEven(series),

    // Gantt text inside a bar takes the bar's label colour. Mermaid reuses taskTextDarkColor for text
    // beside a bar and on done bars (both on the page tone) and on active bars, which themeCSS recolours.
    sectionBkgColor: sunk,
    altSectionBkgColor: paper,
    sectionBkgColor2: sunk,
    gridColor: inkSoft,
    taskBkgColor: fillAt(0),
    taskBorderColor: OUTLINE,
    taskTextColor: labelOn(fillAt(0)),
    taskTextLightColor: labelOn(fillAt(0)),
    taskTextDarkColor: ink,
    taskTextOutsideColor: ink,
    taskTextClickableColor: semanticColors[mode].link,
    activeTaskBkgColor: fillAt(2),
    activeTaskBorderColor: OUTLINE,
    doneTaskBkgColor: sunk,
    doneTaskBorderColor: inkSoft,
    critBkgColor: fillAt(3),
    critBorderColor: OUTLINE,
    todayLineColor: accent,
    vertLineColor: accent,

    pieTitleTextColor: ink,
    pieSectionTextColor: onSeries,
    pieLegendTextColor: ink,
    pieStrokeColor: OUTLINE,
    pieOuterStrokeColor: OUTLINE,
    quadrant1Fill: fillAt(0),
    quadrant2Fill: fillAt(1),
    quadrant3Fill: fillAt(2),
    quadrant4Fill: fillAt(3),
    quadrant1TextFill: labelOn(fillAt(0)),
    quadrant2TextFill: labelOn(fillAt(1)),
    quadrant3TextFill: labelOn(fillAt(2)),
    quadrant4TextFill: labelOn(fillAt(3)),
    quadrantPointFill: ink,
    quadrantPointTextFill: ink,
    quadrantXAxisTextFill: inkSoft,
    quadrantYAxisTextFill: inkSoft,
    quadrantInternalBorderStrokeFill: OUTLINE,
    quadrantExternalBorderStrokeFill: OUTLINE,
    quadrantTitleFill: ink,

    commitLabelColor: ink,
    commitLabelBackground: sunk,
    tagLabelColor: labelOn(fillAt(2)),
    tagLabelBackground: fillAt(2),
    tagLabelBorder: OUTLINE,

    // xychart reads a nested object rather than flat keys. Sankey takes only
    // textColor from the theme; its node fills come from Mermaid's sankey config.
    xyChart: {
      backgroundColor: paper,
      titleColor: ink,
      xAxisLabelColor: ink,
      xAxisTitleColor: ink,
      xAxisTickColor: inkSoft,
      xAxisLineColor: inkSoft,
      yAxisLabelColor: ink,
      yAxisTitleColor: ink,
      yAxisTickColor: inkSoft,
      yAxisLineColor: inkSoft,
      plotColorPalette: series.join(','),
    },
  };

  // Mermaid indexes these by position, so each family cycles the series to its
  // own length, and each label is resolved against the fill it lands on.
  for (let i = 0; i < 8; i++) {
    vars[`git${i}`] = fillAt(i);
    vars[`gitInv${i}`] = labelOn(fillAt(i));
    vars[`gitBranchLabel${i}`] = labelOn(fillAt(i));
    vars[`fillType${i}`] = fillAt(i);
  }
  for (let i = 0; i < 12; i++) {
    vars[`pie${i + 1}`] = fillAt(i);
    vars[`cScale${i}`] = fillAt(i);
    vars[`cScaleLabel${i}`] = labelOn(fillAt(i));
    vars[`cScaleInv${i}`] = labelOn(fillAt(i));
  }

  return { ...vars, ...(theme.mermaid?.[mode] ?? {}) };
}

/** Mermaid `themeCSS` for `mode`: outlines, radius, shadow, the per-node fill cycle, and label colours,
 *  none of which Mermaid exposes as a theme variable. Colours come from the resolved `vars`, already filtered. */
function themeCSS(theme: ThemeConfig, mode: ThemeMode, vars: MermaidThemeVariables): string {
  const stroke = theme.mermaid?.stroke_width ?? DEFAULT_MERMAID_STROKE_WIDTH;
  const radius = theme.mermaid?.radius ?? DEFAULT_MERMAID_RADIUS;
  // Dark in both modes: a light shadow on a dark page reads as a glow.
  const shadowColor = mode === 'light' ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.85)';
  const filter = theme.mermaid?.shadow === false ? 'none' : `drop-shadow(3px 5px 8px ${shadowColor})`;
  const fills = nodeFills(theme);
  const canvas = String(vars['background']);
  const ink = String(vars['textColor']);
  const line = String(vars['lineColor']);
  const label = String(vars['transitionLabelColor']);
  const activeTaskText = labelOn(String(vars['activeTaskBkgColor']));
  const edge = Math.max(1, Math.round(stroke * 0.85 * 10) / 10);
  const fillRule = (selector: string, fill: string) =>
    `${selector} ${NODE_SHAPE} { fill: ${fill}; }\n${selector} .nodeLabel { color: ${labelOn(fill)}; }`;
  const cycle = fills.map((fill, i) => fillRule(`.node:nth-child(${fills.length}n+${i + 1})`, fill)).join('\n');
  const store = fills[0] ?? WHITE;
  const decision = fills[1 % fills.length] ?? WHITE;

  return `
.node ${NODE_SHAPE}, rect.actor, rect.note, .cluster rect, .labelBox {
  stroke: ${OUTLINE};
  stroke-width: ${stroke}px;
  rx: ${radius}px;
  ry: ${radius}px;
  filter: ${filter};
}
${cycle}
${fillRule('.node.ignatius-store', store)}
${fillRule('.node.ignatius-decision', decision)}
.cluster rect { fill: ${canvas}; filter: none; }
.cluster-label .nodeLabel { color: ${ink}; }
.row-rect-odd > path { fill: ${WHITE}; }
.row-rect-even > path { fill: ${erRowEven(fills)}; }
.node .label:is(.attribute-name, .attribute-type, .attribute-keys, .attribute-comment) .nodeLabel { color: ${BLACK}; }
.nodeLabel { font-weight: 600; }
.state-start { stroke: ${OUTLINE} !important; stroke-width: ${stroke}px; }
/* The end state's inner dot is a node path too, so the fill cycle would paint it the colour of its ring. */
.node[id*="_end-"] g:not(.outer-path) > path:first-child { fill: ${OUTLINE}; }
.flowchart-link, .edgePath > path, .transition, .messageLine0, .messageLine1, .relationshipLine { stroke-width: ${edge}px; }
.actor-line { stroke-width: 2px; stroke-dasharray: 6 4; }
.loopLine { stroke: ${line}; stroke-width: 2px; }
.edgeLabel, .edgeLabel p, .edgeLabel span, .labelBkg { background-color: ${canvas}; color: ${label}; font-weight: 600; }
.edgeLabel p { margin: 0; padding: 0 4px; border-radius: 4px; }
:is(.activeText0, .activeText1, .activeText2, .activeText3) { fill: ${activeTaskText} !important; }
`;
}

/** Both halves of the Mermaid theme for `mode`. */
export function resolveMermaidStyle(theme: ThemeConfig, mode: ThemeMode): MermaidStyle {
  const themeVariables = resolveMermaidThemeVariables(theme, mode);
  return { themeVariables, themeCSS: themeCSS(theme, mode, themeVariables) };
}
