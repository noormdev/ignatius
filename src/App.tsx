import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
import { createMarkerOverlay, updateMarkers } from './markers';
import { semanticColors, type ThemeConfig, type ThemeMode } from './theme-defaults';
import type {
  Model,
  ModelNode,
  ModelEdge,
  SubtypeCluster,
  GroupConfig,
} from './parse';

cytoscape.use(elk);

declare global {
  interface Window {
    __MODEL__?: Model;
    __THEME_MODE__?: 'dark' | 'light';
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

  // Semantic classification badge colors (fixed, not palette-driven)
  root.style.setProperty('--badge-independent-bg', semanticColors.independent.bg);
  root.style.setProperty('--badge-independent-fg', semanticColors.independent.fg);
  root.style.setProperty('--badge-dependent-bg', semanticColors.dependent.bg);
  root.style.setProperty('--badge-dependent-fg', semanticColors.dependent.fg);
  root.style.setProperty('--badge-classifier-bg', semanticColors.classifier.bg);
  root.style.setProperty('--badge-classifier-fg', semanticColors.classifier.fg);
  root.style.setProperty('--badge-subtype-bg', semanticColors.subtype.bg);
  root.style.setProperty('--badge-subtype-fg', semanticColors.subtype.fg);
  root.style.setProperty('--badge-associative-bg', semanticColors.associative.bg);
  root.style.setProperty('--badge-associative-fg', semanticColors.associative.fg);
  root.style.setProperty('--color-link', semanticColors.link);
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
        'label': 'data(predicate)',
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
              <td>{edge.predicate}</td>
              <td>{edge.cardinality.parent}:{edge.cardinality.child}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function App() {
  const graphRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [selected, setSelected] = useState<ModelNode | null>(null);
  const [showGroups, setShowGroups] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (window.__THEME_MODE__) return window.__THEME_MODE__;
    const stored = localStorage.getItem('derek-theme');
    const initial: ThemeMode = stored === 'light' ? 'light' : 'dark';
    return initial;
  });
  // Ref so viewport/position listeners always read the current mode without needing cy rebuild
  const themeModeRef = useRef<ThemeMode>(themeMode);

  useEffect(() => {
    // Static mode: model baked in at generation time — skip server entirely
    if (window.__MODEL__) {
      setModel(window.__MODEL__);
      return;
    }

    fetch('/api/model').then(r => r.json()).then(setModel);

    const es = new EventSource('/events');
    es.addEventListener('model-changed', () => {
      fetch('/api/model')
        .then(r => r.json())
        .then((newModel: Model) => {
          setModel(newModel);
          // Keep selected node in sync: update it from the new model, or clear if removed
          setSelected(prev => {
            if (!prev) return null;
            const updated = newModel.nodes.find(n => n.id === prev.id);
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
  }, [themeMode]);

  function toggleTheme() {
    const next: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
    localStorage.setItem('derek-theme', next);
    setThemeMode(next);
  }

  useEffect(() => {
    if (!model || !graphRef.current) return;

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
          predicate: '',
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
            predicate: '',
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
          predicate: edge.predicate,
          parentCard: edge.cardinality.parent,
          childCard: edge.cardinality.child,
        },
      });
    }

    const longestPredicate = model.edges.reduce(
      (max, e) => Math.max(max, e.predicate.length), 0
    );
    const charWidth = 6; // ~6px per char at font-size 10
    const markerPadding = 50; // room for markers on both ends
    const layerSpacing = Math.max(80, longestPredicate * charWidth + markerPadding);

    const cy = cytoscape({
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

    if (!svgRef.current) {
      svgRef.current = createMarkerOverlay(graphRef.current);
    }
    const svg = svgRef.current;

    const redrawMarkers = () => updateMarkers(cy, svg, model.theme, themeModeRef.current);
    cy.one('layoutstop', () => { cy.fit(undefined, 30); redrawMarkers(); });
    cy.on('viewport', redrawMarkers);
    cy.on('position', redrawMarkers);

    cy.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id();
      const node = model.nodes.find(n => n.id === nodeId);
      if (node) setSelected(node);
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelected(null);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      if (svgRef.current) {
        svgRef.current.remove();
        svgRef.current = null;
      }
    };
  }, [model]);

  const groupEntries = model ? Object.entries(model.groups) : [];

  return (
    <div className="app">
      <div className="graph-panel" ref={graphRef} />
      <button className="theme-toggle" onClick={toggleTheme} title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        {themeMode === 'dark' ? '☀' : '☾'}
      </button>
      {groupEntries.length > 0 && (
        <button className="fab" onClick={() => setShowGroups(true)}>
          <span className="fab-dots">
            {groupEntries.slice(0, 4).map(([name, cfg]) => (
              <span key={name} className="fab-dot" style={{ background: cfg.color }} />
            ))}
          </span>
        </button>
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
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}>×</button>
            <div className="modal-header">
              <h1>{selected.id.replace(/_/g, ' ')}</h1>
              <div className="modal-badges">
                <span className={`badge ${selected.classification.toLowerCase()}`}>
                  {selected.classification}
                </span>
                {selected.group && model?.groups[selected.group] && (
                  <span
                    className="badge"
                    style={{
                      background: hexToRgba(model.groups[selected.group].color, 0.2),
                      color: model.groups[selected.group].color,
                    }}
                  >
                    {model.groups[selected.group].label}
                  </span>
                )}
                <span className="pk-label">
                  PK: {selected.pk.join(', ')}
                </span>
              </div>
            </div>
            <ColumnsTable
              node={selected}
              edges={model?.edges ?? []}
              onNavigate={(id) => {
                const target = model?.nodes.find(n => n.id === id);
                if (target) setSelected(target);
              }}
            />
            <div
              className="doc-body"
              dangerouslySetInnerHTML={{ __html: selected.bodyHtml }}
            />
            <ChildrenTable
              node={selected}
              edges={model?.edges ?? []}
              onNavigate={(id) => {
                const target = model?.nodes.find(n => n.id === id);
                if (target) setSelected(target);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
