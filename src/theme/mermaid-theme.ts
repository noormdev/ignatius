import { blendHex } from '../app/logic/color';
import { semanticColors, type ThemeConfig, type ThemeMode } from './theme-defaults';

/** `theme.mermaid` in ignatius.yml: Mermaid `themeVariables` per mode, using Mermaid's own key names. */
export type MermaidThemeConfig = {
  dark?: Record<string, string | number>;
  light?: Record<string, string | number>;
};

export type MermaidThemeVariables = Record<string, string | number | Record<string, string | number>>;

/** Keep in step with `body` in src/app/styles.css. */
const BODY_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const WHITE = '#ffffff';

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

/** Mermaid themeVariables for `mode`: palette-derived defaults for every diagram family (Mermaid fills
 *  an unnamed family with colours that ignore the theme), overridden by `theme.mermaid[mode]`. */
export function resolveMermaidThemeVariables(theme: ThemeConfig, mode: ThemeMode): MermaidThemeVariables {
  const p = theme[mode];
  const sc = semanticColors[mode];
  const ink = p.text;
  const inkSoft = p.textMuted;
  const surface = p.surface;
  const paper = p.background;
  const sunk = blendHex(p.surface, p.background, 0.5);
  // The palette border is tuned for cards on a page and goes faint around small shapes.
  const border = blendHex(p.border, p.textMuted, 0.35);
  const line = p.textMuted;
  const accent = sc.dependent.fg;
  const note = sc.dependent;

  const series = [sc.independent.bg, sc.dependent.bg, sc.classifier.bg, sc.subtype.bg, sc.associative.bg, sc.link];
  const fillAt = (i: number) => series[i % series.length] ?? surface;
  const labelOn = (fill: string) => (contrastRatio(ink, fill) >= contrastRatio(WHITE, fill) ? ink : WHITE);

  const vars: MermaidThemeVariables = {
    fontFamily: BODY_FONT,
    fontSize: '14px',
    background: paper,
    // Nodes read mainBkg/nodeBorder/nodeTextColor, which Mermaid derives from these three;
    // naming them too would stop an override of these from reaching the nodes.
    primaryColor: surface,
    primaryTextColor: ink,
    primaryBorderColor: border,
    secondaryColor: sunk,
    secondaryTextColor: ink,
    secondaryBorderColor: border,
    tertiaryColor: sunk,
    tertiaryTextColor: ink,
    tertiaryBorderColor: border,
    lineColor: line,
    arrowheadColor: line,
    textColor: ink,
    titleColor: ink,
    edgeLabelBackground: surface,
    clusterBkg: paper,
    clusterBorder: border,
    // Mermaid's default is a light grey shadow, a smudge on a dark surface.
    dropShadow: 'none',
    errorBkgColor: sc.associative.bg,
    errorTextColor: sc.associative.fg,

    actorBkg: surface,
    actorBorder: border,
    actorTextColor: ink,
    actorLineColor: line,
    signalColor: ink,
    signalTextColor: ink,
    labelBoxBkgColor: sunk,
    labelBoxBorderColor: border,
    labelTextColor: ink,
    loopTextColor: ink,
    noteBkgColor: note.bg,
    noteBorderColor: note.fg,
    noteTextColor: note.fg,
    activationBkgColor: sunk,
    activationBorderColor: border,
    sequenceNumberColor: labelOn(line),

    stateBkg: surface,
    stateLabelColor: ink,
    labelColor: ink,
    altBackground: sunk,
    compositeBackground: paper,
    compositeTitleBackground: sunk,
    compositeBorder: border,
    transitionColor: line,
    transitionLabelColor: ink,
    specialStateColor: inkSoft,
    innerEndBackground: inkSoft,

    classText: ink,
    relationColor: line,
    relationLabelColor: ink,
    relationLabelBackground: surface,
    requirementBackground: surface,
    requirementBorderColor: border,
    requirementTextColor: ink,

    rowOdd: surface,
    rowEven: sunk,
    attributeBackgroundColorOdd: surface,
    attributeBackgroundColorEven: sunk,

    // Text on a gantt bar takes the label colour for the bar's fill; text beside a bar takes the page ink.
    sectionBkgColor: sunk,
    altSectionBkgColor: paper,
    sectionBkgColor2: sunk,
    gridColor: border,
    taskBkgColor: fillAt(0),
    taskBorderColor: border,
    taskTextColor: labelOn(fillAt(0)),
    taskTextLightColor: labelOn(fillAt(0)),
    taskTextDarkColor: labelOn(fillAt(0)),
    taskTextOutsideColor: ink,
    taskTextClickableColor: sc.link,
    activeTaskBkgColor: fillAt(1),
    activeTaskBorderColor: accent,
    doneTaskBkgColor: sunk,
    doneTaskBorderColor: border,
    critBkgColor: fillAt(4),
    critBorderColor: sc.associative.fg,
    todayLineColor: accent,
    vertLineColor: accent,

    pieTitleTextColor: ink,
    pieSectionTextColor: labelOn(fillAt(0)),
    pieLegendTextColor: ink,
    pieStrokeColor: paper,
    pieOuterStrokeColor: border,
    quadrant1Fill: surface,
    quadrant2Fill: sunk,
    quadrant3Fill: surface,
    quadrant4Fill: sunk,
    quadrant1TextFill: ink,
    quadrant2TextFill: ink,
    quadrant3TextFill: ink,
    quadrant4TextFill: ink,
    quadrantPointFill: sc.link,
    quadrantPointTextFill: ink,
    quadrantXAxisTextFill: inkSoft,
    quadrantYAxisTextFill: inkSoft,
    quadrantInternalBorderStrokeFill: border,
    quadrantExternalBorderStrokeFill: border,
    quadrantTitleFill: ink,

    commitLabelColor: ink,
    commitLabelBackground: sunk,
    tagLabelColor: note.fg,
    tagLabelBackground: note.bg,
    tagLabelBorder: note.fg,

    // xychart reads a nested object rather than flat keys. Sankey takes only
    // textColor from the theme; its node fills come from Mermaid's sankey config.
    xyChart: {
      backgroundColor: paper,
      titleColor: ink,
      xAxisLabelColor: ink,
      xAxisTitleColor: ink,
      xAxisTickColor: border,
      xAxisLineColor: border,
      yAxisLabelColor: ink,
      yAxisTitleColor: ink,
      yAxisTickColor: border,
      yAxisLineColor: border,
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
