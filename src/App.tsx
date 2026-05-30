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
import type {
  Model,
  ModelNode,
  ModelEdge,
  SubtypeCluster,
  GroupConfig,
} from './parse';

// @ts-expect-error — cytoscape uses `export =` which loses namespace members under bundler resolution
cytoscape.use(elk);
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
        'width': 110,
        'height': 36,
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
                <line x1="2" y1="12" x2="28" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="44" y1="12" x2="28" y2="2" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="44" y1="12" x2="28" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="44" y1="12" x2="28" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="48" y1="2" x2="48" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Many</strong>
              <span className="legend-desc">Crow's foot. One or more on this end.</span>
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
      return;
    }

    // Live mode: server computed validation — use its payload, do not re-validate.
    function applyPayload(payload: { model: Model; parseGlobalErrors: GlobalError[]; validation: { cleanedModel: Model; globalErrors: GlobalError[]; entityErrors: EntityError[] } }) {
      const allGlobal = [...payload.parseGlobalErrors, ...payload.validation.globalErrors];
      setModel(payload.validation.cleanedModel);
      setFindings({
        globalErrors: allGlobal,
        entityErrors: payload.validation.entityErrors,
      });
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
          label: node.id.replace(/_/g, ' '),
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
    const layerSpacing = Math.max(80, longestPredicate * charWidth + markerPadding);

    let cy: cytoscape.Core;
    try {
      cy = cytoscape({
        container: graphRef.current,
        elements,
        layout: {
          name: 'elk',
          elk: {
            algorithm: 'layered',
            'elk.direction': 'DOWN',
            'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
            'elk.spacing.nodeNode': String(model.theme.spacing.nodeSep),
            'elk.edgeRouting': 'ORTHOGONAL',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
            'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
            'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
          },
        } as cytoscape.LayoutOptions,
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
          if (node) setSelected(node);
        }
        // Unknown entity: silently ignore
      }
    }

    cy.one('layoutstop', () => {
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
        // Use nodeId directly — cy.$('node:selected') hasn't updated yet at tap time.
        scheduleHashWrite({ ...viewportState(), entity: nodeId });
      }
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelected(null);
        // Clear entity from hash when background tap deselects.
        scheduleHashWrite(viewportState());
      }
    });

    // Expose hash writes to JSX paths outside this closure (e.g. modal links).
    navigateToEntityRef.current = (id: string) => {
      scheduleHashWrite({ ...viewportState(), entity: id });
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

    // Hover handlers: swap incident edge labels to the node's perspective, restore on mouseout.
    // On mouseover node N: edges where N is the child (edge.target() === N) flip to rev.
    // On mouseout: all connected edges restore to fwd.
    cy.on('mouseover', 'node', (evt) => {
      const n = evt.target;
      n.connectedEdges().forEach((edge) => {
        const rev = edge.data('predicateRev');
        if (rev === undefined) return; // cluster/joiner edges — skip
        if (edge.target().id() === n.id()) {
          edge.data('edgeLabel', rev);
        }
      });
    });

    cy.on('mouseout', 'node', (evt) => {
      const n = evt.target;
      n.connectedEdges().forEach((edge) => {
        const fwd = edge.data('predicateFwd');
        if (fwd === undefined) return;
        edge.data('edgeLabel', fwd);
      });
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
      window.removeEventListener('hashchange', onHashChange);
      navigateToEntityRef.current = () => {};
      panelNavigateRef.current = () => {};
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
      {selected && (
        <SelectedEntityModal
          selected={selected}
          model={model}
          entityErrors={findings.entityErrors}
          onClose={() => setSelected(null)}
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
        entityErrors={findings.entityErrors}
        collapsed={panelCollapsed}
        onCollapse={() => setPanelCollapsed(true)}
        onExpand={() => setPanelCollapsed(false)}
        onNavigate={(id) => panelNavigateRef.current(id)}
      />
    </div>
  );
}
