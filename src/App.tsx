import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
import cytoscapeNavigator from 'cytoscape-navigator';
import 'cytoscape-navigator/cytoscape.js-navigator.css';
import { createMarkerOverlay, updateMarkers, drawWarningBadges } from './markers';
import { semanticColors, type ThemeConfig, type ThemeMode } from './theme-defaults';
import { parseHash, serializeHash, type HashState } from './hash-router';
import { validateModel, RULES } from './validate';
import type { EntityError, GlobalError } from './validate';
import { wrapEntityLabel } from './wrap-label';
import { createLayoutStore } from './layout-store';
import type {
  Model,
  ModelNode,
  ModelEdge,
  SubtypeCluster,
  GroupConfig,
} from './parse';

// @ts-expect-error — cytoscape uses `export =` which loses namespace members under bundler resolution
cytoscape.use(elk);

// Graph layout algorithm, toggled at runtime from the FAB menu.
// 'hierarchical' → ELK layered (ranked rows); 'organic' → ELK stress (force-directed).
type LayoutMode = 'hierarchical' | 'organic';

// Place each subtype cluster's members on an arc around their joiner diamond,
// fanning away from the basetype. Keeps basetype/subtype clusters cohesive under
// the organic (stress) layout, which otherwise treats identifying joiner→member
// edges like any other and flings members across the canvas.
//
// Size-aware: neighbour spacing clears the largest member's footprint, so
// multi-line boxes and many-member clusters never collide on the arc. The span
// widens with member count — small clusters stay a tight fan, large ones wrap
// toward a near-full ring (capped just under 2π so the base side stays open).
function fanSubtypeClusters(cy: cytoscape.Core) {
  cy.nodes('[joiner = "true"]').forEach((j) => {
    const jp = j.position();
    const members = cy.edges().filter((e) => e.source().id() === j.id()).map((e) => e.target());
    if (members.length === 0) return;
    const inEdge = cy.edges().filter((e) => e.target().id() === j.id())[0];
    const base = inEdge ? inEdge.source() : null;
    // Fan outward, away from the basetype, so the diamond sits between base and members.
    let baseAngle = Math.PI / 2;
    if (base) {
      const bp = base.position();
      baseAngle = Math.atan2(jp.y - bp.y, jp.x - bp.x);
    }
    const n = members.length;
    const slot = Math.max(...members.map((m) => Math.max(m.outerWidth(), m.outerHeight()))) + 26;
    const span = Math.min(2 * Math.PI * (n / (n + 1)), 0.9 + n * 0.42);
    const gap = span / Math.max(1, n - 1);
    // Radius so the chord between neighbours clears a slot: chord = 2R·sin(gap/2).
    const radius = Math.max(120, slot / 2 / Math.sin(Math.min(Math.PI / 2, gap / 2) || 1));
    members.forEach((m, i) => {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      const angle = baseAngle + t * span;
      m.position({ x: jp.x + radius * Math.cos(angle), y: jp.y + radius * Math.sin(angle) });
    });
  });
}

// Light separating-axis pass to clear residual node overlaps left when two
// nearby clusters' fans land on top of each other. Nudges only overlapping pairs
// apart along their axis of least penetration; converges fast (breaks once a
// pass moves nothing). Skips compound parents (invisible cluster boxes).
function deoverlapNodes(cy: cytoscape.Core, iterations: number) {
  const nodes = cy.nodes().filter((n) => !n.isParent());
  const pad = 30;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const A = nodes[a];
        const B = nodes[b];
        const pa = A.position();
        const pb = B.position();
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const minX = (A.outerWidth() + B.outerWidth()) / 2 + pad;
        const minY = (A.outerHeight() + B.outerHeight()) / 2 + pad;
        if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
          const overlapX = minX - Math.abs(dx);
          const overlapY = minY - Math.abs(dy);
          if (overlapX < overlapY) {
            const shift = ((dx < 0 ? -1 : 1) * overlapX) / 2;
            A.position({ x: pa.x - shift, y: pa.y });
            B.position({ x: pb.x + shift, y: pb.y });
          } else {
            const shift = ((dy < 0 ? -1 : 1) * overlapY) / 2;
            A.position({ x: pa.x, y: pa.y - shift });
            B.position({ x: pb.x, y: pb.y + shift });
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// Push whole subtype-cluster fans (joiner + members) apart so interleaved
// clusters settle into distinct regions, not merely un-overlapped. Works on each
// fan's bounding box; the per-node de-overlap that follows cleans up the
// node-level collisions a coarse shove can introduce.
function separateClusterFans(cy: cytoscape.Core, iterations: number) {
  const fans = cy.nodes('[joiner = "true"]').map((j) => j.outgoers('node').union(j)).filter((fan) => fan.length > 1);
  if (fans.length < 2) return;
  const margin = 45;
  const shiftFan = (fan, dx: number, dy: number) =>
    fan.forEach((n) => { const p = n.position(); n.position({ x: p.x + dx, y: p.y + dy }); });
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let a = 0; a < fans.length; a++) {
      for (let b = a + 1; b < fans.length; b++) {
        const ba = fans[a].boundingBox();
        const bb = fans[b].boundingBox();
        const overlapX = Math.min(ba.x2, bb.x2) - Math.max(ba.x1, bb.x1) + margin;
        const overlapY = Math.min(ba.y2, bb.y2) - Math.max(ba.y1, bb.y1) + margin;
        if (overlapX > 0 && overlapY > 0) {
          const aLeftOfB = ba.x1 + ba.x2 < bb.x1 + bb.x2;
          const aAboveB = ba.y1 + ba.y2 < bb.y1 + bb.y2;
          // Separate along the axis of least penetration (smaller move).
          if (overlapX < overlapY) {
            const s = overlapX / 2;
            shiftFan(fans[a], aLeftOfB ? -s : s, 0);
            shiftFan(fans[b], aLeftOfB ? s : -s, 0);
          } else {
            const s = overlapY / 2;
            shiftFan(fans[a], 0, aAboveB ? -s : s);
            shiftFan(fans[b], 0, aAboveB ? s : -s);
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// Spread a hub's degree-1 satellites angularly so their edges stop smearing into
// one line. Each leaf is repelled — in angle, around its hub — by every other
// neighbour edge until it clears a minimum gap; distance from the hub is kept,
// so this is a pure rotation that never changes how far a leaf sits.
function separateLeafFan(cy: cytoscape.Core, iterations: number) {
  const minGap = 0.42;
  const step = 0.5;
  const movable = (n) => n.parent().empty() && n.data('joiner') !== 'true';
  const isLeaf = (n) => n.degree(false) === 1 && movable(n);
  for (let it = 0; it < iterations; it++) {
    cy.nodes().forEach((h) => {
      if (!movable(h)) return;
      const nbrs = h.openNeighborhood().nodes();
      if (nbrs.length < 2) return;
      const hp = h.position();
      const entries = nbrs.map((nb) => ({ nb, ang: Math.atan2(nb.position().y - hp.y, nb.position().x - hp.x), leaf: isLeaf(nb) }));
      entries.forEach((e) => {
        if (!e.leaf) return;
        let push = 0;
        entries.forEach((o) => {
          if (o === e) return;
          let d = e.ang - o.ang;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          if (Math.abs(d) < minGap) push += (d >= 0 ? 1 : -1) * (minGap - Math.abs(d));
        });
        if (push !== 0) {
          const p = e.nb.position();
          const dist = Math.hypot(p.x - hp.x, p.y - hp.y);
          const a = e.ang + push * step;
          e.nb.position({ x: hp.x + dist * Math.cos(a), y: hp.y + dist * Math.sin(a) });
        }
      });
    });
  }
}

// Triangulate a degree-2 pass-through node that sits on the line between its two
// neighbours: nudge it perpendicular off the line so its two edges stop
// overlapping into one. Only fires when the node is between the neighbours
// (projection within the segment) and closer to the line than the clearance.
function decollinearNodes(cy: cytoscape.Core) {
  const clearance = 80;
  cy.nodes().forEach((n) => {
    if (n.data('joiner') === 'true' || !n.parent().empty() || n.degree(false) !== 2) return;
    const nb = n.openNeighborhood().nodes();
    if (nb.length !== 2) return;
    const A = nb[0].position(), B = nb[1].position(), P = n.position();
    const abx = B.x - A.x, aby = B.y - A.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1) return;
    const t = ((P.x - A.x) * abx + (P.y - A.y) * aby) / len2;
    if (t < 0.15 || t > 0.85) return;
    const projx = A.x + t * abx, projy = A.y + t * aby;
    const perpx = P.x - projx, perpy = P.y - projy;
    const perpDist = Math.hypot(perpx, perpy);
    if (perpDist >= clearance) return;
    const len = Math.sqrt(len2);
    const ux = perpDist > 1 ? perpx / perpDist : -aby / len;
    const uy = perpDist > 1 ? perpy / perpDist : abx / len;
    n.position({ x: projx + ux * clearance, y: projy + uy * clearance });
  });
}

// Post-process a settled organic (stress) layout: fan subtype clusters into tidy
// rings, pull interleaved fans into distinct regions, spread hub satellites,
// triangulate collinear pass-throughs, then clear residual node overlaps.
function arrangeOrganic(cy: cytoscape.Core) {
  fanSubtypeClusters(cy);
  separateClusterFans(cy, 80);
  separateLeafFan(cy, 80);
  decollinearNodes(cy);
  deoverlapNodes(cy, 90);
}
// @ts-expect-error — same interop gap; .use() exists at runtime
cytoscape.use(cytoscapeNavigator);

type NavigatorInstance = {
  destroy: () => void;
  _onRenderHandler?: { cancel?: () => void };
};

function mountNavigator(cy: cytoscape.Core): NavigatorInstance {
  // The plugin only honors `container` as a string selector ('#id' or '.class').
  // Passing an HTMLElement falls through to `document.body.appendChild` of its own
  // div — see cytoscape-navigator.js:378-389. Use the id selector path.
  const nav = (cy as cytoscape.Core & {
    navigator: (opts: Record<string, unknown>) => NavigatorInstance;
  }).navigator({
    container: '#minimap-panel',
    viewLiveFramerate: 0,
    rerenderDelay: 100,
    removeCustomContainer: false,
  });
  // The plugin only generates the thumbnail on cy.onRender events. After
  // layoutstop the graph is idle so no render fires; force one so the
  // initial thumbnail paints.
  (cy as cytoscape.Core & { resize: () => void; trigger: (e: string) => void }).resize();
  (cy as cytoscape.Core & { resize: () => void; trigger: (e: string) => void }).trigger('render');
  return nav;
}

function teardownNavigator(nav: NavigatorInstance, container: HTMLElement) {
  // Cancel the throttled render handler's pending trailing setTimeout BEFORE
  // nav.destroy() — otherwise the tick can fire after cy.destroy() nulls
  // the renderer and throw "Cannot read properties of null (reading 'png')".
  nav._onRenderHandler?.cancel?.();
  nav.destroy();
  while (container.firstChild) container.removeChild(container.firstChild);
}

declare global {
  interface Window {
    __MODEL__?: Model;
    __THEME_MODE__?: 'dark' | 'light';
    __IGNATIUS_MODE__?: 'live' | 'static';
    __LAYOUT_KEY__?: string;
    // Debug/test seam: the live Cytoscape core, exposed for the visual harness
    // to locate nodes and drive hover. Not read by application code.
    __IGNATIUS_CY__?: cytoscape.Core;
  }
}

function applyThemeCssVars(theme: ThemeConfig, mode: ThemeMode) {
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
}

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

function pastel(hex: string, bgHex: string, mix: number): string {
  const bgR = parseInt(bgHex.slice(1, 3), 16);
  const bgG = parseInt(bgHex.slice(3, 5), 16);
  const bgB = parseInt(bgHex.slice(5, 7), 16);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const pr = Math.round(bgR * (1 - mix) + r * mix);
  const pg = Math.round(bgG * (1 - mix) + g * mix);
  const pb = Math.round(bgB * (1 - mix) + b * mix);
  return `#${pr.toString(16).padStart(2, '0')}${pg.toString(16).padStart(2, '0')}${pb.toString(16).padStart(2, '0')}`;
}

function lighten(hex: string): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + 60);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + 60);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + 60);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildStyles(groups: Record<string, GroupConfig>, theme: ThemeConfig, mode: ThemeMode): cytoscape.Stylesheet[] {
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

function SelectedEntityModal({ selected, model, entityErrors, onClose, onNavigate }: {
  selected: ModelNode;
  model: Model | null;
  entityErrors: EntityError[];
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const groups = model?.groups ?? {};
  const edges = model?.edges ?? [];
  const nodes = model?.nodes ?? [];
  const groupCfg = selected.group ? groups[selected.group] : undefined;
  const errorsForSelected = entityErrors.filter(e => e.entityId === selected.id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <div className="modal-header">
          <h1>{selected.id.replace(/_/g, ' ')}</h1>
          <div className="modal-badges">
            <span className={`badge ${selected.classification.toLowerCase()}`}>
              {selected.classification}
            </span>
            {groupCfg && (
              <span
                className="badge"
                style={{
                  background: hexToRgba(groupCfg.color, 0.2),
                  color: groupCfg.color,
                }}
              >
                {groupCfg.label}
              </span>
            )}
            <span className="pk-label">
              PK: {selected.pk.join(', ')}
            </span>
          </div>
        </div>
        <ColumnsTable
          node={selected}
          edges={edges}
          onNavigate={(id) => {
            const target = nodes.find(n => n.id === id);
            if (target) onNavigate(id);
          }}
        />
        <div
          className="doc-body"
          onClick={(e) => {
            // Body HTML is injected, so its `[[…]]` anchors can't carry React
            // handlers — delegate: intercept clicks on entity links and route
            // them through the same navigation the FK links use.
            const el = e.target;
            if (!(el instanceof Element)) return;
            const link = el.closest('a[data-entity]');
            if (!link) return;
            e.preventDefault();
            const id = link.getAttribute('data-entity');
            if (id && nodes.some(n => n.id === id)) onNavigate(id);
          }}
          dangerouslySetInnerHTML={{ __html: selected.bodyHtml }}
        />
        <ChildrenTable
          node={selected}
          edges={edges}
          onNavigate={(id) => {
            const target = nodes.find(n => n.id === id);
            if (target) onNavigate(id);
          }}
        />
        {errorsForSelected.length > 0 && (
          <div className="graph-modal-issues-section">
            <h4>Issues</h4>
            <ul>
              {errorsForSelected.map(err => (
                <li key={err.ruleId}>
                  <strong>{RULES[err.ruleId]?.title ?? err.ruleId}</strong>: {err.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ExamplesAccordion node={selected} />
      </div>
    </div>
  );
}

function ColumnsTable({ node, edges, onNavigate }: {
  node: ModelNode;
  edges: ModelEdge[];
  onNavigate: (entityId: string) => void;
}) {
  const fkTargets: Record<string, string> = {};
  for (const edge of edges) {
    if (edge.source === node.id) {
      for (const childCol of Object.keys(edge.on)) {
        fkTargets[childCol] = edge.target;
      }
    }
  }

  const cols = Object.entries(node.columns);
  if (cols.length === 0) return null;

  function renderRoles(name: string) {
    const parts: (string | JSX.Element)[] = [];
    if (node.pk.includes(name)) parts.push('PK');
    if (fkTargets[name]) {
      const target = fkTargets[name];
      parts.push(
        <span key="fk">
          FK →{' '}
          <a className="fk-link" onClick={() => onNavigate(target)}>
            {target}
          </a>
        </span>
      );
    }
    for (const ak of node.alternateKeys) {
      if (ak.columns.includes(name)) parts.push('AK');
    }
    if (parts.length === 0) return '—';
    return parts.map((p, i) => (
      <span key={i}>{i > 0 ? ', ' : ''}{p}</span>
    ));
  }

  return (
    <div className="doc-section">
      <h2>Attributes</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Type</th>
              <th>Key</th>
              <th>Null</th>
              <th>Default</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {cols.map(([name, col]) => (
              <tr key={name}>
                <td><code>{name}</code></td>
                <td>{col.type}</td>
                <td>{renderRoles(name)}</td>
                <td>{col.nullable ? 'Yes' : 'No'}</td>
                <td>{col.default ?? ''}</td>
                <td>{col.desc ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChildrenTable({ node, edges, onNavigate }: {
  node: ModelNode;
  edges: ModelEdge[];
  onNavigate: (entityId: string) => void;
}) {
  const children = edges.filter(e => e.target === node.id);
  if (children.length === 0) return null;

  return (
    <div className="doc-section">
      <h2>Relationships</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Child</th>
              <th>Type</th>
              <th>Predicate</th>
              <th>Cardinality</th>
            </tr>
          </thead>
          <tbody>
            {children.map(edge => (
              <tr key={edge.source}>
                <td>
                  <a className="fk-link" onClick={() => onNavigate(edge.source)}>
                    {edge.source}
                  </a>
                </td>
                <td>{edge.identifying ? 'Identifying' : 'Referential'}</td>
                <td>{edge.predicate.fwd}{edge.predicate.rev !== edge.predicate.fwd && <span className="predicate-rev">{edge.predicate.rev}</span>}</td>
                <td>{edge.cardinality.parent}:{edge.cardinality.child}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExamplesAccordion({ node }: { node: ModelNode }) {
  const examples = node.examples;
  if (!examples || examples.length === 0) return null;

  // Column order: PK first, then declared columns in declaration order.
  const pkSet: Record<string, true> = {};
  for (const k of node.pk) pkSet[k] = true;
  const declaredCols = Object.keys(node.columns).filter(k => !pkSet[k]);
  const headers = [...node.pk, ...declaredCols];

  const isOpen = examples.length <= 3;

  return (
    <details className="modal-examples doc-section" open={isOpen || undefined}>
      <summary>Examples ({examples.length})</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {headers.map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {examples.map((row, i) => (
              <tr key={i}>
                {headers.map(h => (
                  <td key={h}>
                    {row[h] !== undefined && row[h] !== null && row[h] !== ''
                      ? String(row[h])
                      : <span className="example-empty">–</span>
                    }
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// FindingsPanel — persistent top-right panel listing all current findings.
//
// Renders when totalFindings > 0; hidden when zero (no empty chrome).
// Each row is a <details> accordion; opening an entity-scoped row fires
// onNavigate so the graph viewport pans + zooms + selects that entity.
// Global-scoped rows expand inline only (no entity to navigate to).
// ---------------------------------------------------------------------------

type FindingRow =
  | { kind: 'entity'; ruleId: string; entityId: string; severity: 'warning'; message: string }
  | { kind: 'global'; ruleId: string; severity: 'error'; location: string; reason: string };

function buildFindingRows(
  globalErrors: GlobalError[],
  entityErrors: EntityError[],
): FindingRow[] {
  const rows: FindingRow[] = [
    ...globalErrors.map((e): FindingRow => ({
      kind: 'global',
      ruleId: e.ruleId,
      severity: 'error',
      location: `${e.omitted.kind}:${e.omitted.id}`,
      reason: e.reason,
    })),
    ...entityErrors.map((e): FindingRow => ({
      kind: 'entity',
      ruleId: e.ruleId,
      entityId: e.entityId,
      severity: 'warning',
      message: e.message,
    })),
  ];

  // Sort: errors before warnings, then ruleId alphabetical, then location/entityId.
  rows.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
    const aLoc = a.kind === 'entity' ? a.entityId : a.location;
    const bLoc = b.kind === 'entity' ? b.entityId : b.location;
    return aLoc.localeCompare(bLoc);
  });

  return rows;
}

function FindingsPanel({
  globalErrors,
  entityErrors,
  collapsed,
  onCollapse,
  onExpand,
  onNavigate,
}: {
  globalErrors: GlobalError[];
  entityErrors: EntityError[];
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onNavigate: (entityId: string) => void;
}) {
  const rows = buildFindingRows(globalErrors, entityErrors);
  const total = rows.length;

  if (total === 0) return null;

  if (collapsed) {
    return (
      <aside className="findings-panel findings-panel--collapsed">
        <button className="findings-panel-badge" onClick={onExpand}>
          ⚠ {total} {total === 1 ? 'issue' : 'issues'}
        </button>
      </aside>
    );
  }

  return (
    <aside className="findings-panel">
      <header className="findings-panel-header">
        <h3>Issues ({total})</h3>
        <button className="findings-panel-collapse" onClick={onCollapse} aria-label="Collapse panel">
          −
        </button>
      </header>
      <ul className="findings-panel-list">
        {rows.map((row, i) => {
          const rule = RULES[row.ruleId as keyof typeof RULES];
          const location = row.kind === 'entity' ? row.entityId : row.location;
          const detail = row.kind === 'entity' ? row.message : row.reason;

          return (
            <li key={i}>
              <details
                onToggle={(e) => {
                  // Only navigate on open (not on close).
                  if ((e.target as HTMLDetailsElement).open && row.kind === 'entity') {
                    onNavigate(row.entityId);
                  }
                }}
              >
                <summary className="finding-summary">
                  <span className={`finding-severity finding-severity--${row.severity}`}>
                    {row.severity === 'error' ? 'ERR' : 'WARN'}
                  </span>
                  <span className="finding-rule">{row.ruleId}</span>
                  <span className="finding-location">{location}</span>
                </summary>
                <div className="finding-detail">
                  {rule && (
                    <>
                      <strong className="finding-detail-title">{rule.title}</strong>
                      <p className="finding-detail-explanation">{rule.explanation}</p>
                    </>
                  )}
                  <p className="finding-detail-message">{detail}</p>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// The graph viewer renders IDEF1X notation: entity identity by corner shape,
// relationship dependency by line style, cardinality by crow's-foot end markers,
// and subtype completeness by the discriminator diamond. The legend reproduces
// each symbol with the same theme CSS vars the graph uses so it tracks the active
// palette. Geometry mirrors src/markers.ts (bars, hollow circle, fanning prongs).
function LegendModal({ onClose }: { onClose: () => void }) {
  const identifying = 'var(--color-edge-identifying)';
  const referential = 'var(--color-edge-referential)';
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal legend-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <div className="modal-header">
          <h1>Legend</h1>
        </div>

        <section className="legend-section">
          <h2 className="legend-section-title">Entities</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <span className="legend-entity legend-entity--independent" />
            </span>
            <span className="legend-text">
              <strong className="legend-term">Independent entity</strong>
              <span className="legend-desc">Sharp corners. Identified by its own attributes — its primary key holds no foreign keys.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <span className="legend-entity legend-entity--dependent" />
            </span>
            <span className="legend-text">
              <strong className="legend-term">Dependent entity</strong>
              <span className="legend-desc">Rounded corners. Its identity depends on a parent — the primary key inherits a foreign key.</span>
            </span>
          </div>
        </section>

        <section className="legend-section">
          <h2 className="legend-section-title">Relationships</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="60" height="20" viewBox="0 0 60 20">
                <line x1="2" y1="10" x2="58" y2="10" stroke={identifying} strokeWidth="2" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Identifying</strong>
              <span className="legend-desc">Solid line. The parent key migrates into the child's primary key — the child cannot exist without the parent.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="60" height="20" viewBox="0 0 60 20">
                <line x1="2" y1="10" x2="58" y2="10" stroke={referential} strokeWidth="1.4" strokeDasharray="5 4" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Non-identifying</strong>
              <span className="legend-desc">Dashed line. The parent key migrates into a non-key column — a plain reference.</span>
            </span>
          </div>
        </section>

        <section className="legend-section">
          <h2 className="legend-section-title">Cardinality</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="24" viewBox="0 0 64 24">
                <line x1="2" y1="12" x2="40" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="40" y1="2" x2="40" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="47" y1="2" x2="47" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Exactly one</strong>
              <span className="legend-desc">Two bars. Mandatory and singular — one and only one.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="24" viewBox="0 0 64 24">
                <line x1="2" y1="12" x2="36" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="36" y1="2" x2="36" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="49" cy="12" r="6" fill="var(--color-background)" stroke={identifying} strokeWidth="1.8" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Zero or one</strong>
              <span className="legend-desc">Bar and hollow circle. Optional and singular — at most one.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="24" viewBox="0 0 64 24">
                <line x1="2" y1="12" x2="34" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="34" y1="12" x2="54" y2="2" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="34" y1="12" x2="54" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="34" y1="12" x2="54" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Many</strong>
              <span className="legend-desc">Crow's foot. Many on this end — zero or more.</span>
            </span>
          </div>
        </section>

        <section className="legend-section">
          <h2 className="legend-section-title">Subtypes</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="28" viewBox="0 0 64 28">
                <line x1="2" y1="14" x2="20" y2="14" stroke={identifying} strokeWidth="1.5" />
                <polygon points="32,4 44,14 32,24 20,14" fill="var(--color-background)" stroke={identifying} strokeWidth="2" />
                <line x1="44" y1="14" x2="62" y2="14" stroke={identifying} strokeWidth="1.5" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Inclusive subtype</strong>
              <span className="legend-desc">Plain diamond. A supertype row may belong to several subtypes — categories can overlap.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="28" viewBox="0 0 64 28">
                <line x1="2" y1="14" x2="20" y2="14" stroke={identifying} strokeWidth="1.5" />
                <polygon points="32,4 44,14 32,24 20,14" fill="var(--color-background)" stroke={identifying} strokeWidth="2" />
                <text x="32" y="14" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" fill={identifying}>X</text>
                <line x1="44" y1="14" x2="62" y2="14" stroke={identifying} strokeWidth="1.5" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Exclusive subtype</strong>
              <span className="legend-desc">Diamond marked X. Each supertype row is exactly one of the subtypes — categories are mutually exclusive.</span>
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

export function App() {
  const graphRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [findings, setFindings] = useState<{
    globalErrors: GlobalError[];
    entityErrors: EntityError[];
  }>({ globalErrors: [], entityErrors: [] });
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [cyInitError, setCyInitError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ModelNode | null>(null);
  const [showEntityModal, setShowEntityModal] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(() => {
    return localStorage.getItem('ignatius-minimap') === 'true';
  });
  const [cyReady, setCyReady] = useState(false);
  const [copyConfirm, setCopyConfirm] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  // Set by the cytoscape useEffect; lets modal navigation update the hash
  // without re-entering the useEffect closure.
  const navigateToEntityRef = useRef<(id: string) => void>(() => {});
  function navigateToEntity(id: string) {
    navigateToEntityRef.current(id);
  }
  // Direct pan+zoom+select for the findings panel — bypasses hash roundtrip
  // so the viewport update is synchronous when a user clicks a panel row.
  const panelNavigateRef = useRef<(id: string) => void>(() => {});
  const menuRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  // Mirrors minimapOpen for the cy useEffect to read on mount without
  // adding minimapOpen to its dep array (which would rebuild the graph).
  const minimapOpenRef = useRef<boolean>(false);
  minimapOpenRef.current = minimapOpen;
  // Holds the active navigator instance so the runtime-toggle effect and
  // the cy effect's cleanup share a single source of truth.
  const navRef = useRef<NavigatorInstance | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (window.__THEME_MODE__) return window.__THEME_MODE__;
    const stored = localStorage.getItem('ignatius-theme');
    const initial: ThemeMode = stored === 'light' ? 'light' : 'dark';
    return initial;
  });
  // Ref so viewport/position listeners always read the current mode without needing cy rebuild
  const themeModeRef = useRef<ThemeMode>(themeMode);
  // Ref so drag-save and layoutstop-restore listeners always read the live
  // layoutKey (updated by SSE rebuilds) without forcing a graph rebuild.
  // Mirror of the themeModeRef / findingsRef pattern.
  const layoutKeyRef = useRef<string>('');
  // Set by the cy-init effect; lets the FAB "Reset layout" button clear the
  // saved arrangement and re-run ELK from outside the effect closure.
  const resetLayoutRef = useRef<(() => void) | null>(null);
  // Layout algorithm mode. 'hierarchical' = ELK layered (default ranked rows);
  // 'organic' = ELK stress (force-directed hub-and-spoke). Toggled from the FAB.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('hierarchical');
  // Ref mirror so the init + reset paths read the live mode without a graph rebuild.
  const layoutModeRef = useRef<LayoutMode>('hierarchical');
  layoutModeRef.current = layoutMode;
  // Set by the cy-init effect; re-runs the layout in a given mode from the FAB toggle.
  const applyLayoutModeRef = useRef<((mode: LayoutMode) => void) | null>(null);

  useEffect(() => {
    const mode = window.__IGNATIUS_MODE__;

    // Static mode: model baked in at generation time — run validateModel locally.
    // WHY: static graph.html embeds window.__MODEL__ at build time; the bundle
    // re-validates so a stale file still shows current findings.
    if (mode === 'static' && window.__MODEL__) {
      const rawModel = window.__MODEL__;
      const validation = validateModel(rawModel);
      setModel(validation.cleanedModel);
      setFindings({
        globalErrors: validation.globalErrors,
        entityErrors: validation.entityErrors,
      });
      // Static graph injects window.__LAYOUT_KEY__ beside window.__MODEL__.
      layoutKeyRef.current = window.__LAYOUT_KEY__ ?? '';
      return;
    }

    // Live mode: server computed validation — use its payload, do not re-validate.
    function applyPayload(payload: { model: Model; parseGlobalErrors: GlobalError[]; validation: { cleanedModel: Model; globalErrors: GlobalError[]; entityErrors: EntityError[] }; layoutKey?: string }) {
      const allGlobal = [...payload.parseGlobalErrors, ...payload.validation.globalErrors];
      setModel(payload.validation.cleanedModel);
      setFindings({
        globalErrors: allGlobal,
        entityErrors: payload.validation.entityErrors,
      });
      // Store the layoutKey from the server payload so the cy listeners (drag-save,
      // layoutstop-restore) always read the current key, including after SSE rebuilds.
      layoutKeyRef.current = payload.layoutKey ?? '';
    }

    fetch('/api/model').then(r => r.json()).then(applyPayload);

    const es = new EventSource('/events');
    es.addEventListener('model-changed', () => {
      fetch('/api/model')
        .then(r => r.json())
        .then((payload: Parameters<typeof applyPayload>[0]) => {
          applyPayload(payload);
          // Reset banner dismissal on fresh data (new findings may have appeared)
          setBannerDismissed(false);
          // Keep selected node in sync: update it from the new model, or clear if removed
          setSelected(prev => {
            if (!prev) return null;
            const updated = payload.validation.cleanedModel.nodes.find(n => n.id === prev.id);
            return updated ?? null;
          });
        });
    });

    return () => es.close();
  }, []);

  // Apply CSS custom properties whenever the theme or mode changes
  useEffect(() => {
    if (model) applyThemeCssVars(model.theme, themeMode);
  }, [model, themeMode]);

  // Keep ref in sync with state so viewport listeners see the current mode
  useEffect(() => {
    themeModeRef.current = themeMode;
  }, [themeMode]);

  // Re-apply Cytoscape styles when mode changes (without rebuilding the graph)
  useEffect(() => {
    if (!cyRef.current || !model || !svgRef.current) return;
    cyRef.current.style(buildStyles(model.groups, model.theme, themeMode));
    updateMarkers(cyRef.current, svgRef.current, model.theme, themeMode);
    const badgeIds = new Set(findings.entityErrors.map(e => e.entityId));
    drawWarningBadges(cyRef.current, svgRef.current, badgeIds);
  }, [themeMode]);

  // Toggle minimap at runtime WITHOUT rebuilding cy. The cy useEffect owns
  // the navigator's lifecycle whenever cy itself is being created/destroyed
  // — see its body for the mount-on-create + cleanup-before-cy.destroy()
  // path. This effect only handles the user-driven open/close after cy is
  // already alive.
  //
  // Why split? cytoscape-navigator's render is throttled; its trailing
  // setTimeout fires INDEPENDENTLY of cy's listener registry. If
  // nav.destroy() runs AFTER cy.destroy() — which is what happens in
  // StrictMode dev-double-invoke when two unrelated effects each manage
  // their own lifecycle — the trailing tick lands on a null renderer and
  // throws "Cannot read properties of null (reading 'png')". By making nav
  // teardown strictly nested inside cy teardown, the race is closed.
  useEffect(() => {
    if (!cyReady) return; // cy effect handles mount-time; ignore the readiness-flip itself.
    const cy = cyRef.current;
    const container = minimapRef.current;
    if (!cy || !container) return;

    if (minimapOpen && !navRef.current) {
      navRef.current = mountNavigator(cy);
    } else if (!minimapOpen && navRef.current) {
      teardownNavigator(navRef.current, container);
      navRef.current = null;
    }
  }, [minimapOpen, cyReady]);

  function toggleTheme() {
    const next: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
    localStorage.setItem('ignatius-theme', next);
    setThemeMode(next);
  }

  function toggleMinimapOpen() {
    const next = !minimapOpen;
    localStorage.setItem('ignatius-minimap', String(next));
    setMinimapOpen(next);
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopyConfirm(true);
      setMenuOpen(false);
      setTimeout(() => setCopyConfirm(false), 1500);
    });
  }

  // Close menu on outside click or Esc
  useEffect(() => {
    if (!menuOpen) return;

    function onMouseDown(e: MouseEvent) {
      if (!(e.target instanceof Node)) return;
      const fab = fabRef.current;
      const menu = menuRef.current;
      if (!fab || !menu) return;
      if (!fab.contains(e.target) && !menu.contains(e.target)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        fabRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  // ESC handler for the entity-detail modal.
  // Closes the modal only — does not clear selected (selection persists in hash).
  useEffect(() => {
    if (!showEntityModal) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setShowEntityModal(false);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showEntityModal]);

  // Ref so badge-drawing always sees current findings without adding findings to
  // the cy useEffect dep array (which would rebuild the graph on each live update).
  const findingsRef = useRef(findings);
  findingsRef.current = findings;

  useEffect(() => {
    if (!model || !graphRef.current) return;

    // Capture as a non-null binding so nested closures don't re-check
    const modelNonNull = model;
    const elements: cytoscape.ElementDefinition[] = [];

    // Build a set of subtype edges (child→parent) so we can rewire them through joiners
    const subtypeEdgeKeys = new Set<string>();
    for (const cluster of model.subtypeClusters) {
      for (const member of cluster.members) {
        subtypeEdgeKeys.add(`${member}-${cluster.basetype}`);
      }
    }

    for (const node of model.nodes) {
      elements.push({
        data: {
          id: node.id,
          label: wrapEntityLabel(node.id),
          classification: node.classification,
          group: node.group ?? '',
        },
      });
    }

    // Add compound cluster nodes, joiner nodes, and rewire subtype edges
    for (const cluster of model.subtypeClusters) {
      const clusterId = `_cluster_${cluster.basetype}_${cluster.exclusive ? 'x' : 'i'}`;
      const joinerId = `_joiner_${cluster.basetype}_${cluster.exclusive ? 'x' : 'i'}`;

      // Invisible compound parent that groups the subtypes
      elements.push({
        data: {
          id: clusterId,
          label: '',
          cluster: 'true',
        },
      });

      // Joiner sits between basetype and compound (not inside it)
      elements.push({
        data: {
          id: joinerId,
          label: cluster.exclusive ? 'X' : '',
          joiner: 'true',
          exclusive: String(cluster.exclusive),
        },
      });

      // Edge from basetype to joiner
      elements.push({
        data: {
          id: `${cluster.basetype}-${joinerId}`,
          source: cluster.basetype,
          target: joinerId,
          identifying: 'true',
          edgeLabel: '',
          parentCard: '1',
          childCard: '',
          subtypeEdge: 'true',
        },
      });

      // Each subtype is a child of the compound, with edge from joiner
      for (const member of cluster.members) {
        // Set parent on the existing node element
        const nodeEl = elements.find(e => e.data.id === member);
        if (nodeEl) nodeEl.data.parent = clusterId;

        elements.push({
          data: {
            id: `${joinerId}-${member}`,
            source: joinerId,
            target: member,
            identifying: 'true',
            edgeLabel: '',
            parentCard: '',
            childCard: '0..1',
            subtypeEdge: 'true',
          },
        });
      }
    }

    for (const edge of model.edges) {
      // Skip subtype edges — they've been rewired through joiners
      if (subtypeEdgeKeys.has(`${edge.source}-${edge.target}`)) continue;

      elements.push({
        data: {
          id: `${edge.source}-${edge.target}`,
          source: edge.target,
          target: edge.source,
          identifying: String(edge.identifying),
          predicateFwd: edge.predicate.fwd,
          predicateRev: edge.predicate.rev,
          edgeLabel: edge.predicate.fwd,
          predicateMode: 'fwd',
          parentCard: edge.cardinality.parent,
          childCard: edge.cardinality.child,
        },
      });
    }

    const longestPredicate = model.edges.reduce(
      (max, e) => Math.max(max, e.predicate.fwd.length), 0
    );
    const charWidth = 6; // ~6px per char at font-size 10
    const markerPadding = 50; // room for markers on both ends
    const layerPadding = 30; // extra breathing room between layers
    const layerSpacing = Math.max(110, longestPredicate * charWidth + markerPadding + layerPadding);

    // Two switchable layout algorithms (FAB toggle):
    //   hierarchical → ELK layered  (ranked rows; identification reads top-down)
    //   organic      → ELK stress   (force-directed hub-and-spoke; relatedness reads spatially)
    // Stress edge length scales off the layered layer spacing so the two feel comparable.
    const buildLayoutOpts = (mode: LayoutMode): cytoscape.LayoutOptions => {
      if (mode === 'organic') {
        return {
          name: 'elk',
          elk: {
            algorithm: 'stress',
            // Roomier than layered so hubs (and their cluster fans) land farther
            // apart — leaves space for fanSubtypeClusters and minimises collisions.
            'elk.stress.desiredEdgeLength': String(Math.max(280, Math.round(layerSpacing * 1.6))),
            'elk.spacing.nodeNode': String(Math.max(120, model.theme.spacing.nodeSep)),
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
          },
        } as cytoscape.LayoutOptions;
      }
      return {
        name: 'elk',
        elk: {
          algorithm: 'layered',
          'elk.direction': 'DOWN',
          'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
          'elk.spacing.nodeNode': String(model.theme.spacing.nodeSep),
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
          // Greedy post-pass: swap adjacent nodes whenever it removes a crossing.
          'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
          // More crossing-minimization iterations (default 7). Slower, fewer crossings.
          'elk.layered.thoroughness': '30',
          'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
          // Pull edges toward straight lines, reducing near-crossings.
          'elk.layered.nodePlacement.favorStraightEdges': 'true',
          'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
          'elk.layered.compaction.postCompaction.strategy': 'NONE',
          'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        },
      } as cytoscape.LayoutOptions;
    };

    const elkLayoutOpts = buildLayoutOpts(layoutModeRef.current);

    let cy: cytoscape.Core;
    try {
      cy = cytoscape({
        container: graphRef.current,
        elements,
        layout: elkLayoutOpts,
        style: buildStyles(model.groups, model.theme, themeMode),
        minZoom: 0.3,
        maxZoom: 3,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ignatius] Cytoscape init failed:', msg);
      setCyInitError(msg);
      return;
    }
    window.__IGNATIUS_CY__ = cy;

    if (!svgRef.current) {
      svgRef.current = createMarkerOverlay(graphRef.current);
    }
    const svg = svgRef.current;

    const redrawMarkers = () => {
      if (cy.destroyed()) return;
      updateMarkers(cy, svg, model.theme, themeModeRef.current);
      // Draw warning badges for entities with findings on top of crow's-foot markers.
      // Reads findingsRef so badge set stays current without adding findings as a dep.
      const badgeIds = new Set(findingsRef.current.entityErrors.map(e => e.entityId));
      drawWarningBadges(cy, svg, badgeIds);
    };



    // Tracks the last hash string we wrote ourselves, to break the hashchange feedback loop.
    let lastWrittenHash = '';

    // Debounced writer: pan+zoom+entity all share one 200ms window.
    let writeTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleHashWrite(next: HashState) {
      if (writeTimer !== null) clearTimeout(writeTimer);
      writeTimer = setTimeout(() => {
        writeTimer = null;
        const serialized = serializeHash(next);
        lastWrittenHash = serialized;
        history.replaceState({}, '', serialized ? '#' + serialized : location.pathname);
      }, 200);
    }

    // Reads current viewport (zoom + pan only) into a HashState — no entity lookup.
    function viewportState(): HashState {
      const zoom = cy.zoom();
      const pan = cy.pan();
      return {
        zoom: Math.round(zoom * 1000) / 1000,
        pan: { x: Math.round(pan.x), y: Math.round(pan.y) },
      };
    }

    // Reads current viewport + selected entity into a HashState for writing.
    function currentHashState(): HashState {
      const state = viewportState();
      const sel = cy.$('node:selected').first();
      if (sel.length > 0 && !String(sel.id()).startsWith('_')) {
        state.entity = sel.id();
      }
      return state;
    }

    // Applies a parsed HashState to the cy instance.
    // Order: zoom → pan → entity select+center.
    function applyHashState(state: HashState) {
      if (state.zoom !== undefined) {
        cy.zoom(state.zoom);
      }
      if (state.pan !== undefined) {
        cy.pan(state.pan);
      }
      if (state.entity !== undefined) {
        const target = cy.$(`#${CSS.escape(state.entity)}`);
        if (target.length > 0) {
          cy.elements().unselect();
          target.select();
          // Only center if no explicit pan was supplied
          if (state.pan === undefined) {
            cy.center(target);
          }
          const node = modelNonNull.nodes.find(n => n.id === state.entity);
          if (node) {
            setSelected(node);
            setShowEntityModal(true);
          }
        }
        // Unknown entity: silently ignore
      }
    }

    const layoutStore = createLayoutStore();
    cy.one('layoutstop', () => {
      // Restore saved positions (if any) BEFORE fitting, so the fit centers on
      // the user-arranged layout. All-or-nothing: key match → restore all; miss → ELK stands.
      const savedKey = layoutKeyRef.current;
      const saved = savedKey ? layoutStore.load(savedKey) : null;
      if (saved) {
        for (const [id, pos] of Object.entries(saved)) {
          const node = cy.$id(id);
          // Skip compound parents (subtype-cluster boxes): setting a parent's
          // position translates its children, displacing them from their own
          // saved absolute positions. Restore children only; the parent's
          // bounding box recomputes around them.
          if (!node.empty() && !node.isParent()) node.position(pos);
        }
      } else if (layoutModeRef.current === 'organic') {
        // Organic initial layout (e.g. an SSE rebuild while toggled to organic):
        // arrange clusters into fans and clear overlaps so it doesn't render messy.
        arrangeOrganic(cy);
      }

      cy.fit(undefined, 30);
      redrawMarkers();

      // Restore state from URL hash after layout settles (no race with ELK)
      const initialState = parseHash(location.hash);
      if (Object.keys(initialState).length > 0) {
        applyHashState(initialState);
      }
    });

    cy.on('viewport', () => {
      redrawMarkers();
      scheduleHashWrite(currentHashState());
    });

    cy.on('position', redrawMarkers);

    cy.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id();
      const node = model.nodes.find(n => n.id === nodeId);
      if (node) {
        setSelected(node);
        setShowEntityModal(true);
        // Use nodeId directly — cy.$('node:selected') hasn't updated yet at tap time.
        scheduleHashWrite({ ...viewportState(), entity: nodeId });
      }
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelected(null);
        setShowEntityModal(false);
        // Clear entity from hash when background tap deselects.
        scheduleHashWrite(viewportState());
      }
    });

    // Expose hash writes to JSX paths outside this closure (e.g. modal links).
    navigateToEntityRef.current = (id: string) => {
      scheduleHashWrite({ ...viewportState(), entity: id });
    };

    // Clears saved arrangement for the current layoutKey and re-runs ELK from scratch.
    // cy.one('layoutstop') at init already fired — the reset closure handles fit/markers itself.
    resetLayoutRef.current = () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      layoutStore.clear(layoutKeyRef.current);
      const mode = layoutModeRef.current;
      const lo = cy.layout(buildLayoutOpts(mode));
      lo.one('layoutstop', () => {
        if (mode === 'organic') arrangeOrganic(cy);
        cy.fit(undefined, 30);
        redrawMarkers();
      });
      lo.run();
    };

    // Switch layout algorithm live from the FAB toggle — re-runs ELK in the
    // requested mode and refits, without rebuilding the graph or clearing saved
    // positions. (Drag-to-save still overrides on the next 'free' event.)
    applyLayoutModeRef.current = (mode) => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      const lo = cy.layout(buildLayoutOpts(mode));
      lo.one('layoutstop', () => {
        // Organic layout stretches identifying edges and can collide nearby fans;
        // re-arrange clusters into tidy fans and clear overlaps before fitting.
        if (mode === 'organic') arrangeOrganic(cy);
        cy.fit(undefined, 30);
        redrawMarkers();
      });
      lo.run();
    };

    // Direct navigate for the findings panel: select + center immediately, then sync hash.
    panelNavigateRef.current = (id: string) => {
      const target = cy.$(`#${CSS.escape(id)}`);
      if (target.length === 0) return;
      cy.elements().unselect();
      target.select();
      cy.center(target);
      const node = modelNonNull.nodes.find(n => n.id === id);
      if (node) setSelected(node);
      scheduleHashWrite({ ...viewportState(), entity: id });
    };

    // hashchange: re-apply if different from what we last wrote (avoids feedback loops)
    function onHashChange() {
      const newHash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
      if (newHash === lastWrittenHash) return;
      lastWrittenHash = newHash;
      applyHashState(parseHash(location.hash));
    }
    window.addEventListener('hashchange', onHashChange);

    // Compute screen-direction-aware arrow placement.
    // Cytoscape autorotate flips text 180° when the edge angle would render it
    // upside-down. We bake the arrow into the label, so it must flip with the text.
    // Returns the verb wrapped with an arrow that always visually points to the
    // intended end (child for fwd, parent for rev) on screen.
    function applyArrow(edge: cytoscape.EdgeSingular, verb: string, dir: 'fwd' | 'rev'): string {
      if (!verb) return '';
      const s = edge.sourceEndpoint();
      const t = edge.targetEndpoint();
      if (!s || !t || !Number.isFinite(s.x) || !Number.isFinite(t.x)) {
        return dir === 'fwd' ? `${verb} →` : `← ${verb}`;
      }
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      // Autorotate flips when the edge angle would point text upside-down.
      // The flip threshold matches the model-coordinate direction (dx<0).
      const flipped = dx < 0;
      if (dir === 'fwd') return flipped ? `← ${verb}` : `${verb} →`;
      return flipped ? `${verb} →` : `← ${verb}`;
      // Suppress unused-var if dy isn't read; reserved for future tuning.
      void dy;
    }

    // Refresh all edge labels with current direction-aware arrows. Called after
    // layout, drag, and on mount once nodes have positions. Reads predicateMode
    // so hovered child-end edges (showing rev) also re-orient during drag.
    function refreshArrows() {
      cy.edges().forEach((edge) => {
        const fwd = edge.data('predicateFwd');
        if (fwd === undefined) return;
        const mode = edge.data('predicateMode') as 'fwd' | 'rev' | undefined;
        if (mode === 'rev') {
          const rev = edge.data('predicateRev');
          edge.data('edgeLabel', applyArrow(edge, rev, 'rev'));
        } else {
          edge.data('edgeLabel', applyArrow(edge, fwd, 'fwd'));
        }
      });
    }

    cy.on('layoutstop', refreshArrows);
    cy.on('position', 'node', refreshArrows);
    cy.on('drag', 'node', refreshArrows);
    cy.on('free', 'node', refreshArrows);
    // Initial pass: edges were created with raw verb text — apply arrows once
    // positions are settled. Defer one tick so the initial layout completes.
    setTimeout(refreshArrows, 0);

    // Save node positions to localStorage on drag-end (~400ms debounced).
    // Keyed by layoutKeyRef so SSE rebuilds always write under the current key.
    // Skip when the key is absent (e.g. server hasn't responded yet).
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    cy.on('free', 'node', () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const key = layoutKeyRef.current;
        if (!key) return;
        const positions: Record<string, { x: number; y: number }> = {};
        cy.nodes().forEach((node) => {
          const pos = node.position();
          positions[node.id()] = { x: pos.x, y: pos.y };
        });
        layoutStore.save(key, positions);
      }, 400);
    });

    // Walk the key-inheritance lineage upward from a node to the root(s).
    // Graph edges run parent→child, so an incoming edge points to a child; we
    // follow only identifying edges (key inherited) and stop at referential
    // ones — signifying you can reach the root because the key travels with you.
    // Joiner nodes (basetype→joiner→subtype) are identifying, so subtype lineage
    // passes through them transparently up to the basetype and beyond.
    function collectLineage(start: cytoscape.NodeCollection) {
      let acc = cy.collection();
      let frontier = start;
      const seen = new Set<string>([start.id()]);
      while (frontier.nonempty()) {
        const inEdges = frontier.incomers('edge[identifying = "true"]');
        if (inEdges.empty()) break;
        const parents = inEdges.sources();
        acc = acc.union(inEdges).union(parents);
        frontier = parents.filter((p) => {
          if (seen.has(p.id())) return false;
          seen.add(p.id());
          return true;
        });
      }
      return acc;
    }

    // Walk the key-inheritance lineage DOWNWARD from a node to its leaves: follow
    // outgoing identifying edges (parent→child) so a node's identifying children —
    // and, through joiners, a basetype's subtypes — light up alongside its ancestry.
    function collectDescendants(start: cytoscape.NodeCollection) {
      let acc = cy.collection();
      let frontier = start;
      const seen = new Set<string>([start.id()]);
      while (frontier.nonempty()) {
        const outEdges = frontier.outgoers('edge[identifying = "true"]');
        if (outEdges.empty()) break;
        const children = outEdges.targets();
        acc = acc.union(outEdges).union(children);
        frontier = children.filter((c) => {
          if (seen.has(c.id())) return false;
          seen.add(c.id());
          return true;
        });
      }
      return acc;
    }

    // Hover handlers: swap incident edge labels to the node's perspective, restore on mouseout.
    // On mouseover node N: edges where N is the child (edge.target() === N) flip to rev.
    // On mouseout: all connected edges restore to fwd.
    cy.on('mouseover', 'node', (evt) => {
      const n = evt.target;
      n.connectedEdges().forEach((edge) => {
        const rev = edge.data('predicateRev');
        if (rev === undefined) return; // cluster/joiner edges — skip
        if (edge.target().id() === n.id()) {
          edge.data('predicateMode', 'rev');
          edge.data('edgeLabel', applyArrow(edge, rev, 'rev'));
        }
      });
      const direct = n.closedNeighborhood().union(n);
      const joiners = direct.nodes('[joiner = "true"]');
      const lineage = collectLineage(n);
      const descendants = collectDescendants(n);
      const keep = direct.union(joiners.incomers()).union(lineage).union(descendants);
      const keepWithAncestors = keep.union(keep.ancestors());
      cy.elements().difference(keepWithAncestors).addClass('faded');
      n.addClass('hover-focus');
      redrawMarkers();
    });

    cy.on('mouseout', 'node', (evt) => {
      const n = evt.target;
      n.connectedEdges().forEach((edge) => {
        const fwd = edge.data('predicateFwd');
        if (fwd === undefined) return;
        edge.data('predicateMode', 'fwd');
        edge.data('edgeLabel', applyArrow(edge, fwd, 'fwd'));
      });
      cy.elements().removeClass('faded');
      cy.nodes().removeClass('hover-focus');
      redrawMarkers();
    });

    cyRef.current = cy;

    // Mount navigator HERE — inside the cy lifecycle — so its teardown is
    // guaranteed to run before cy.destroy() nulls the renderer. See the
    // toggle effect above for the why.
    if (minimapOpenRef.current && minimapRef.current) {
      navRef.current = mountNavigator(cy);
    }

    setCyReady(true);
    return () => {
      // Tear down nav FIRST so any pending throttled tick is cancelled
      // before cy.destroy() nulls _private.renderer.
      if (navRef.current && minimapRef.current) {
        teardownNavigator(navRef.current, minimapRef.current);
        navRef.current = null;
      }
      if (writeTimer !== null) clearTimeout(writeTimer);
      if (saveTimer !== null) clearTimeout(saveTimer);
      window.removeEventListener('hashchange', onHashChange);
      navigateToEntityRef.current = () => {};
      panelNavigateRef.current = () => {};
      resetLayoutRef.current = null;
      applyLayoutModeRef.current = null;
      cy.destroy();
      cyRef.current = null;
      window.__IGNATIUS_CY__ = undefined;
      setCyReady(false);
      if (svgRef.current) {
        svgRef.current.remove();
        svgRef.current = null;
      }
    };
  }, [model]);

  const groupEntries = model ? Object.entries(model.groups) : [];

  const branding = model?.branding;
  const logoSrc = branding
    ? (themeMode === 'dark' ? branding.logo.dark : branding.logo.light)
    : undefined;

  // Error fallback — cytoscape init threw; render banner instead of blank canvas
  if (cyInitError) {
    return (
      <div className="graph-error-fallback">
        <div className="graph-error-fallback-box">
          <h2>Graph failed to render</h2>
          <p>The graph initializer encountered an error. The model may contain data that Cytoscape cannot process. Check the global errors below and correct the model.</p>
          <pre>{cyInitError}</pre>
        </div>
      </div>
    );
  }

  const showBanner = !bannerDismissed && findings.globalErrors.length > 0;

  return (
    <div className="app">
      {showBanner && (
        <div className="graph-global-banner" role="alert">
          <button
            className="graph-global-banner-close"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
          >
            ×
          </button>
          {findings.globalErrors.map((err, i) => (
            <div key={i} className="graph-global-banner-row">
              <strong>{RULES[err.ruleId]?.title ?? err.ruleId}:</strong>
              <span>{err.reason}</span>
            </div>
          ))}
        </div>
      )}
      <div className="graph-panel" ref={graphRef} />
      {minimapOpen && <div ref={minimapRef} id="minimap-panel" className="minimap" />}
      {branding && (
        <div className="branding-block">
          {logoSrc && (
            <img className="branding-logo" src={logoSrc} alt={branding.title} />
          )}
          <div className="branding-text">
            <h1 className="branding-title">{branding.title}</h1>
            <p className="branding-subtitle">{branding.subtitle}</p>
          </div>
        </div>
      )}
      <button className="theme-toggle" onClick={toggleTheme} title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        {themeMode === 'dark' ? '☀' : '☾'}
      </button>
      <button
        ref={fabRef}
        className={`fab${menuOpen ? ' fab--open' : ''}`}
        onClick={() => setMenuOpen(prev => !prev)}
        title="Actions"
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        {groupEntries.length > 0 ? (
          <span className="fab-dots">
            {groupEntries.slice(0, 4).map(([name, cfg]) => (
              <span key={name} className="fab-dot" style={{ background: cfg.color }} />
            ))}
          </span>
        ) : (
          <span className="fab-icon">⋯</span>
        )}
      </button>
      {menuOpen && (
        <div ref={menuRef} className="fab-menu" role="menu">
          <a
            className="fab-menu-item"
            href="dict"
            role="menuitem"
          >
            Open Dict
          </a>
          <button
            className="fab-menu-item"
            role="menuitem"
            onClick={() => { setMenuOpen(false); setShowLegend(true); }}
          >
            Legend
          </button>
          {groupEntries.length > 0 && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); setShowGroups(true); }}
            >
              Groups
            </button>
          )}
          <button
            className="fab-menu-item"
            role="menuitem"
            onClick={() => { toggleMinimapOpen(); setMenuOpen(false); }}
          >
            {minimapOpen ? 'Hide minimap' : 'Show minimap'}
          </button>
          <button
            className="fab-menu-item"
            role="menuitem"
            onClick={handleCopyLink}
          >
            Copy link
          </button>
          <button
            className="fab-menu-item"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              const next = layoutMode === 'organic' ? 'hierarchical' : 'organic';
              setLayoutMode(next);
              applyLayoutModeRef.current?.(next);
            }}
          >
            {layoutMode === 'organic' ? 'Hierarchical layout' : 'Organic layout'}
          </button>
          <button
            className="fab-menu-item"
            role="menuitem"
            onClick={() => { setMenuOpen(false); resetLayoutRef.current?.(); }}
          >
            Reset layout
          </button>
        </div>
      )}
      {copyConfirm && (
        <div className="fab-copy-toast">Copied!</div>
      )}
      {showGroups && (
        <div className="modal-backdrop" onClick={() => setShowGroups(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowGroups(false)}>×</button>
            <div className="modal-header">
              <h1>Groups</h1>
            </div>
            {groupEntries.map(([name, cfg]) => (
              <div key={name} className="group-card">
                <div className="group-card-header">
                  <span className="legend-swatch" style={{ background: cfg.color }} />
                  <strong>{cfg.label}</strong>
                </div>
                {cfg.desc && (
                  <div className="doc-body" dangerouslySetInnerHTML={{ __html: cfg.desc }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {showLegend && <LegendModal onClose={() => setShowLegend(false)} />}
      {selected && showEntityModal && (
        <SelectedEntityModal
          selected={selected}
          model={model}
          entityErrors={
            window.__IGNATIUS_MODE__ === 'static'
              ? findings.entityErrors.filter(e => !RULES[e.ruleId]?.liveOnly)
              : findings.entityErrors
          }
          onClose={() => setShowEntityModal(false)}
          onNavigate={(id) => {
            const target = model?.nodes.find(n => n.id === id);
            if (target) {
              setSelected(target);
              navigateToEntity(id);
            }
          }}
        />
      )}
      {branding && (
        <footer className="branding-footer">
          <span className="branding-copyright">
            &copy; {branding.copyright.year} {branding.copyright.holder}
          </span>
          {branding.poweredBy && (
            <span className="branding-powered">
              powered by{' '}
              <a href="https://noorm.dev" target="_blank" rel="noopener noreferrer">
                Noorm
              </a>
            </span>
          )}
        </footer>
      )}
      <FindingsPanel
        globalErrors={findings.globalErrors}
        entityErrors={
          window.__IGNATIUS_MODE__ === 'static'
            ? findings.entityErrors.filter(e => !RULES[e.ruleId]?.liveOnly)
            : findings.entityErrors
        }
        collapsed={panelCollapsed}
        onCollapse={() => setPanelCollapsed(true)}
        onExpand={() => setPanelCollapsed(false)}
        onNavigate={(id) => panelNavigateRef.current(id)}
      />
    </div>
  );
}
