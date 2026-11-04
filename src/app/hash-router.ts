// Hash-router: pure parse + serialize for URL hash state.
// Format: #view=<graph|dict|flow>&entity=<id>&zoom=<n>&pan=<x>,<y>&dfd=<diagram-ref>&flowview=<per-process|connected>&collapse=<stores|clusters|groups>&section=<kind>:<id>&node=<token>
// All params are optional. Unknown/malformed values are silently dropped.

export type ViewName = 'graph' | 'dict' | 'flow';
export type FlowViewMode = 'per-process' | 'connected';
export type FlowCollapseLevel = 'stores' | 'clusters' | 'groups';

/**
 * The next level in the collapse-level FAB control's cycle: stores → clusters
 * → groups → stores. A `switch` over the closed union, not array indexing —
 * exhaustive and provably total, so it needs no non-null assertion.
 */
export function nextCollapseLevel(level: FlowCollapseLevel): FlowCollapseLevel {
  switch (level) {
    case 'stores': return 'clusters';
    case 'clusters': return 'groups';
    case 'groups': return 'stores';
  }
}

const VALID_VIEWS: Record<string, ViewName> = { graph: 'graph', dict: 'dict', flow: 'flow' };
const VALID_FLOW_VIEWS: Record<string, FlowViewMode> = { 'per-process': 'per-process', connected: 'connected' };
const VALID_COLLAPSE_LEVELS: Record<string, FlowCollapseLevel> = { stores: 'stores', clusters: 'clusters', groups: 'groups' };

export interface HashState {
  view?: ViewName;
  entity?: string;
  zoom?: number;
  pan?: { x: number; y: number };
  /** Active flow diagram reference (a bare id, or an id path such as `invoicing/Submit-PCI`) — only meaningful when view === 'flow'. */
  dfd?: string;
  /** Per-process vs. connected rendering — global setting, deep-linkable per docs/spec/dfd-store-clusters.md. */
  flowview?: FlowViewMode;
  /** Stack row breakdown level — global setting, deep-linkable per docs/spec/dfd-store-clusters.md. */
  collapse?: FlowCollapseLevel;
  /** The Dictionary section in view, `<kind>:<id>` (`process:Create-Sales-Order`). */
  section?: string;
  /** The open flow-node dialog's token (`proc:Collect-Payment`, `ext:Customer`, `queue:Order-Intake`). */
  node?: string;
}

const SECTION = /^(entity|process|external|store):(.+)$/;

/** A `section=` value split into the Dictionary anchor kind and id, or null when malformed. */
export function splitSection(section: string): { kind: string; id: string } | null {
  const match = SECTION.exec(section);
  return match && match[1] && match[2] ? { kind: match[1], id: match[2] } : null;
}

/**
 * Parse a URL hash string (e.g. "#entity=Party&zoom=1.5&pan=200,100") into
 * a HashState. The leading '#' is optional. Invalid numerics are dropped.
 */
export function parseHash(hash: string): HashState {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return {};

  const params = new URLSearchParams(raw);
  const state: HashState = {};

  const viewVal = params.get('view');
  if (viewVal !== null && viewVal in VALID_VIEWS) {
    state.view = VALID_VIEWS[viewVal];
  }

  const entityVal = params.get('entity');
  if (entityVal !== null && entityVal.length > 0) {
    state.entity = entityVal;
  }

  const zoomVal = params.get('zoom');
  if (zoomVal !== null) {
    const n = Number(zoomVal);
    if (Number.isFinite(n)) state.zoom = n;
  }

  const panVal = params.get('pan');
  if (panVal !== null) {
    const parts = panVal.split(',');
    if (parts.length === 2) {
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        state.pan = { x, y };
      }
    }
  }

  const dfdVal = params.get('dfd');
  if (dfdVal !== null && dfdVal.length > 0) {
    state.dfd = decodeURIComponent(dfdVal);
  }

  const flowviewVal = params.get('flowview');
  if (flowviewVal !== null && flowviewVal in VALID_FLOW_VIEWS) {
    state.flowview = VALID_FLOW_VIEWS[flowviewVal];
  }

  const collapseVal = params.get('collapse');
  if (collapseVal !== null && collapseVal in VALID_COLLAPSE_LEVELS) {
    state.collapse = VALID_COLLAPSE_LEVELS[collapseVal];
  }

  const sectionVal = params.get('section');
  if (sectionVal !== null && splitSection(sectionVal) !== null) {
    state.section = sectionVal;
  }

  const nodeVal = params.get('node');
  if (nodeVal !== null && nodeVal.includes(':')) {
    state.node = nodeVal;
  }

  return state;
}

/**
 * Serialize a HashState into a query string (without the leading '#').
 * Returns '' for an empty state. Built manually to keep pan=x,y human-readable
 * (URLSearchParams would percent-encode the comma to %2C).
 */
export function serializeHash(state: HashState): string {
  const parts: string[] = [];

  if (state.view !== undefined) {
    parts.push(`view=${state.view}`);
  }

  if (state.entity !== undefined) {
    // encodeURIComponent: entity ids may contain spaces or unicode; numbers don't need it.
    parts.push(`entity=${encodeURIComponent(state.entity)}`);
  }
  if (state.zoom !== undefined) {
    parts.push(`zoom=${state.zoom}`);
  }
  if (state.pan !== undefined) {
    // Pan is written as "x,y" (not via URLSearchParams) to keep the comma readable.
    // Numbers are URL-safe; no encoding needed.
    parts.push(`pan=${state.pan.x},${state.pan.y}`);
  }

  if (state.dfd !== undefined) {
    // A sub-DFD reference is an id path (`invoicing/Submit-PCI`); '/' is legal
    // in a fragment, so it stays readable instead of becoming %2F.
    parts.push(`dfd=${encodeURIComponent(state.dfd).replaceAll('%2F', '/')}`);
  }

  if (state.flowview !== undefined) {
    parts.push(`flowview=${state.flowview}`);
  }

  if (state.collapse !== undefined) {
    parts.push(`collapse=${state.collapse}`);
  }

  // ':' is legal in a fragment, so `section=process:Create-Sales-Order` stays readable.
  if (state.section !== undefined) {
    parts.push(`section=${encodeURIComponent(state.section).replaceAll('%3A', ':')}`);
  }

  if (state.node !== undefined) {
    parts.push(`node=${encodeURIComponent(state.node).replaceAll('%3A', ':')}`);
  }

  return parts.join('&');
}
