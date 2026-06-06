/**
 * flow-dict.ts — Process dictionary generator for SSADM flow diagrams.
 *
 * Parallel to src/generators/dict.ts: mirrors its HTML structure, class names,
 * theme toggle, findings panel, FAB, and escaping conventions.
 *
 * Pure string generation — no Bun I/O.
 */

import type { Model } from '../parse';
import type { GlobalError } from '../validate';
import { RULES } from '../validate';
import { buildThemeCssVars } from './theme-css';
import type { FlowModel, FlowDiagram, FlowProcess, FlowStoreRef, FlowEdge, FlowEndpoint } from '../flow-parse';
import type { FlowError } from '../flow-validate';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FlowDictFindings = {
    flowErrors: FlowError[];
    globalErrors: GlobalError[];
};

export type FlowDictOpts = {
    themeMode?: 'dark' | 'light';
    graphHref?: string;
};

// ---------------------------------------------------------------------------
// HTML escaping — same as dict.ts
// ---------------------------------------------------------------------------

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Kind markers — per-kind short labels for the inputs/outputs table
// ---------------------------------------------------------------------------

const KIND_MARKERS: Record<string, string> = {
    db: 'D',
    cache: 'C',
    queue: 'Q',
    file: 'F',
    doc: 'Do',
    manual: 'M',
    ext: '',
    proc: '',
};

function kindMarker(ep: FlowEndpoint, processes: FlowProcess[]): string {
    if (ep.kind === 'proc') {
        // Render the process's dottedNumber as the marker
        const proc = processes.find(p => p.id === ep.name);
        return proc ? esc(proc.dottedNumber) : esc(ep.name);
    }
    if (ep.kind === 'ext') return '';
    return KIND_MARKERS[ep.kind] ?? esc(ep.kind);
}

// ---------------------------------------------------------------------------
// Inputs/outputs table
// ---------------------------------------------------------------------------

function renderFlowTable(
    process: FlowProcess,
    allProcesses: FlowProcess[],
    entityModel: Model,
    mode: 'static' | 'live',
    graphHref: string | undefined,
): string {
    if (process.inputs.length === 0 && process.outputs.length === 0) {
        return '<p class="flow-no-flows">No flows defined for this process.</p>';
    }

    const rows: string[] = [];

    function buildRows(edges: FlowEdge[], direction: 'in' | 'out'): void {
        for (const edge of edges) {
            // The "other" endpoint (not the process itself)
            const otherEp = direction === 'in' ? edge.from : edge.to;
            const marker = kindMarker(otherEp, allProcesses);
            const endpointLabel = esc(otherEp.name);
            const dirLabel = direction === 'in' ? 'in' : 'out';

            if (otherEp.kind === 'db') {
                // db: flows carry columns — render one row per column with entity-anchor href
                const entityId = otherEp.name;
                const entityHref = mode === 'static'
                    ? `dict.html#entity-${esc(entityId)}`
                    : `${esc(graphHref ?? '')}#entity-${esc(entityId)}`;
                const entityLink = `<a href="${entityHref}">${esc(entityId)}</a>`;

                const dataColumns = Array.isArray(edge.data)
                    ? edge.data
                    : edge.data.length > 0 ? [edge.data] : [];

                if (dataColumns.length === 0) {
                    rows.push(`      <tr>
        <td>${entityLink}</td>
        <td><span class="flow-kind-marker flow-kind-marker--db">${marker}</span></td>
        <td>—</td>
        <td>${dirLabel}</td>
      </tr>`);
                } else {
                    for (const col of dataColumns) {
                        // Check if the column exists in the entity for linking
                        const node = entityModel.nodes.find(n => n.id === entityId);
                        const colExists = node !== undefined &&
                            (node.pk.includes(col) || Object.keys(node.columns).includes(col));
                        const colCell = colExists
                            ? `<a href="${entityHref}"><code>${esc(col)}</code></a>`
                            : `<code class="flow-col-unknown">${esc(col)}</code>`;

                        rows.push(`      <tr>
        <td>${entityLink}</td>
        <td><span class="flow-kind-marker flow-kind-marker--db">${marker}</span></td>
        <td>${colCell}</td>
        <td>${dirLabel}</td>
      </tr>`);
                    }
                }
            } else {
                // Non-db: opaque label
                const dataLabel = Array.isArray(edge.data)
                    ? edge.data.map(esc).join(', ')
                    : esc(edge.data);
                const markerCell = marker
                    ? `<span class="flow-kind-marker">${marker}</span>`
                    : `<span class="flow-kind-ext">${esc(otherEp.kind)}</span>`;
                rows.push(`      <tr>
        <td>${endpointLabel}</td>
        <td>${markerCell}</td>
        <td>${dataLabel || '—'}</td>
        <td>${dirLabel}</td>
      </tr>`);
            }
        }
    }

    buildRows(process.inputs, 'in');
    buildRows(process.outputs, 'out');

    return `    <div class="flow-table-wrap">
      <table class="flow-io-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Kind</th>
            <th>Data</th>
            <th>Direction</th>
          </tr>
        </thead>
        <tbody>
${rows.join('\n')}
        </tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// Store section — renders non-db store descriptions
// ---------------------------------------------------------------------------

function renderStoreSections(storeRefs: FlowStoreRef[]): string {
    const nonDb = storeRefs.filter(s => s.kind !== 'db' && s.bodyHtml !== undefined);
    if (nonDb.length === 0) return '';

    const sections = nonDb.map(store => {
        const kindLabel = esc(store.kind.toUpperCase());
        const nameLabel = esc(store.name);
        return `  <section class="flow-store-section">
    <div class="flow-store-header">
      <span class="flow-store-kind">${kindLabel}</span>
      <h3 class="flow-store-name">${nameLabel}</h3>
    </div>
    <div class="flow-store-body">${store.bodyHtml}</div>
  </section>`;
    });

    return `<div class="flow-stores">
${sections.join('\n')}
</div>`;
}

// ---------------------------------------------------------------------------
// Per-process warning disclosure — mirrors dict.ts renderEntitySection
// ---------------------------------------------------------------------------

function renderProcessWarnings(processId: string, flowErrors: FlowError[]): string {
    const procErrors = flowErrors.filter(e => e.processId === processId);
    if (procErrors.length === 0) return '';

    const items = procErrors.map(e => {
        const rule = RULES[e.ruleId];
        const title = rule ? esc(rule.title) : esc(e.ruleId);
        return `          <li><strong>${title}</strong> — ${esc(e.message)}</li>`;
    }).join('\n');

    return `
      <details class="dict-entity-warning">
        <summary>⚠ ${procErrors.length} issue${procErrors.length > 1 ? 's' : ''}</summary>
        <ul class="dict-entity-warning-detail">
${items}
        </ul>
      </details>`;
}

// ---------------------------------------------------------------------------
// Per-process section
// ---------------------------------------------------------------------------

function renderProcessSection(
    process: FlowProcess,
    allProcesses: FlowProcess[],
    entityModel: Model,
    flowErrors: FlowError[],
    mode: 'static' | 'live',
    graphHref: string | undefined,
): string {
    const warningHtml = renderProcessWarnings(process.id, flowErrors);
    const tableHtml = renderFlowTable(process, allProcesses, entityModel, mode, graphHref);

    const bodySection = process.bodyHtml
        ? `    <div class="flow-process-body">${process.bodyHtml}</div>`
        : '';

    return `  <section class="flow-process-section" id="process-${esc(process.id)}">
    <div class="flow-process-header">
      <span class="flow-dotted-number">${esc(process.dottedNumber)}</span>
      <h2 class="flow-process-label">${esc(process.label)}</h2>
    </div>${warningHtml}
${tableHtml}
${bodySection}
  </section>`;
}

// ---------------------------------------------------------------------------
// Findings panel — same structure/classes as generateDict's findings panel
// ---------------------------------------------------------------------------

function renderFindingsPanel(findings: FlowDictFindings): string {
    const { flowErrors, globalErrors } = findings;
    const totalFindings = globalErrors.length + flowErrors.length;
    if (totalFindings === 0) return '';

    const globalRows = globalErrors.map(e => {
        const rule = RULES[e.ruleId];
        const title = rule ? esc(rule.title) : esc(e.ruleId);
        return `      <li>
        <div class="finding-title">${title}</div>
        <div class="finding-reason">${esc(e.reason)}</div>
        <div class="finding-location">${esc(e.omitted.kind)}: ${esc(e.omitted.id)}</div>
      </li>`;
    }).join('\n');

    const flowRows = flowErrors.map(e => {
        const rule = RULES[e.ruleId];
        const title = rule ? esc(rule.title) : esc(e.ruleId);
        const location = e.processId
            ? `<a href="#process-${esc(e.processId)}">${esc(e.flowId)} / ${esc(e.processId)}</a>`
            : esc(e.flowId);
        return `      <li>
        <div class="finding-title">${title}</div>
        <div class="finding-reason">${esc(e.message)}</div>
        <div class="finding-location">${location}</div>
      </li>`;
    }).join('\n');

    return `  <aside class="dict-findings-panel" id="dict-findings-panel" role="complementary" aria-label="Findings">
    <header class="dict-findings-panel-header">
      <h3>Findings (${totalFindings})</h3>
      <button class="dict-findings-panel-collapse" id="dict-findings-collapse" aria-label="Collapse panel">−</button>
    </header>
    <ul class="dict-findings-panel-list">
${globalRows}
${flowRows}
    </ul>
  </aside>
  <button class="dict-findings-panel-badge" id="dict-findings-badge" style="display:none" aria-label="Expand findings">${totalFindings} finding${totalFindings === 1 ? '' : 's'}</button>`;
}

// ---------------------------------------------------------------------------
// Side nav — process list, grouped by DFD when multiple diagrams
// ---------------------------------------------------------------------------

function renderSideNav(diagrams: FlowDiagram[]): string {
    const allProcesses = diagrams.flatMap(d => d.processes);
    if (allProcesses.length === 0) return '';

    const groups = diagrams.map(diagram => {
        if (diagram.processes.length === 0) return '';
        const links = diagram.processes.map(p =>
            `      <a class="dict-nav-link" href="#process-${esc(p.id)}">${esc(p.dottedNumber)} ${esc(p.label)}</a>`,
        ).join('\n');
        const groupLabel = diagrams.length > 1
            ? `<div class="dict-nav-group-label">${esc(diagram.id)}</div>`
            : `<div class="dict-nav-group-label">Processes</div>`;
        return `    <div class="dict-nav-group">
      ${groupLabel}
${links}
    </div>`;
    }).filter(g => g.length > 0).join('\n');

    return `<nav class="dict-nav-panel" id="dict-nav-panel" aria-hidden="true" aria-label="Process navigation">
  <div class="dict-nav-inner">
${groups}
  </div>
</nav>`;
}

// ---------------------------------------------------------------------------
// FAB — same structure as generateDict's FAB
// ---------------------------------------------------------------------------

function renderFab(graphHref: string | undefined): string {
    const graphItem = graphHref
        ? `      <a class="dict-fab-menu-item" href="${esc(graphHref)}" role="menuitem">Data Graph</a>`
        : '';
    return `<button class="dict-fab" id="dict-fab" title="Actions" aria-expanded="false" aria-haspopup="true"><span class="dict-fab-icon">⋯</span></button>
  <div class="dict-fab-menu" id="dict-fab-menu" role="menu">
      <button class="dict-fab-menu-item" data-action="toggle-sidebar" role="menuitem">Toggle sidebar</button>
      <button class="dict-fab-menu-item" data-action="copy-link" role="menuitem">Copy link</button>
${graphItem}
  </div>`;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generateFlowDict(
    flowModel: FlowModel,
    entityModel: Model,
    findings: FlowDictFindings,
    mode: 'static' | 'live',
    opts?: FlowDictOpts,
): string {
    const themeMode = opts?.themeMode ?? 'dark';
    const graphHref = opts?.graphHref;

    const darkCssVars = buildThemeCssVars(entityModel.theme, 'dark');
    const lightCssVars = buildThemeCssVars(entityModel.theme, 'light');

    const findingsPanelHtml = renderFindingsPanel(findings);
    const sideNav = renderSideNav(flowModel.diagrams);
    // Aggregate store refs across all diagrams for the store sections
    const allStoreRefs = flowModel.diagrams.flatMap(d => d.storeRefs);
    const storeSectionsHtml = renderStoreSections(allStoreRefs);
    const fabHtml = renderFab(graphHref);

    // Render a section per DFD, with each process inside it.
    const diagramSections = flowModel.diagrams.map(diagram => {
        const processSections = diagram.processes
            .map(proc => renderProcessSection(proc, diagram.processes, entityModel, findings.flowErrors, mode, graphHref))
            .join('\n\n');
        const heading = flowModel.diagrams.length > 1
            ? `  <h2 class="flow-dfd-heading" id="dfd-${esc(diagram.id)}">${esc(diagram.id)}</h2>`
            : '';
        return `${heading}\n${processSections}`;
    }).join('\n\n');

    const title = 'Process Dictionary';

    return `<!doctype html>
<html lang="en" data-theme="${themeMode}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <script>
    // Restore persisted theme before paint to avoid flash.
    try {
      var t = localStorage.getItem('ignatius-theme');
      if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    } catch (_) {}
  </script>
  <style>
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
      padding: 2rem;
      padding-bottom: 5rem;
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
    }

    /* DFD section heading (multi-DFD model only) */
    .flow-dfd-heading {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text);
      margin: 2rem 0 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid var(--color-border);
    }

    /* Process sections */
    .flow-process-section {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .flow-process-header {
      display: flex;
      align-items: baseline;
      gap: 0.75rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    .flow-dotted-number {
      font-size: 1rem;
      font-weight: 700;
      color: var(--color-text-muted);
      font-variant-numeric: tabular-nums;
    }
    .flow-process-label {
      font-size: 1.2rem;
      font-weight: 600;
      color: var(--color-text);
    }

    /* Inputs/outputs table */
    .flow-table-wrap {
      max-width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin-bottom: 1rem;
    }
    .flow-io-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .flow-io-table th {
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
    .flow-io-table td {
      padding: 0.35rem 0.6rem;
      border-bottom: 1px solid var(--color-border);
      color: var(--color-text);
      vertical-align: top;
    }
    .flow-io-table tr:last-child td { border-bottom: none; }
    .flow-io-table tr:hover td { background: var(--color-surface-alt); }

    .flow-kind-marker {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 0.1em 0.4em;
      border-radius: 3px;
      background: var(--color-surface-alt);
      border: 1px solid var(--color-border);
      letter-spacing: 0.04em;
    }
    .flow-kind-marker--db {
      background: color-mix(in srgb, var(--color-link) 10%, var(--color-surface-alt));
      border-color: color-mix(in srgb, var(--color-link) 20%, var(--color-border));
    }
    .flow-kind-ext { color: var(--color-text-muted); font-size: 0.75rem; }
    .flow-col-unknown { color: #f59e0b; }
    .flow-no-flows { color: var(--color-text-muted); font-size: 0.85rem; padding: 0.5rem 0; }

    /* Process body */
    .flow-process-body {
      border-top: 1px solid var(--color-border);
      padding-top: 0.75rem;
      margin-top: 0.75rem;
      color: var(--color-text-muted);
      font-size: 0.88rem;
    }
    .flow-process-body p { margin-bottom: 0.5rem; }
    .flow-process-body ul, .flow-process-body ol { padding-left: 1.25rem; margin-bottom: 0.5rem; }

    /* Store sections */
    .flow-stores { margin-bottom: 2rem; }
    .flow-store-section {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
    }
    .flow-store-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .flow-store-kind {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 0.1em 0.5em;
      border-radius: 3px;
      background: var(--color-surface-alt);
      border: 1px solid var(--color-border);
      color: var(--color-text-muted);
      letter-spacing: 0.04em;
    }
    .flow-store-name { font-size: 1rem; font-weight: 600; color: var(--color-text); }
    .flow-store-body { color: var(--color-text-muted); font-size: 0.88rem; }
    .flow-store-body p { margin-bottom: 0.25rem; }

    /* Per-process warning disclosure — mirrors dict.ts */
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
    .dict-entity-warning-detail li { padding: 0.15rem 0; }
    .dict-entity-warning-detail li strong {
      color: var(--color-text);
      font-weight: 600;
    }

    /* Theme toggle — top-right, mirrors dict.ts */
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

    /* Findings panel — top-right, below theme toggle. Same as dict.ts. */
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
    .dict-findings-panel-list .finding-location {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 11px;
      color: var(--color-text-muted);
      margin-top: 2px;
    }
    .dict-findings-panel-list a { color: var(--color-link); text-decoration: none; }
    .dict-findings-panel-list a:hover { text-decoration: underline; }
    @media print { .dict-findings-panel { display: none; } }

    /* Side nav — same as dict.ts */
    .dict-nav-panel {
      position: fixed;
      top: 64px;
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
    .dict-nav-panel.dict-nav-open { transform: translateX(0); }
    .dict-nav-inner { padding: 0.75rem 0; }
    .dict-nav-group { padding: 0.5rem 0; }
    .dict-nav-group-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 0.25rem 1rem 0.35rem;
      color: var(--color-text-muted);
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
    .dict-nav-link:hover { color: var(--color-text); background: var(--color-surface-alt); }

    /* FAB — same as dict.ts */
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
    .dict-fab-icon { font-size: 20px; line-height: 1; }
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
    @media print { .dict-fab, .dict-fab-menu { display: none !important; } }
  </style>
</head>
<body>
  <button class="dict-theme-toggle" id="dict-theme-toggle" title="Toggle theme" aria-label="Toggle theme">${themeMode === 'dark' ? '☀' : '☾'}</button>
${findingsPanelHtml}
  ${sideNav}
  <header class="page-header">
    <h1 class="page-title">Process Dictionary</h1>
  </header>
  <main>
${diagramSections}
${storeSectionsHtml}
  </main>
  ${fabHtml}
  <script>
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
          var doneClose = function () { close(); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(href).then(doneClose, doneClose);
          } else {
            doneClose();
          }
        }
      });
    })();

    // ── Side nav toggle ──────────────────────────────────────────────────
    (function () {
      var STORAGE_KEY = 'ignatius-flow-dict-nav';
      var panel = document.getElementById('dict-nav-panel');
      if (!panel) return;
      function isOpen() { return panel.classList.contains('dict-nav-open'); }
      function open() {
        panel.classList.add('dict-nav-open');
        panel.setAttribute('aria-hidden', 'false');
        try { localStorage.setItem(STORAGE_KEY, 'open'); } catch (_) {}
      }
      function close() {
        panel.classList.remove('dict-nav-open');
        panel.setAttribute('aria-hidden', 'true');
        try { localStorage.setItem(STORAGE_KEY, 'closed'); } catch (_) {}
      }
      try {
        if (localStorage.getItem(STORAGE_KEY) === 'open') open();
      } catch (_) {}
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen()) close();
      });
    })();
  </script>
</body>
</html>`;
}
