import cytoscape from 'cytoscape';
import type { ThemeConfig, ThemeMode } from '../../../theme/theme-defaults';
import type { GroupConfig } from '../../../model/parse';
import { blendHex, pastel, lighten } from '../../logic/color';

export function buildStyles(groups: Record<string, GroupConfig>, theme: ThemeConfig, mode: ThemeMode): cytoscape.Stylesheet[] {
  const p = mode === 'light' ? theme.light : theme.dark;
  const defaultNodeBg = pastel(p.textMuted, p.background, p.pastelMix);

  const base: cytoscape.Stylesheet[] = [
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'background-color': defaultNodeBg,
        'color': p.text,
        'border-width': 2,
        'border-color': p.textMuted,
        'shape': 'round-rectangle',
        // Size each box to its (wrapped) label so long names stay compact and
        // the text never overflows the border. text-max-width is a safety net
        // for the rare single long word with no break opportunity.
        'width': 'label',
        'height': 'label',
        'text-wrap': 'wrap',
        'text-max-width': 150 as unknown as string,
        'padding': '9px' as unknown as number,
        'font-size': 11,
        'font-weight': 600,
        'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      },
    },
    {
      selector: 'node[classification = "Independent"], node[classification = "Classifier"]',
      style: { 'shape': 'rectangle' },
    },
    {
      selector: 'node[cluster = "true"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': 'transparent',
        'background-opacity': 0,
        'border-width': 1,
        'border-color': blendHex(p.background, p.surface, 0.5),
        'border-opacity': 0.4,
        'padding': '10px' as unknown as number,
        'label': '',
      },
    },
    {
      selector: 'node[joiner = "true"]',
      style: {
        'shape': 'diamond',
        'width': 20,
        'height': 20,
        // Fixed-size discriminator marker — must not inherit the entity nodes'
        // label padding, or the diamond balloons out.
        'padding': 0,
        'background-color': p.background,
        'border-color': p.edgeIdentifying,
        'border-width': 2,
        'font-size': 10,
        'font-weight': 700,
        'color': p.edgeIdentifying,
        'text-valign': 'center',
        'text-halign': 'center',
      },
    },
    {
      selector: 'edge[subtypeEdge = "true"]',
      style: {
        'line-style': 'solid',
        'width': 1.5,
        'line-color': p.edgeIdentifying,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 3,
        'overlay-opacity': 0.08,
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 1.5,
        'line-color': p.edgeIdentifying,
        // Background-coloured casing under each edge: where edges cross, the
        // later-drawn edge's outline masks the line beneath, giving an over/under
        // read (matches the DFD edge casing). Outline colour = canvas background,
        // so it's invisible except at crossings.
        'line-outline-width': 3,
        'line-outline-color': p.background,
        'target-arrow-shape': 'none',
        'source-arrow-shape': 'none',
        'curve-style': 'bezier',
        'label': 'data(edgeLabel)',
        'font-size': 10,
        'color': p.textMuted,
        'text-rotation': 'autorotate',
        'text-margin-y': -10,
        'arrow-scale': 1.2,
        'text-background-color': p.background,
        'text-background-opacity': 0.95,
        'text-background-padding': '4px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: 'edge[identifying = "true"]',
      style: {
        'line-style': 'solid',
        'width': 2,
        'line-color': p.edgeIdentifying,
      },
    },
    {
      selector: 'edge[identifying = "false"]',
      style: {
        'line-style': 'dashed',
        'line-color': p.edgeReferential,
        'width': 1.2,
      },
    },
  ];

  for (const [name, cfg] of Object.entries(groups)) {
    base.push({
      selector: `node[group = "${name}"]`,
      style: {
        'border-color': cfg.color,
        'background-color': pastel(cfg.color, p.background, p.pastelMix),
      },
    });
    base.push({
      selector: `node[group = "${name}"]:selected`,
      style: { 'border-color': lighten(cfg.color) },
    });
  }

  base.push({
    selector: '.faded',
    style: { 'opacity': 0.3 },
  });

  base.push({
    selector: 'node.hover-focus',
    style: { 'border-width': 3 },
  });

  return base;
}
