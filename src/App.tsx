import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
import { createMarkerOverlay, updateMarkers } from './markers';

cytoscape.use(elk);

type GroupConfig = { label: string; color: string; desc?: string };

type ModelNode = {
  id: string;
  classification: string;
  group?: string;
  pk: string[];
  columns: Record<string, { type: string; nullable?: boolean; desc?: string; default?: string }>;
  alternateKeys: { rule: string; columns: string[] }[];
  bodyHtml: string;
};

type Cardinality = '1' | '0..1' | 'many';

type ModelEdge = {
  source: string;
  target: string;
  identifying: boolean;
  on: Record<string, string>;
  predicate: string;
  cardinality: { parent: Cardinality; child: Cardinality };
};

type SubtypeCluster = {
  basetype: string;
  exclusive: boolean;
  members: string[];
  desc?: string;
};

type Model = {
  groups: Record<string, GroupConfig>;
  nodes: ModelNode[];
  edges: ModelEdge[];
  subtypeClusters: SubtypeCluster[];
};

function buildStyles(groups: Record<string, GroupConfig>): cytoscape.Stylesheet[] {
  const base: cytoscape.Stylesheet[] = [
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'background-color': pastel('#6e7681'),
        'color': '#e6edf3',
        'border-width': 2,
        'border-color': '#6e7681',
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
      selector: 'node[joiner = "true"]',
      style: {
        'shape': 'diamond',
        'width': 20,
        'height': 20,
        'background-color': '#0e1116',
        'border-color': '#8b949e',
        'border-width': 2,
        'font-size': 10,
        'font-weight': 700,
        'color': '#8b949e',
        'text-valign': 'center',
        'text-halign': 'center',
      },
    },
    {
      selector: 'edge[subtypeEdge = "true"]',
      style: {
        'line-style': 'solid',
        'width': 1.5,
        'line-color': '#8b949e',
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
        'line-color': '#8b949e',
        'target-arrow-shape': 'none',
        'source-arrow-shape': 'none',
        'curve-style': 'bezier',
        'label': 'data(predicate)',
        'font-size': 10,
        'color': '#6e7681',
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
        'line-color': '#8b949e',
      },
    },
    {
      selector: 'edge[identifying = "false"]',
      style: {
        'line-style': 'dashed',
        'line-color': '#3d424a',
        'width': 1.2,
      },
    },
  ];

  for (const [name, cfg] of Object.entries(groups)) {
    base.push({
      selector: `node[group = "${name}"]`,
      style: {
        'border-color': cfg.color,
        'background-color': pastel(cfg.color),
      },
    });
    base.push({
      selector: `node[group = "${name}"]:selected`,
      style: { 'border-color': lighten(cfg.color) },
    });
  }

  return base;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function pastel(hex: string): string {
  const bg = [14, 17, 22]; // #0e1116
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = 0.3;
  const pr = Math.round(bg[0] * (1 - mix) + r * mix);
  const pg = Math.round(bg[1] * (1 - mix) + g * mix);
  const pb = Math.round(bg[2] * (1 - mix) + b * mix);
  return `#${pr.toString(16).padStart(2,'0')}${pg.toString(16).padStart(2,'0')}${pb.toString(16).padStart(2,'0')}`;
}

function lighten(hex: string): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + 60);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + 60);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + 60);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
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

  useEffect(() => {
    fetch('/api/model').then(r => r.json()).then(setModel);
  }, []);

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

    // Add joiner nodes and rewire subtype edges
    for (const cluster of model.subtypeClusters) {
      const joinerId = `_joiner_${cluster.basetype}_${cluster.exclusive ? 'x' : 'i'}`;
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
      // Edges from joiner to each subtype
      for (const member of cluster.members) {
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

    const cy = cytoscape({
      container: graphRef.current,
      elements,
      layout: {
        name: 'elk',
        elk: {
          algorithm: 'layered',
          'elk.direction': 'DOWN',
          'elk.layered.spacing.nodeNodeBetweenLayers': '60',
          'elk.spacing.nodeNode': '30',
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
          'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
          'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
          'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
        },
      } as cytoscape.LayoutOptions,
      style: buildStyles(model.groups),
      minZoom: 0.3,
      maxZoom: 3,
    });

    if (!svgRef.current) {
      svgRef.current = createMarkerOverlay(graphRef.current);
    }
    const svg = svgRef.current;

    const redrawMarkers = () => updateMarkers(cy, svg);
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
