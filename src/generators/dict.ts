import type { Model, ModelNode, ModelEdge } from '../parse';
import { semanticColors } from '../theme-defaults';
import { buildThemeCssVars } from './theme-css';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function classificationBadge(cls: string): string {
  const key = cls.toLowerCase() as keyof typeof semanticColors;
  const colors = semanticColors[key];
  if (!colors || typeof colors === 'string') {
    return `<span class="badge" style="background:var(--color-surface);color:var(--color-text-muted)">${esc(cls)}</span>`;
  }
  const { bg, fg } = colors as { bg: string; fg: string };
  return `<span class="badge" style="background:${bg};color:${fg}">${esc(cls)}</span>`;
}

function cardinalityLabel(c: { parent: string; child: string }): string {
  return `${c.parent} → ${c.child}`;
}

function renderAttributesTable(node: ModelNode, edges: ModelEdge[]): string {
  // Collect FK mappings: child_col → parent entity
  const fkMap: Record<string, string> = {};
  for (const edge of edges) {
    if (edge.source === node.id) {
      for (const [childCol, _parentCol] of Object.entries(edge.on)) {
        fkMap[childCol] = edge.target;
      }
    }
  }

  const pkSet: Record<string, true> = {};
  for (const col of node.pk) pkSet[col] = true;

  const rows = Object.entries(node.columns).map(([colName, def]) => {
    const isPk = pkSet[colName];
    const isFk = fkMap[colName];
    let keyCell = '';
    if (isPk && isFk) {
      keyCell = `PK · <a href="#entity-${esc(isFk)}">${esc(isFk)}</a>`;
    } else if (isPk) {
      keyCell = 'PK';
    } else if (isFk) {
      keyCell = `<a href="#entity-${esc(isFk)}">${esc(isFk)}</a>`;
    }

    const nullable = def.nullable ? 'Yes' : 'No';
    const defVal = def.default != null ? esc(String(def.default)) : '';
    const desc = def.desc ? esc(def.desc) : '';

    return `      <tr>
        <td><code>${esc(colName)}</code></td>
        <td><code>${esc(def.type)}</code></td>
        <td>${keyCell}</td>
        <td>${nullable}</td>
        <td>${defVal}</td>
        <td>${desc}</td>
      </tr>`;
  });

  return `    <table class="attr-table">
      <thead>
        <tr>
          <th>Attribute</th>
          <th>Type</th>
          <th>Key</th>
          <th>Nullable</th>
          <th>Default</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
${rows.join('\n')}
      </tbody>
    </table>`;
}

function renderRelationshipsTable(node: ModelNode, edges: ModelEdge[]): string {
  // Downstream relationships: edges where this entity is the parent (target)
  const downstream = edges.filter(e => e.target === node.id);
  if (downstream.length === 0) return '';

  const rows = downstream.map(e => {
    const relType = e.identifying ? 'Identifying' : 'Referential';
    return `      <tr>
        <td><a href="#entity-${esc(e.source)}">${esc(e.source)}</a></td>
        <td>${relType}</td>
        <td>${esc(e.predicate)}</td>
        <td>${esc(cardinalityLabel(e.cardinality))}</td>
      </tr>`;
  });

  return `    <h4 class="rel-heading">Downstream relationships</h4>
    <table class="rel-table">
      <thead>
        <tr>
          <th>Child entity</th>
          <th>Type</th>
          <th>Predicate</th>
          <th>Cardinality</th>
        </tr>
      </thead>
      <tbody>
${rows.join('\n')}
      </tbody>
    </table>`;
}

function renderEntitySection(node: ModelNode, edges: ModelEdge[]): string {
  const pkList = node.pk.map(col => `<code>${esc(col)}</code>`).join(', ');
  const pkLabel = node.pk.length > 0 ? `<span class="pk-label">PK: ${pkList}</span>` : '';

  return `  <section class="entity-section" id="entity-${esc(node.id)}">
    <div class="entity-header">
      <h2>${esc(node.id)}</h2>
      ${classificationBadge(node.classification)}
      ${pkLabel}
    </div>
${renderAttributesTable(node, edges)}
${renderRelationshipsTable(node, edges)}
    <div class="entity-body">${node.bodyHtml}</div>
  </section>`;
}

function renderGroupSection(
  groupKey: string,
  groupConfig: { label: string; color: string; desc?: string },
  nodes: ModelNode[],
  edges: ModelEdge[],
): string {
  const groupNodes = nodes.filter(n => n.group === groupKey);
  if (groupNodes.length === 0) return '';

  const entitiesHtml = groupNodes
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(n => renderEntitySection(n, edges))
    .join('\n');

  const descHtml = groupConfig.desc ?? '';

  return `<section class="group-section">
  <div class="group-header" style="border-left:4px solid ${groupConfig.color};padding-left:1rem">
    <h1 class="group-title" style="color:${groupConfig.color}">${esc(groupConfig.label)}</h1>
    <div class="group-desc">${descHtml}</div>
  </div>
${entitiesHtml}
</section>`;
}

function renderGroupLegend(groups: Model['groups']): string {
  const swatches = Object.entries(groups)
    .map(([, cfg]) => `  <li class="legend-item">
    <span class="swatch" style="background:${cfg.color}"></span>
    <span class="legend-label">${esc(cfg.label)}</span>
  </li>`)
    .join('\n');

  return `<nav class="legend">
  <ul class="legend-list">
${swatches}
  </ul>
</nav>`;
}

export function generateDict(model: Model, mode: 'dark' | 'light'): string {
  const cssVars = buildThemeCssVars(model.theme, mode);
  const metaName = (model as { _meta?: { name?: string } })._meta?.name ?? 'Data Dictionary';

  const groupOrder = Object.keys(model.groups);
  // Nodes without a group go last
  const ungroupedNodes = model.nodes.filter(n => !n.group || !model.groups[n.group]);

  const groupSections = groupOrder
    .map(key => {
      const cfg = model.groups[key];
      if (!cfg) return '';
      return renderGroupSection(key, cfg, model.nodes, model.edges);
    })
    .filter(s => s.length > 0)
    .join('\n\n');

  const ungroupedSection = ungroupedNodes.length > 0
    ? ungroupedNodes
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(n => renderEntitySection(n, model.edges))
        .join('\n')
    : '';

  const legend = renderGroupLegend(model.groups);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(metaName)}</title>
  <style>
    :root {
      ${cssVars}
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--color-background);
      color: var(--color-text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      padding: 2rem;
      max-width: 1100px;
      margin: 0 auto;
    }

    a { color: var(--color-link); text-decoration: none; }
    a:hover { text-decoration: underline; }

    h1, h2, h3, h4 { line-height: 1.3; }

    code {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.875em;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 3px;
      padding: 0.1em 0.3em;
    }

    /* Page header */
    .page-header {
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--color-border);
    }
    .page-title {
      font-size: 2rem;
      font-weight: 700;
      color: var(--color-text);
      margin-bottom: 0.75rem;
    }

    /* Legend */
    .legend { margin-bottom: 2rem; }
    .legend-list { list-style: none; display: flex; flex-wrap: wrap; gap: 1rem; }
    .legend-item { display: flex; align-items: center; gap: 0.5rem; }
    .swatch { width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; }
    .legend-label { font-size: 0.85rem; color: var(--color-text-muted); }

    /* Group sections */
    .group-section { margin-bottom: 3rem; }
    .group-header { margin-bottom: 1.5rem; padding: 1rem; background: var(--color-surface); border-radius: 6px; }
    .group-title { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
    .group-desc p { color: var(--color-text-muted); font-size: 0.9rem; margin-top: 0.25rem; }

    /* Entity sections */
    .entity-section {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .entity-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    .entity-header h2 {
      font-size: 1.2rem;
      font-weight: 600;
      color: var(--color-text);
    }

    /* Classification badge */
    .badge {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.15em 0.55em;
      border-radius: 4px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    /* PK label */
    .pk-label {
      font-size: 0.8rem;
      color: var(--color-text-muted);
      margin-left: auto;
    }

    /* Tables */
    .attr-table, .rel-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1rem;
      font-size: 0.85rem;
    }
    .attr-table th, .rel-table th {
      background: var(--color-surface-alt);
      color: var(--color-text-muted);
      text-align: left;
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid var(--color-border);
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .attr-table td, .rel-table td {
      padding: 0.35rem 0.6rem;
      border-bottom: 1px solid var(--color-border);
      color: var(--color-text);
      vertical-align: top;
    }
    .attr-table tr:last-child td, .rel-table tr:last-child td {
      border-bottom: none;
    }
    .attr-table tr:hover td, .rel-table tr:hover td {
      background: var(--color-surface-alt);
    }

    /* Relationships heading */
    .rel-heading {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
      margin-top: 0.5rem;
    }

    /* Entity body (markdown) */
    .entity-body {
      border-top: 1px solid var(--color-border);
      padding-top: 0.75rem;
      margin-top: 0.75rem;
      color: var(--color-text-muted);
      font-size: 0.88rem;
    }
    .entity-body h1, .entity-body h2, .entity-body h3, .entity-body h4 {
      color: var(--color-text);
      font-size: 0.95rem;
      margin: 0.75rem 0 0.25rem;
    }
    .entity-body p { margin-bottom: 0.5rem; }
    .entity-body ul, .entity-body ol { padding-left: 1.25rem; margin-bottom: 0.5rem; }
    .entity-body table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      margin-bottom: 0.75rem;
    }
    .entity-body th, .entity-body td {
      padding: 0.3rem 0.5rem;
      border: 1px solid var(--color-border);
    }
    .entity-body th { background: var(--color-surface-alt); }
  </style>
</head>
<body>
  <header class="page-header">
    <h1 class="page-title">${esc(metaName)}</h1>
    ${legend}
  </header>
  <main>
${groupSections}
${ungroupedSection}
  </main>
</body>
</html>`;
}
