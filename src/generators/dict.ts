import type { Model, ModelNode, ModelEdge, SubtypeCluster } from '../parse';
import type { GlobalError, EntityError } from '../validate';
import { RULES } from '../validate';
import { buildThemeCssVars } from './theme-css';
import { inlineAsset } from './inline-asset';
import { defaultBranding } from '../branding-defaults';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const KNOWN_CLASSIFICATIONS = new Set(['independent', 'dependent', 'classifier', 'subtype', 'associative']);

function classificationBadge(cls: string): string {
  const key = cls.toLowerCase();
  if (!KNOWN_CLASSIFICATIONS.has(key)) {
    return `<span class="badge" style="background:var(--color-surface);color:var(--color-text-muted)">${esc(cls)}</span>`;
  }
  return `<span class="badge" style="background:var(--badge-${key}-bg);color:var(--badge-${key}-fg)">${esc(cls)}</span>`;
}

function cardinalityLabel(c: { parent: string; child: string }): string {
  return `${c.parent} → ${c.child}`;
}

function renderAttributesTable(node: ModelNode, edges: ModelEdge[], missingTargets: Set<string>): string {
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
      if (missingTargets.has(isFk)) {
        keyCell = `PK · <a class="dict-link-missing" href="#missing-${esc(isFk)}">${esc(isFk)}</a>`;
      } else {
        keyCell = `PK · <a href="#entity-${esc(isFk)}">${esc(isFk)}</a>`;
      }
    } else if (isPk) {
      keyCell = 'PK';
    } else if (isFk) {
      if (missingTargets.has(isFk)) {
        keyCell = `<a class="dict-link-missing" href="#missing-${esc(isFk)}">${esc(isFk)}</a>`;
      } else {
        keyCell = `<a href="#entity-${esc(isFk)}">${esc(isFk)}</a>`;
      }
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
    const fwd = esc(e.predicate.fwd);
    const rev = esc(e.predicate.rev);
    // In this model `predicate.rev` is authored with the child as subject
    // ("SIL_Product bills Product") and `predicate.fwd` with the parent
    // ("Product is billed via SIL_Product"). Row starts with the child name,
    // so the primary pill (child's perspective) is `rev`. Inverse pill is `fwd`.
    const predicateCell = e.predicate.fwd === e.predicate.rev
      ? `<td class="predicate-cell"><span class="predicate-pill predicate-pill--shared">${fwd}</span></td>`
      : `<td class="predicate-cell">
          <span class="predicate-pill predicate-pill--primary">${rev}<span class="predicate-arrow">&rarr;</span></span>
          <span class="predicate-pill predicate-pill--inverse"><span class="predicate-arrow">&larr;</span>${fwd}</span>
        </td>`;
    return `      <tr>
        <td><a href="#entity-${esc(e.source)}">${esc(e.source)}</a></td>
        <td>${relType}</td>
        ${predicateCell}
        <td>${esc(cardinalityLabel(e.cardinality))}</td>
      </tr>`;
  });

  return `    <h4 class="rel-heading">Downstream relationships</h4>
    <table class="rel-table rel-table--predicates">
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

function renderEntitySection(
  node: ModelNode,
  edges: ModelEdge[],
  subtypeClusters: SubtypeCluster[],
  entityErrors: EntityError[],
  missingTargets: Set<string>,
): string {
  const pkList = node.pk.map(col => `<code>${esc(col)}</code>`).join(', ');
  const pkLabel = node.pk.length > 0 ? `<span class="pk-label">PK: ${pkList}</span>` : '';

  const isBasetypeOf = subtypeClusters.find(c => c.basetype === node.id);
  const isSubtypeOf = subtypeClusters.find(c => c.members.includes(node.id));

  const basetypeBadge = isBasetypeOf
    ? `<span class="badge badge-basetype" style="background:var(--badge-classifier-bg);color:var(--badge-classifier-fg)">basetype · ${isBasetypeOf.exclusive ? 'exclusive' : 'inclusive'}</span>`
    : '';

  const subtypeOfBadge = isSubtypeOf
    ? `<span class="badge badge-subtype-of" style="background:var(--badge-classifier-bg);color:var(--badge-classifier-fg)">of <a href="#entity-${esc(isSubtypeOf.basetype)}">${esc(isSubtypeOf.basetype)}</a></span>`
    : '';

  const subtypeList = isBasetypeOf
    ? `    <p class="subtype-list">Subtypes: ${isBasetypeOf.members.map(m => `<a href="#entity-${esc(m)}">${esc(m)}</a>`).join(', ')}</p>`
    : '';

  // Per-entity ⚠ triangle + <details> disclosure
  const nodeErrors = entityErrors.filter(e => e.entityId === node.id);
  const warningHtml = nodeErrors.length > 0 ? (() => {
    const items = nodeErrors.map(e => {
      const rule = RULES[e.ruleId];
      const title = rule ? esc(rule.title) : esc(e.ruleId);
      return `          <li><strong>${title}</strong> — ${esc(e.message)}</li>`;
    }).join('\n');
    return `
      <details class="dict-entity-warning">
        <summary>⚠ ${nodeErrors.length} issue${nodeErrors.length > 1 ? 's' : ''}</summary>
        <ul class="dict-entity-warning-detail">
${items}
        </ul>
      </details>`;
  })() : '';

  return `  <section class="entity-section" id="entity-${esc(node.id)}">
    <div class="entity-header">
      <h2>${esc(node.id)}</h2>
      ${classificationBadge(node.classification)}
      ${basetypeBadge}
      ${subtypeOfBadge}
      ${pkLabel}
    </div>${warningHtml}
${subtypeList}
${renderAttributesTable(node, edges, missingTargets)}
${renderRelationshipsTable(node, edges)}
    <div class="entity-body">${node.bodyHtml}</div>
  </section>`;
}

/**
 * Hierarchy ordering rules for entities within a group:
 *
 * Classifications treated as "independent": kernel, independent.
 * Everything else is "dependent" for tier purposes.
 *
 * 1. Independent basetype-clusters first.
 * 2. Dependent basetype-clusters second.
 * 3. Within a tier, clusters sorted alphabetically by basetype id.
 * 4. Within a cluster: basetype first, then subtypes alphabetical.
 * 5. Standalones (neither basetype nor subtype) treated as cluster-of-one;
 *    tier derived from their own classification.
 * 6. Orphan subtype (in members[] but basetype not in groupNodes): treated as
 *    cluster-of-one in the dependent tier.
 */
function sortGroupNodes(
  groupNodes: ModelNode[],
  subtypeClusters: SubtypeCluster[],
): ModelNode[] {
  const independentClassifications: Record<string, true> = {
    independent: true,
  };

  const nodeSet: Record<string, ModelNode> = {};
  for (const n of groupNodes) nodeSet[n.id] = n;

  // Only consider clusters whose basetype is in this group
  const relevantClusters = subtypeClusters.filter(c => nodeSet[c.basetype]);

  // Track which nodes are members (subtypes) of a cluster in this group
  const subtypeOf: Record<string, string> = {}; // member id → basetype id
  for (const c of relevantClusters) {
    for (const m of c.members) {
      subtypeOf[m] = c.basetype;
    }
  }

  // Build clusters: each cluster is { basetype node, subtype nodes (sorted) }
  type Cluster = { basetype: ModelNode; subtypes: ModelNode[] };
  const clusterMap: Record<string, Cluster> = {};

  for (const c of relevantClusters) {
    const basetypeNode = nodeSet[c.basetype];
    if (!basetypeNode) continue;
    const subtypeNodes = c.members
      .map(m => nodeSet[m])
      .filter((n): n is ModelNode => n !== undefined)
      .sort((a, b) => a.id.localeCompare(b.id));
    clusterMap[c.basetype] = { basetype: basetypeNode, subtypes: subtypeNodes };
  }

  // Standalones: nodes that are neither a basetype nor a member subtype in this group
  for (const n of groupNodes) {
    if (!clusterMap[n.id] && !subtypeOf[n.id]) {
      clusterMap[n.id] = { basetype: n, subtypes: [] };
    }
  }

  // Separate clusters into independent and dependent tiers
  const isIndependent = (n: ModelNode) =>
    (n.classification.toLowerCase() in independentClassifications);

  const independent: Cluster[] = [];
  const dependent: Cluster[] = [];

  for (const cluster of Object.values(clusterMap)) {
    if (isIndependent(cluster.basetype)) {
      independent.push(cluster);
    } else {
      dependent.push(cluster);
    }
  }

  independent.sort((a, b) => a.basetype.id.localeCompare(b.basetype.id));
  dependent.sort((a, b) => a.basetype.id.localeCompare(b.basetype.id));

  const ordered: ModelNode[] = [];
  for (const cluster of [...independent, ...dependent]) {
    ordered.push(cluster.basetype);
    ordered.push(...cluster.subtypes);
  }

  return ordered;
}

function renderGroupSection(
  groupKey: string,
  groupConfig: { label: string; color: string; desc?: string },
  nodes: ModelNode[],
  edges: ModelEdge[],
  subtypeClusters: SubtypeCluster[],
  entityErrors: EntityError[],
  missingTargets: Set<string>,
): string {
  const groupNodes = nodes.filter(n => n.group === groupKey);
  if (groupNodes.length === 0) return '';

  const entitiesHtml = sortGroupNodes(groupNodes, subtypeClusters)
    .map(n => renderEntitySection(n, edges, subtypeClusters, entityErrors, missingTargets))
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

/**
 * Generates the static side-nav markup. All entity links are resolved at
 * generation time; JS only handles open/close interactions.
 */
function renderSideNav(
  groupOrder: string[],
  groups: Model['groups'],
  nodes: ModelNode[],
  subtypeClusters: SubtypeCluster[],
): string {
  const sections = groupOrder.map(key => {
    const cfg = groups[key];
    if (!cfg) return '';
    const groupNodes = nodes.filter(n => n.group === key);
    if (groupNodes.length === 0) return '';
    const sorted = sortGroupNodes(groupNodes, subtypeClusters);
    // Determine which nodes are subtypes (not the basetype) of a cluster
    const subtypeIds: Record<string, true> = {};
    for (const c of subtypeClusters) {
      if (groupNodes.some(n => n.id === c.basetype)) {
        for (const m of c.members) subtypeIds[m] = true;
      }
    }
    const links = sorted.map(n => {
      const isSubtype = subtypeIds[n.id];
      const indent = isSubtype ? ' dict-nav-subtype' : '';
      return `      <a class="dict-nav-link${indent}" href="#entity-${esc(n.id)}">${esc(n.id)}</a>`;
    }).join('\n');
    return `    <div class="dict-nav-group">
      <div class="dict-nav-group-label" style="color:${cfg.color}">${esc(cfg.label)}</div>
${links}
    </div>`;
  }).filter(s => s.length > 0).join('\n');

  return `<nav class="dict-nav-panel" id="dict-nav-panel" aria-hidden="true" aria-label="Entity navigation">
  <div class="dict-nav-inner">
${sections}
  </div>
</nav>`;
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

function renderReaderLegend(groups: Model['groups']): string {
  const groupSwatches = Object.entries(groups)
    .map(([, cfg]) => `      <li class="legend-item">
        <span class="swatch" style="background:${cfg.color}"></span>
        <span class="legend-label">${esc(cfg.label)}</span>
      </li>`).join('\n');

  return `<details class="reader-legend" open>
  <summary class="reader-legend-summary">How to read this</summary>
  <div class="reader-legend-grid">
    <section class="reader-legend-cell">
      <h3>Groups</h3>
      <ul class="legend-list reader-legend-list">
${groupSwatches}
      </ul>
      <p class="reader-legend-note">Domain colors are shared with the graph viewer.</p>
    </section>

    <section class="reader-legend-cell">
      <h3>Classification</h3>
      <div class="reader-legend-badges">
        <span class="badge" style="background:var(--badge-independent-bg);color:var(--badge-independent-fg)">independent</span>
        <span class="badge" style="background:var(--badge-dependent-bg);color:var(--badge-dependent-fg)">dependent</span>
        <span class="badge" style="background:var(--badge-associative-bg);color:var(--badge-associative-fg)">associative</span>
        <span class="badge" style="background:var(--badge-subtype-bg);color:var(--badge-subtype-fg)">subtype</span>
        <span class="badge" style="background:var(--badge-classifier-bg);color:var(--badge-classifier-fg)">classifier / basetype</span>
      </div>
      <p class="reader-legend-note">Derived from the model — never authored directly.</p>
    </section>

    <section class="reader-legend-cell">
      <h3>Predicate pills</h3>
      <div class="reader-legend-pills">
        <span class="predicate-pill predicate-pill--primary">is owned by<span class="predicate-arrow">&rarr;</span></span>
        <span class="predicate-pill predicate-pill--inverse"><span class="predicate-arrow">&larr;</span>owns</span>
      </div>
      <p class="reader-legend-note">First pill completes the sentence with the child on the left of the row &mdash; "<em>child</em> is owned by <em>parent</em>". Second pill is the inverse, with the parent as subject &mdash; "<em>parent</em> owns <em>child</em>".</p>
    </section>

    <section class="reader-legend-cell">
      <h3>Relationship type</h3>
      <p class="reader-legend-note"><strong>Identifying</strong> &mdash; child's PK contains the parent's PK (existence depends on parent).<br><strong>Referential</strong> &mdash; child has an FK to the parent but its own identity is independent.</p>
    </section>

    <section class="reader-legend-cell">
      <h3>Cardinality</h3>
      <p class="reader-legend-note">Read as <code>parent &rarr; child</code>. <code>1 &rarr; many</code> = one parent row maps to many child rows. <code>0..1</code> means optional.</p>
    </section>
  </div>
</details>`;
}

export async function generateDict(
  model: Model,
  findings: { globalErrors: GlobalError[]; entityErrors: EntityError[] },
  mode: 'dark' | 'light',
  opts?: { modelsDir?: string; graphHref?: string },
): Promise<string> {
  const modelsDir = opts?.modelsDir ?? '.';
  const graphHref = opts?.graphHref;
  const branding = model.branding;

  const { globalErrors, entityErrors } = findings;

  // Build set of entity ids that are missing targets (from edge.unknown_target errors).
  // These are used to render FK links with dict-link-missing class and to generate
  // placeholder sections at the bottom of the page.
  const missingTargets = new Set(
    globalErrors
      .filter(e => e.ruleId === 'edge.unknown_target')
      .map(e => {
        // omitted.id format is "Source→Target"
        const arrow = e.omitted.id.indexOf('→');
        return arrow >= 0 ? e.omitted.id.slice(arrow + 1) : e.omitted.id;
      }),
  );

  // Inline only the active mode's logo to avoid embedding unused assets
  const activeLogo = mode === 'dark' ? branding.logo.dark : branding.logo.light;
  const fallback = mode === 'dark' ? defaultBranding.logo.dark : defaultBranding.logo.light;
  const logoSrc = await inlineAsset(activeLogo, modelsDir, fallback);

  const poweredByHtml = branding.poweredBy
    ? `<div class="dict-footer-powered">powered by <a href="https://noorm.dev" target="_blank" rel="noopener">Noorm</a></div>`
    : '';

  const darkCssVars = buildThemeCssVars(model.theme, 'dark');
  const lightCssVars = buildThemeCssVars(model.theme, 'light');
  const initialTheme = mode;
  const metaName = model._meta?.name ?? 'Data Dictionary';

  // Sort groups: sort_key numeric ascending first, then unsorted groups alphabetical by id.
  // Collision on same sort_key: stable secondary sort by group id alphabetical.
  const groupOrder = Object.keys(model.groups).sort((a, b) => {
    const skA = model.groups[a]?.sort_key;
    const skB = model.groups[b]?.sort_key;
    if (skA !== undefined && skB !== undefined) {
      return skA !== skB ? skA - skB : a.localeCompare(b);
    }
    if (skA !== undefined) return -1;
    if (skB !== undefined) return 1;
    return a.localeCompare(b);
  });

  // Nodes without a group go last
  const ungroupedNodes = model.nodes.filter(n => !n.group || !model.groups[n.group]);

  const groupSections = groupOrder
    .map(key => {
      const cfg = model.groups[key];
      if (!cfg) return '';
      return renderGroupSection(key, cfg, model.nodes, model.edges, model.subtypeClusters, entityErrors, missingTargets);
    })
    .filter(s => s.length > 0)
    .join('\n\n');

  const ungroupedSection = ungroupedNodes.length > 0
    ? ungroupedNodes
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(n => renderEntitySection(n, model.edges, model.subtypeClusters, entityErrors, missingTargets))
        .join('\n')
    : '';

  const legend = renderReaderLegend(model.groups);
  const sideNav = renderSideNav(groupOrder, model.groups, model.nodes, model.subtypeClusters);

  // Findings panel (top-right, mirrors graph viewer). Shows global + entity findings.
  const totalFindings = globalErrors.length + entityErrors.length;
  const findingsPanelHtml = totalFindings > 0 ? (() => {
    const globalRows = globalErrors.map(e => {
      const rule = RULES[e.ruleId];
      const title = rule ? esc(rule.title) : esc(e.ruleId);
      const omittedId = esc(e.omitted.id);
      const isMissingTarget = e.ruleId === 'edge.unknown_target';
      const idForLink = isMissingTarget && omittedId.indexOf('→') >= 0
        ? omittedId.slice(omittedId.indexOf('→') + 1)
        : omittedId;
      const href = isMissingTarget ? `#missing-${idForLink}` : '';
      const location = href
        ? `<a href="${href}">${esc(e.omitted.kind)}: ${omittedId}</a>`
        : `${esc(e.omitted.kind)}: ${omittedId}`;
      return `      <li>
        <div class="finding-title">${title}</div>
        <div class="finding-reason">${esc(e.reason)}</div>
        <div class="finding-location">${location}</div>
      </li>`;
    }).join('\n');
    const entityRows = entityErrors.map(e => {
      const rule = RULES[e.ruleId];
      const title = rule ? esc(rule.title) : esc(e.ruleId);
      return `      <li>
        <div class="finding-title">${title}</div>
        <div class="finding-reason">${esc(e.message)}</div>
        <div class="finding-location"><a href="#entity-${esc(e.entityId)}">${esc(e.entityId)}</a></div>
      </li>`;
    }).join('\n');
    return `  <aside class="dict-findings-panel" id="dict-findings-panel" role="complementary" aria-label="Findings">
    <header class="dict-findings-panel-header">
      <h3>Findings (${totalFindings})</h3>
      <button class="dict-findings-panel-collapse" id="dict-findings-collapse" aria-label="Collapse panel">−</button>
    </header>
    <ul class="dict-findings-panel-list">
${globalRows}
${entityRows}
    </ul>
  </aside>
  <button class="dict-findings-panel-badge" id="dict-findings-badge" style="display:none" aria-label="Expand findings">${totalFindings} finding${totalFindings === 1 ? '' : 's'}</button>`;
  })() : '';

  // Missing placeholder sections: one per unique missing target, placed at page bottom
  const missingSections = missingTargets.size > 0 ? [...missingTargets].map(id => `  <section id="missing-${esc(id)}" class="dict-missing-section">
    <h2>${esc(id)} (omitted)</h2>
    <p>This entity was referenced but does not exist in the model.</p>
  </section>`).join('\n') : '';

  return `<!doctype html>
<html lang="en" data-theme="${initialTheme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(metaName)}</title>
  <script>
    // Restore persisted theme before paint to avoid flash.
    try {
      var t = localStorage.getItem('ignatius-theme');
      if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    } catch (_) {}
  </script>
  <style>
    :root {
      --dict-branding-height: 72px;
    }
    :root[data-theme="dark"] {
      ${darkCssVars}
    }
    :root[data-theme="light"] {
      ${lightCssVars}
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--color-background);
      color: var(--color-text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      padding-top: var(--dict-branding-height);
      padding-right: 2rem;
      padding-bottom: 5rem;
      padding-left: 2rem;
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

    /* Reader legend — "How to read this" structured guide */
    .reader-legend {
      margin-bottom: 2rem;
      padding: 1rem 1.25rem;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
    }
    .reader-legend-summary {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      cursor: pointer;
      user-select: none;
      list-style: none;
    }
    .reader-legend-summary::-webkit-details-marker { display: none; }
    .reader-legend-summary::before {
      content: '▾ ';
      display: inline-block;
      margin-right: 4px;
      transition: transform 150ms;
    }
    .reader-legend:not([open]) .reader-legend-summary::before {
      transform: rotate(-90deg);
    }
    .reader-legend-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.25rem 1.5rem;
      margin-top: 1rem;
    }
    .reader-legend-cell h3 {
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.5rem;
    }
    .reader-legend-list { gap: 0.4rem 0.75rem; }
    .reader-legend-badges,
    .reader-legend-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 0.5rem;
    }
    .reader-legend-note {
      font-size: 0.78rem;
      color: var(--color-text-muted);
      line-height: 1.5;
      margin-top: 0.35rem;
    }
    .reader-legend-note code {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.75rem;
      padding: 1px 4px;
      background: var(--color-surface-alt);
      border-radius: 3px;
    }
    .reader-legend-note em {
      font-style: italic;
      color: var(--color-text);
    }
    @media print { .reader-legend { break-inside: avoid; } .reader-legend[open] .reader-legend-summary::before { content: ''; } }

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
      margin-bottom: 2rem;
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

    /* Predicate inline pills — rev first (reads naturally in downstream table), fwd second */
    .rel-table--predicates .predicate-cell {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .predicate-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.78rem;
      line-height: 1.4;
      background: var(--color-surface-alt);
      border: 1px solid var(--color-border);
      color: var(--color-text);
      white-space: nowrap;
    }
    .predicate-pill--primary {
      background: color-mix(in srgb, var(--color-link) 12%, var(--color-surface-alt));
      border-color: color-mix(in srgb, var(--color-link) 25%, var(--color-border));
    }
    .predicate-pill--inverse {
      background: var(--color-surface-alt);
      color: var(--color-text-muted);
    }
    .predicate-pill--shared {
      color: var(--color-text-muted);
    }
    .predicate-arrow {
      color: var(--color-text-muted);
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.85em;
    }

    /* Relationships heading */
    .rel-heading {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
      margin-top: 2rem;
    }

    /* Branding header — top-left, fixed, viewport-pinned */
    .dict-branding {
      position: fixed;
      top: 16px;
      left: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 100;
      pointer-events: none;
      padding: 8px 14px;
      border-radius: 10px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    .dict-branding-logo {
      width: 32px;
      height: 32px;
      object-fit: contain;
      flex-shrink: 0;
    }
    .dict-branding-text {
      display: flex;
      flex-direction: column;
    }
    .dict-branding-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text);
      line-height: 1.2;
    }
    .dict-branding-subtitle {
      font-size: 0.72rem;
      color: var(--color-text-muted);
      line-height: 1.2;
    }

    /* Footer — bottom-center, fixed, viewport-pinned */
    .dict-footer {
      position: fixed;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 6px 14px;
      border-radius: 10px;
      font-size: 0.72rem;
      color: var(--color-text-muted);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 100;
    }
    .dict-footer-copyright { line-height: 1.4; }
    .dict-footer-powered { line-height: 1.4; }
    .dict-footer-powered a { color: var(--color-link); text-decoration: none; }
    .dict-footer-powered a:hover { text-decoration: underline; }

    /* Subtype list (below entity header on basetype entities) */
    .subtype-list {
      font-size: 0.8rem;
      color: var(--color-text-muted);
      margin-bottom: 0.75rem;
    }
    .subtype-list a { color: inherit; text-decoration: underline; }

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

    /* ── Mobile responsive ────────────────────────────────────────────────── */
    @media (max-width: 768px) {
      :root {
        /* Branding is smaller on mobile (22px logo), so a reduced height suffices */
        --dict-branding-height: 52px;
      }

      body {
        /* Keep padding-top from --dict-branding-height; override sides and bottom */
        padding-top: var(--dict-branding-height);
        padding-right: 0.75rem;
        padding-bottom: 4rem;
        padding-left: 0.75rem;
      }

      /* Branding: shrink + move to top-right so it clears the page header */
      .dict-branding {
        top: 8px;
        left: auto;
        right: 8px;
        gap: 6px;
      }
      .dict-branding-logo {
        width: 22px;
        height: 22px;
      }
      .dict-branding-title {
        font-size: 0.75rem;
      }
      .dict-branding-subtitle {
        font-size: 0.65rem;
      }

      /* Group header: allow text to wrap, reduce padding */
      .group-header {
        padding: 0.75rem;
      }
      .group-title {
        font-size: 1.15rem;
      }

      /* Entity sections */
      .entity-section {
        padding: 0.85rem;
      }
      .entity-header {
        flex-wrap: wrap;
      }

      /* Tables: scroll within their container on narrow viewports */
      .attr-table, .rel-table {
        display: block;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        /* Prevent the table from pushing the page wider */
        max-width: 100%;
      }

      /* Legend: let items wrap naturally */
      .legend-list {
        gap: 0.65rem;
      }
    }

    /* Side nav toggle: superseded by FAB menu "Toggle sidebar" item. Kept in DOM
       (hidden) so existing aria/state JS continues to work without rewrites. */
    .dict-nav-toggle { display: none !important; }

    /* ── Side nav panel ──────────────────────────────────────────────────── */
    .dict-nav-panel {
      position: fixed;
      top: calc(var(--dict-branding-height) + 16px);
      right: 0;
      width: 280px;
      max-height: 80vh;
      overflow-y: auto;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-right: none;
      border-radius: 8px 0 0 8px;
      box-shadow: -2px 0 12px rgba(0, 0, 0, 0.15);
      z-index: 150;
      transform: translateX(100%);
      transition: transform 200ms ease;
    }
    .dict-nav-panel.dict-nav-open {
      transform: translateX(0);
    }
    .dict-nav-inner {
      padding: 0.75rem 0;
    }
    .dict-nav-group {
      padding: 0.5rem 0;
    }
    .dict-nav-group + .dict-nav-group {
      border-top: 1px solid var(--color-border);
    }
    .dict-nav-group-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 0.25rem 1rem 0.35rem;
    }
    .dict-nav-link {
      display: block;
      padding: 0.25rem 1rem;
      font-size: 0.82rem;
      color: var(--color-text-muted);
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dict-nav-link:hover {
      color: var(--color-text);
      background: var(--color-surface-alt);
    }
    .dict-nav-link.is-current {
      color: var(--color-text);
      background: var(--color-surface-alt);
      border-left: 3px solid var(--color-link);
      padding-left: calc(1rem - 3px);
      font-weight: 600;
    }
    .dict-nav-subtype {
      margin-left: 1rem;
      font-size: 0.78rem;
    }
    .dict-nav-subtype.is-current {
      margin-left: calc(1rem - 3px);
      padding-left: calc(1rem - 3px);
    }

    @media (max-width: 768px) {
      .dict-nav-toggle {
        display: none;
      }
      .dict-nav-panel {
        display: none;
      }
    }

    /* ── Print stylesheet ─────────────────────────────────────────────────── */
    @media print {
      /* Force light-mode CSS variables when printing, regardless of the theme
         used at generation time. Must match the runtime theme selectors
         (:root[data-theme="..."]) — those carry higher specificity than a bare
         :root, so a plain :root rule here would lose to the active dark palette.
         Listing all three at equal specificity + later source order wins. */
      :root,
      :root[data-theme="dark"],
      :root[data-theme="light"] {
        ${lightCssVars}
      }

      /* Reset body for print: no max-width cap, no decorative padding.
         Explicit padding-top: 0 overrides the --dict-branding-height variable. */
      body {
        background: #fff;
        color: #000;
        font-size: 11pt;
        padding: 0;
        max-width: none;
        margin: 0;
      }

      /* Fixed branding would repeat on every page — convert to static so it
         prints once at the top of the document with the rest of the flow. */
      .dict-branding {
        position: static;
        margin-bottom: 1rem;
        pointer-events: auto;
      }

      /* Fixed footer would repeat on every page — convert to static so the
         copyright line prints once at the end of the document. */
      .dict-footer {
        position: static;
        transform: none;
        border-top: 1px solid #ccc;
        margin-top: 2rem;
        padding: 0.5rem 0;
        background: transparent;
        text-align: center;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
      }

      /* Entity sections: avoid breaking a short section across pages.
         Oversize sections (with long tables) will still split naturally
         because the child tables do not have break-inside: avoid. */
      .entity-section {
        break-inside: avoid;
        border: 1px solid #ccc;
        background: transparent;
        margin-bottom: 1rem;
        page-break-inside: avoid; /* legacy alias for older print engines */
      }

      /* Group headers: keep with the first entity of the group */
      .group-section {
        break-before: auto;
      }
      .group-header {
        break-after: avoid;
        background: transparent;
        border-left-color: currentColor;
      }

      /* Preserve group color bands and key markers that carry meaning.
         Without this, Chromium strips background-color in print mode. */
      .group-header,
      .badge,
      .swatch {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }

      /* Expand table wrappers that were set to overflow-x: auto on mobile */
      .attr-table, .rel-table {
        display: table;
        overflow: visible;
        width: 100%;
      }

      /* Inline link URLs so printed copy is navigable without a browser.
         Choice: a::after injection. The Noorm powered-by link and any FK
         anchor targets will print their href beside the link text. */
      a::after {
        content: " (" attr(href) ")";
        font-size: 0.8em;
        color: #555;
        word-break: break-all;
      }

      /* Self-referential anchors (entity jump links, #id hrefs) are noisy
         in print — suppress them. Only suppress #-prefixed hrefs. */
      a[href^="#"]::after {
        content: "";
      }

      /* Suppress hover row highlight — no pointer in print */
      .attr-table tr:hover td,
      .rel-table tr:hover td {
        background: transparent;
      }

      /* Hide elements that have no value in a printed document */
      .legend { display: none; }

      /* Hide nav toggle and panel in print — not useful on paper */
      .dict-nav-toggle,
      .dict-nav-panel { display: none; }
    }

    /* ── Global error banner ─────────────────────────────────────────────── */
    .dict-global-banner {
      background: #7f1d1d;
      color: #fef2f2;
      border-bottom: 2px solid #991b1b;
      padding: 0.75rem 1.5rem;
      font-size: 0.85rem;
      line-height: 1.5;
    }
    .dict-global-banner-row {
      padding: 0.2rem 0;
    }
    .dict-global-banner-row strong {
      font-weight: 600;
    }
    .dict-global-banner-row em {
      color: #fca5a5;
      font-style: normal;
    }

    /* ── Per-entity warning disclosure ──────────────────────────────────── */
    .dict-entity-warning {
      margin: 0.5rem 0 0.75rem;
      font-size: 0.82rem;
    }
    .dict-entity-warning > summary {
      cursor: pointer;
      color: #f59e0b;
      font-weight: 600;
      user-select: none;
      list-style: none;
      padding: 0.2rem 0;
    }
    .dict-entity-warning > summary::-webkit-details-marker { display: none; }
    .dict-entity-warning[open] > summary { margin-bottom: 0.35rem; }
    .dict-entity-warning-detail {
      margin: 0;
      padding: 0 0 0 1.25rem;
      color: var(--color-text-muted);
      list-style: disc;
    }
    .dict-entity-warning-detail li {
      padding: 0.15rem 0;
    }
    .dict-entity-warning-detail li strong {
      color: var(--color-text);
      font-weight: 600;
    }

    /* ── Missing FK links ────────────────────────────────────────────────── */
    a.dict-link-missing {
      color: #f59e0b;
      text-decoration: underline dotted;
    }
    a.dict-link-missing:hover {
      color: #d97706;
    }

    /* ── Missing entity placeholder sections ────────────────────────────── */
    .dict-missing-section {
      background: var(--color-surface);
      border: 1px dashed #f59e0b;
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
      color: var(--color-text-muted);
    }
    .dict-missing-section h2 {
      font-size: 1.1rem;
      font-weight: 600;
      color: #f59e0b;
      margin-bottom: 0.5rem;
    }

    /* Theme toggle — top-right, mirrors graph viewer's theme toggle. */
    .dict-theme-toggle {
      position: fixed;
      top: 16px;
      right: 16px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      color: var(--color-text-muted);
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 50;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      transition: border-color 0.15s, color 0.15s;
      line-height: 1;
      font-family: inherit;
    }
    .dict-theme-toggle:hover { border-color: var(--color-link); color: var(--color-text); }
    @media print { .dict-theme-toggle { display: none; } }

    /* Findings panel — top-right, below theme toggle. Mirrors graph viewer. */
    .dict-findings-panel {
      position: fixed;
      top: 64px;
      right: 1rem;
      width: 360px;
      max-height: calc(100vh - 160px);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      z-index: 55;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .dict-findings-panel--collapsed {
      width: auto;
      max-height: none;
      background: transparent;
      border: none;
      box-shadow: none;
    }
    .dict-findings-panel-badge {
      background: #7f1d1d;
      color: #fecaca;
      border: 1px solid #991b1b;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      transition: background 0.15s;
    }
    .dict-findings-panel-badge:hover { background: #991b1b; }
    .dict-findings-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .dict-findings-panel-header h3 {
      font-size: 13px;
      font-weight: 600;
      color: #fca5a5;
      margin: 0;
    }
    .dict-findings-panel-collapse {
      background: none;
      border: none;
      color: var(--color-text-muted);
      font-size: 18px;
      cursor: pointer;
      line-height: 1;
      padding: 0 2px;
      font-family: inherit;
    }
    .dict-findings-panel-collapse:hover { color: var(--color-text); }
    .dict-findings-panel-list {
      list-style: none;
      padding: 0;
      margin: 0;
      overflow-y: auto;
      flex: 1;
    }
    .dict-findings-panel-list > li {
      padding: 8px 12px;
      border-bottom: 1px solid var(--color-surface-alt);
      font-size: 12px;
      color: var(--color-text);
    }
    .dict-findings-panel-list > li:last-child { border-bottom: none; }
    .dict-findings-panel-list .finding-title { font-weight: 600; }
    .dict-findings-panel-list .finding-reason { color: var(--color-text-muted); margin-top: 2px; }
    .dict-findings-panel-list .finding-location { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }
    .dict-findings-panel-list a { color: var(--color-link); text-decoration: none; }
    .dict-findings-panel-list a:hover { text-decoration: underline; }
    @media print { .dict-findings-panel { display: none; } }

    /* FAB — mirrors the graph viewer's floating action button. */
    .dict-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--color-surface);
      border: 2px solid var(--color-border);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      /* Above the side-nav panel (z-index 150) so the FAB and its menu stay
         reachable while the sidebar is open — otherwise the open panel occludes
         the "Toggle sidebar" item and the sidebar can't be closed via the FAB. */
      z-index: 200;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      transition: border-color 0.15s;
      color: var(--color-text-muted);
      text-decoration: none;
      font-family: inherit;
      padding: 0;
    }
    .dict-fab:hover { border-color: var(--color-link); color: var(--color-text); }
    .dict-fab.dict-fab--open { border-color: var(--color-link); }
    .dict-fab-dots {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
    }
    .dict-fab-dot {
      width: 8px;
      height: 8px;
      border-radius: 2px;
    }
    .dict-fab-icon {
      font-size: 20px;
      line-height: 1;
    }
    .dict-fab-menu {
      position: fixed;
      bottom: 80px;
      right: 24px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      display: none;
      flex-direction: column;
      min-width: 160px;
      z-index: 201;
      overflow: hidden;
    }
    .dict-fab-menu.dict-fab-menu--open { display: flex; }
    .dict-fab-menu-item {
      display: block;
      width: 100%;
      padding: 10px 14px;
      background: none;
      border: none;
      border-bottom: 1px solid var(--color-surface-alt);
      color: var(--color-text);
      font-size: 13px;
      font-weight: 500;
      text-align: left;
      cursor: pointer;
      text-decoration: none;
      font-family: inherit;
      transition: background 0.1s;
    }
    .dict-fab-menu-item:last-child { border-bottom: none; }
    .dict-fab-menu-item:hover, .dict-fab-menu-item:focus {
      background: var(--color-surface-alt);
      outline: none;
    }
    .dict-fab-copy-toast {
      position: fixed;
      bottom: 80px;
      right: 24px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 13px;
      color: var(--color-text);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      z-index: 60;
      pointer-events: none;
    }
    @media print { .dict-fab, .dict-fab-menu, .dict-fab-copy-toast { display: none !important; } }
  </style>
</head>
<body>
  <button class="dict-theme-toggle" id="dict-theme-toggle" title="Toggle theme" aria-label="Toggle theme">${initialTheme === 'dark' ? '☀' : '☾'}</button>
${findingsPanelHtml}
  <div class="dict-branding">
    <img class="dict-branding-logo" src="${logoSrc}" alt="${esc(branding.title)} logo">
    <div class="dict-branding-text">
      <span class="dict-branding-title">${esc(branding.title)}</span>
      <span class="dict-branding-subtitle">${esc(branding.subtitle)}</span>
    </div>
  </div>
  <button class="dict-nav-toggle" id="dict-nav-toggle" aria-label="Toggle entity navigation" aria-expanded="false">☰</button>
  ${sideNav}
  <header class="page-header">
    <h1 class="page-title">${esc(metaName)}</h1>
    ${legend}
  </header>
  <main>
${groupSections}
${ungroupedSection}
${missingSections}
  </main>
  <footer class="dict-footer">
    <div class="dict-footer-copyright">© ${branding.copyright.year} ${esc(branding.copyright.holder)}</div>
    ${poweredByHtml}
  </footer>
  ${(() => {
    const dots = Object.entries(model.groups).slice(0, 4)
      .map(([, cfg]) => `<span class="dict-fab-dot" style="background:${cfg.color}"></span>`)
      .join('');
    const body = dots
      ? `<span class="dict-fab-dots">${dots}</span>`
      : `<span class="dict-fab-icon">⋯</span>`;
    const graphItem = graphHref
      ? `      <a class="dict-fab-menu-item" href="${esc(graphHref)}" role="menuitem">Data Graph</a>`
      : '';
    return `<button class="dict-fab" id="dict-fab" title="Actions" aria-expanded="false" aria-haspopup="true">${body}</button>
  <div class="dict-fab-menu" id="dict-fab-menu" role="menu">
      <button class="dict-fab-menu-item" data-action="toggle-sidebar" role="menuitem">Toggle sidebar</button>
      <button class="dict-fab-menu-item" data-action="copy-link" role="menuitem">Copy link</button>
${graphItem}
  </div>`;
  })()}
  <script>
    (function () {
      var STORAGE_KEY = 'ignatius-dict-nav';
      var toggle = document.getElementById('dict-nav-toggle');
      var panel = document.getElementById('dict-nav-panel');
      if (!toggle || !panel) return;

      function isOpen() {
        return panel.classList.contains('dict-nav-open');
      }

      function open() {
        panel.classList.add('dict-nav-open');
        panel.setAttribute('aria-hidden', 'false');
        toggle.setAttribute('aria-expanded', 'true');
        try { localStorage.setItem(STORAGE_KEY, 'open'); } catch (_) {}
      }

      function close() {
        panel.classList.remove('dict-nav-open');
        panel.setAttribute('aria-hidden', 'true');
        toggle.setAttribute('aria-expanded', 'false');
        try { localStorage.setItem(STORAGE_KEY, 'closed'); } catch (_) {}
      }

      // Restore persisted state on load
      try {
        if (localStorage.getItem(STORAGE_KEY) === 'open') open();
      } catch (_) {}

      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isOpen()) close(); else open();
      });

      // Sidebar stays open until the user explicitly closes it via the FAB
      // "Toggle sidebar" item — no auto-close on outside-click or nav-link-click.
      // Esc still closes as a keyboard affordance for accessibility.
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen()) close();
      });

      // ── Scrollspy via IntersectionObserver ─────────────────────────────────
      // Build a Map from entity section id → its nav anchor element.
      var navLinks = document.querySelectorAll('.dict-nav-link');
      var navMap = {};
      for (var i = 0; i < navLinks.length; i++) {
        var link = navLinks[i];
        var href = link.getAttribute('href');
        if (href && href.startsWith('#')) {
          navMap[href.slice(1)] = link;
        }
      }

      // Track which sections are currently intersecting.
      var intersecting = {};
      var currentNavLink = null;

      function updateCurrent() {
        // Among all currently intersecting sections, pick the topmost one
        // (smallest boundingClientRect.top that is >= 0, or least negative).
        // Iterate the intersecting set directly — no DOM re-query needed.
        var ids = Object.keys(intersecting);
        var bestId = null;
        var bestTop = Infinity;
        for (var j = 0; j < ids.length; j++) {
          var id = ids[j];
          var sec = document.getElementById(id);
          if (sec) {
            var rect = sec.getBoundingClientRect();
            if (rect.top < bestTop) {
              bestTop = rect.top;
              bestId = id;
            }
          }
        }

        var nextLink = bestId ? navMap[bestId] : null;
        if (nextLink === currentNavLink) return;

        if (currentNavLink) currentNavLink.classList.remove('is-current');
        if (nextLink) {
          nextLink.classList.add('is-current');
          // Keep the current entry in view within the scrollable panel
          nextLink.scrollIntoView({ block: 'nearest' });
        }
        currentNavLink = nextLink;
      }

      // rootMargin "0px 0px -66% 0px": a section becomes intersecting only
      // when its top has entered the upper third of the viewport.
      if (typeof IntersectionObserver !== 'undefined') {
        var observer = new IntersectionObserver(function (entries) {
          for (var k = 0; k < entries.length; k++) {
            var entry = entries[k];
            if (entry.isIntersecting) {
              intersecting[entry.target.id] = true;
            } else {
              delete intersecting[entry.target.id];
            }
          }
          updateCurrent();
        }, { rootMargin: '0px 0px -66% 0px' });

        var entitySections = document.querySelectorAll('.entity-section');
        for (var s = 0; s < entitySections.length; s++) {
          if (entitySections[s].id) observer.observe(entitySections[s]);
        }
      }
    })();

    // ── Theme toggle ─────────────────────────────────────────────────────
    (function () {
      var THEME_KEY = 'ignatius-theme';
      var btn = document.getElementById('dict-theme-toggle');
      if (!btn) return;
      function currentTheme() {
        return document.documentElement.getAttribute('data-theme') || 'dark';
      }
      function paintGlyph() {
        btn.textContent = currentTheme() === 'dark' ? '☀' : '☾';
      }
      paintGlyph();
      btn.addEventListener('click', function () {
        var next = currentTheme() === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
        paintGlyph();
      });
    })();

    // ── Findings panel collapse/expand ───────────────────────────────────
    (function () {
      var panel = document.getElementById('dict-findings-panel');
      var badge = document.getElementById('dict-findings-badge');
      var collapseBtn = document.getElementById('dict-findings-collapse');
      if (!panel || !badge || !collapseBtn) return;
      function collapse() {
        panel.style.display = 'none';
        badge.style.display = '';
      }
      function expand() {
        panel.style.display = '';
        badge.style.display = 'none';
      }
      collapseBtn.addEventListener('click', collapse);
      badge.addEventListener('click', expand);
    })();

    // ── FAB menu ─────────────────────────────────────────────────────────
    (function () {
      var fab = document.getElementById('dict-fab');
      var menu = document.getElementById('dict-fab-menu');
      var navToggleEl = document.getElementById('dict-nav-toggle');
      if (!fab || !menu) return;
      function isOpen() { return menu.classList.contains('dict-fab-menu--open'); }
      function open() {
        menu.classList.add('dict-fab-menu--open');
        fab.classList.add('dict-fab--open');
        fab.setAttribute('aria-expanded', 'true');
      }
      function close() {
        menu.classList.remove('dict-fab-menu--open');
        fab.classList.remove('dict-fab--open');
        fab.setAttribute('aria-expanded', 'false');
      }
      fab.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isOpen()) close(); else open();
      });
      document.addEventListener('click', function (e) {
        if (!isOpen()) return;
        if (!fab.contains(e.target) && !menu.contains(e.target)) close();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen()) close();
      });

      menu.addEventListener('click', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('.dict-fab-menu-item') : null;
        if (!item) return;
        e.stopPropagation();
        var action = item.getAttribute('data-action');
        if (action === 'toggle-sidebar') {
          if (navToggleEl) navToggleEl.click();
          close();
        } else if (action === 'copy-link') {
          var href = window.location.href;
          var doneClose = function () {
            close();
            var toast = document.createElement('div');
            toast.className = 'dict-fab-copy-toast';
            toast.textContent = 'Copied!';
            document.body.appendChild(toast);
            setTimeout(function () { toast.remove(); }, 1200);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(href).then(doneClose, doneClose);
          } else {
            try {
              var ta = document.createElement('textarea');
              ta.value = href;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              ta.remove();
            } catch (_) {}
            doneClose();
          }
        }
        // Plain links (Data Graph) follow href naturally; menu closes on navigation.
      });
    })();
  </script>
</body>
</html>`;
}
