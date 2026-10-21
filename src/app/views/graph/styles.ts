import cytoscape from 'cytoscape';
import type { ThemeConfig, ThemeMode } from '../../../theme/theme-defaults';
import { semanticColors } from '../../../theme/theme-defaults';
import type { GroupConfig } from '../../../model/parse';
import { blendHex, pastel, lighten } from '../../logic/color';
import { SPOTLIGHT_LINE_INHERITED } from '../../dom/theme-css-vars';
import { EDGE_GLOW_SCALE, GLOW_STEADY, TIER_OPACITY, UNEXPLAINED_STEADY_MIX, glowColors } from './change-glow';
import { USER_HIDDEN_CLASS } from './graph-edits';

/**
 * Graph search match border (graph-flow-search CP2). Distinct gold/yellow so
 * it never reads as the amber "spotlight-line-out" lineage color or a group's
 * border color — mirrors the Dictionary view's `--dd-search-highlight` yellow
 * so "search" reads as the same visual language across surfaces.
 */
const SEARCH_MATCH_BORDER: Record<ThemeMode, string> = {
  dark: '#fde047',
  light: '#ca8a04',
};

const REMOVED_EDGE_OPACITY = 0.5;

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
        // Hide predicate labels when zoomed out — at fit-to-screen the text of
        // every edge overlaps into unreadable noise over dense hubs. Cytoscape
        // drops a label once its on-screen font would fall below this, so the
        // labels reappear as the user zooms in to read a specific relationship.
        'min-zoomed-font-size': 14,
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
    // Length-graded de-emphasis (data set by gradeEdgeSpans after layout).
    // Long-haul wires say "these domains are related" — at overview they must
    // not carry the same ink as a local FK, or the model reads as spaghetti.
    // They stay hoverable/selectable and regain presence as you follow them.
    // Placed AFTER the identifying rules so the grading wins the cascade.
    {
      selector: 'edge[span = "mid"]',
      style: { 'opacity': 0.5 },
    },
    {
      selector: 'edge[span = "far"]',
      style: { 'opacity': 0.22, 'width': 1, 'z-index': -1 },
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

  // After the per-group rules so the ring wins over a group's border colour; a
  // lightened border alone vanished at overview zoom.
  base.push({
    selector: 'node:selected',
    style: {
      'outline-width': 3,
      'outline-color': semanticColors[mode].link,
      'outline-offset': 3,
      'outline-opacity': 1,
      'overlay-opacity': 0,
    },
  });

  // Node glows are drawn by createChangeGlow on a canvas behind cytoscape; edge
  // glows are steady underlays here, which createChangeGlow pulses.
  const glow = glowColors(theme, mode);
  for (const change of ['added', 'changed', 'removed'] as const) {
    const unexplainedColor = blendHex(glow[change], glow.unexplained, UNEXPLAINED_STEADY_MIX);
    base.push(
      { selector: `edge[change = "${change}"]`, style: { 'underlay-color': glow[change] } },
      { selector: `edge[change = "${change}"][unexplained = "true"]`, style: { 'underlay-color': unexplainedColor } },
    );
  }
  base.push(
    {
      selector: 'edge[change]',
      style: { 'underlay-opacity': GLOW_STEADY * EDGE_GLOW_SCALE, 'underlay-padding': 3 },
    },
    {
      selector: 'node[change = "removed"]',
      style: { 'border-style': 'dashed', 'opacity': 0.45 },
    },
    {
      selector: 'edge[change = "added"]',
      style: { 'line-color': glow.added, 'width': 2.5, 'opacity': 1 },
    },
    {
      selector: 'edge[change = "changed"]',
      style: { 'line-color': glow.changed, 'width': 2.5, 'opacity': 1 },
    },
    {
      selector: 'edge[change = "removed"]',
      style: {
        'line-style': 'dashed',
        'line-color': p.textMuted,
        'opacity': REMOVED_EDGE_OPACITY,
        'underlay-opacity': GLOW_STEADY * EDGE_GLOW_SCALE * REMOVED_EDGE_OPACITY,
      },
    },
  );

  // Three-tier focus opacity (key-inheritance-lineage refinement). When an
  // entity is focused (selected or hovered), elements split into three visual
  // tiers so the inherited/ancestral set reads as a distinct middle layer:
  //   • Direct   — focused node + real graph neighbors + connecting edges →
  //                full opacity (no class), unchanged.
  //   • Inherited — inherited identity-group nodes (the dotted-ray targets) →
  //                `inherited-dim` at 0.5. Sits between direct and unrelated.
  //   • Unrelated — everything else → `faded` at 0.2.
  // The `edge.inherited` ray style below carries its own 0.5 opacity so the
  // dotted rays match their (0.5) target nodes.
  base.push({
    selector: '.faded',
    style: { 'opacity': TIER_OPACITY['faded'] },
  });

  base.push({
    selector: '.inherited-dim',
    style: { 'opacity': TIER_OPACITY['inherited-dim'] },
  });

  base.push({
    selector: 'node.hover-focus',
    style: { 'border-width': 3 },
  });

  // Inherited 1:1 key-inheritance lines (key-inheritance-lineage CP-B). These
  // are EPHEMERAL edges added on entity select, never part of the model — they
  // mirror the DD spotlight's dotted "inferred-upstream" connections. Dotted,
  // green (matching the DD's --spotlight-line-inherited exactly), thinner and
  // arrowless so they never read as a direct FK (solid amber/teal) edge.
  base.push({
    selector: 'edge.inherited',
    style: {
      'line-style': 'dotted',
      'line-color': SPOTLIGHT_LINE_INHERITED[mode],
      'line-outline-width': 0,
      'width': 1.2,
      'target-arrow-shape': 'none',
      'source-arrow-shape': 'none',
      'curve-style': 'bezier',
      'label': '',
      // Inherited/ancestral tier (3-tier focus opacity): the dotted rays sit at
      // 0.5 — between the full-opacity direct edges and the 0.2 unrelated set —
      // matching their inherited target nodes (`.inherited-dim`).
      'opacity': 0.5,
      'z-index': 1,
    },
  });

  // Graph search (graph-flow-search CP2). Dedicated classes — distinct from
  // the hover-tier classes above — so `clearFocusTiers` never strips active
  // search dimming. Pushed LAST so they win the cascade over the span-graded
  // edge opacity (`edge[span=...]`, declared early in `base`) and the
  // per-group border-color rules, matching the precedence the file already
  // gives `.faded`/`.inherited-dim` over span grading.
  base.push({
    selector: '.search-dim',
    style: { 'opacity': TIER_OPACITY['search-dim'] },
  });

  base.push({
    selector: 'node.search-match',
    style: {
      'border-width': 3,
      'border-color': SEARCH_MATCH_BORDER[mode],
    },
  });

  // Steady edge-glow counterpart of createChangeGlow's opacity scaling.
  for (const [tier, opacity] of Object.entries(TIER_OPACITY)) {
    base.push({ selector: `edge[change].${tier}`, style: { 'underlay-opacity': GLOW_STEADY * EDGE_GLOW_SCALE * opacity } });
  }

  // Tree layout: GraphView sets each routed edge's bends; a tree line's
  // predicate rides its run into the child, a cross link's sits mid-street.
  base.push(
    {
      selector: 'edge.tree-edge',
      style: {
        'curve-style': 'segments',
        'edge-distances': 'node-position',
        'label': '',
        'target-label': 'data(edgeLabel)',
        'target-text-margin-y': -9,
        'target-text-rotation': 'none',
      },
    },
    {
      selector: 'edge.tree-label-source',
      style: {
        'target-label': '',
        'source-label': 'data(edgeLabel)',
        'source-text-margin-y': -9,
        'source-text-rotation': 'none',
      },
    },
    {
      selector: 'edge.tree-cross',
      style: {
        'curve-style': 'segments',
        'edge-distances': 'node-position',
        'text-rotation': 'none',
        // The street runs just under the parent: the label sits on it, not above it.
        'text-margin-y': 0,
        'text-background-padding': '2px',
      },
    },
  );

  // A node the user removed from view; cytoscape hides its edges with it.
  base.push({ selector: `node.${USER_HIDDEN_CLASS}`, style: { 'display': 'none' } });

  return base;
}
