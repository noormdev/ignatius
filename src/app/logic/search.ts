import type { ModelNode, SubtypeCluster } from '../../model/parse';
import type { FlowDiagram, FlowProcess, FlowExternal, FlowStoreRef } from '../../flows/flow-parse';
import { SYNTHETIC_DIAGRAM_IDS } from '../../flows/flow-derive-levels';

// Dictionary group/entity hierarchy sort (pure logic, no I/O).
// Hierarchy ordering: independent basetype-clusters first, dependent second;
// within a tier alphabetical by basetype id; basetype before its subtypes.
export function sortGroupNodes(
  groupNodes: ModelNode[],
  subtypeClusters: SubtypeCluster[],
): ModelNode[] {
  const nodeSet: Record<string, ModelNode> = {};
  for (const n of groupNodes) nodeSet[n.id] = n;

  const relevantClusters = subtypeClusters.filter(c => nodeSet[c.basetype]);

  const subtypeOf: Record<string, string> = {};
  for (const c of relevantClusters) {
    for (const m of c.members) {
      subtypeOf[m] = c.basetype;
    }
  }

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

  for (const n of groupNodes) {
    if (!clusterMap[n.id] && !subtypeOf[n.id]) {
      clusterMap[n.id] = { basetype: n, subtypes: [] };
    }
  }

  const isIndependent = (n: ModelNode) => n.classification.toLowerCase() === 'independent';

  const independent: Cluster[] = [];
  const dependent: Cluster[] = [];

  for (const cluster of Object.values(clusterMap)) {
    if (isIndependent(cluster.basetype)) independent.push(cluster);
    else dependent.push(cluster);
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

// Returns true if the node matches the search term (id, columns, body text, group desc).
export function nodeMatchesSearch(node: ModelNode, term: string, groupLabel: string): boolean {
  const t = term.toLowerCase();
  if (node.id.toLowerCase().includes(t)) return true;
  if (groupLabel.toLowerCase().includes(t)) return true;
  for (const [colName, col] of Object.entries(node.columns)) {
    if (colName.toLowerCase().includes(t)) return true;
    if (col.type.toLowerCase().includes(t)) return true;
    if (col.desc?.toLowerCase().includes(t)) return true;
  }
  if (node.bodyHtml?.replace(/<[^>]+>/g, ' ').toLowerCase().includes(t)) return true;
  return false;
}

export function processMatchesSearch(proc: FlowProcess, term: string): boolean {
  const t = term.toLowerCase();
  if (proc.id.toLowerCase().includes(t)) return true;
  if (proc.label.toLowerCase().includes(t)) return true;
  if (proc.dottedNumber.toLowerCase().includes(t)) return true;
  if (proc.body.toLowerCase().includes(t)) return true;
  return false;
}

export function externalMatchesSearch(ext: FlowExternal, term: string): boolean {
  const t = term.toLowerCase();
  if (ext.id.toLowerCase().includes(t)) return true;
  if (ext.label.toLowerCase().includes(t)) return true;
  if (ext.body.toLowerCase().includes(t)) return true;
  return false;
}

export function storeMatchesSearch(store: FlowStoreRef, term: string): boolean {
  const t = term.toLowerCase();
  if (store.name.toLowerCase().includes(t)) return true;
  if (store.displayName.toLowerCase().includes(t)) return true;
  if (store.kind.toLowerCase().includes(t)) return true;
  if (store.body?.toLowerCase().includes(t)) return true;
  return false;
}

// Dotted-number sort: compare process dotted numbers numerically
// (so 2 < 10 and 1.1 < 1.2); non-numeric/missing segments fall back to 0 so a
// malformed number never throws. Module-scope so it isn't re-created per render.
export function parseDottedNumber(dn: string): number[] {
  return dn.split('.').map(seg => {
    const n = parseInt(seg, 10);
    return isNaN(n) ? 0 : n;
  });
}

export function compareDottedProcesses(a: FlowProcess, b: FlowProcess): number {
  const pa = parseDottedNumber(a.dottedNumber);
  const pb = parseDottedNumber(b.dottedNumber);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Graph / Flows search (title-first, opt-in body) — distinct from the
// Dictionary matchers above, which always match columns + body. Title field
// set per kind is pinned by SC5 in docs/spec/graph-flow-search.md.
// ---------------------------------------------------------------------------

// Graph (DG) search: entity title match (id only — no columns, no group
// label), body opt-in via bodyHtml stripped of tags.
export function entityMatches(node: ModelNode, term: string, includeBody: boolean): boolean {
  const t = term.toLowerCase();
  if (node.id.toLowerCase().includes(t)) return true;
  if (includeBody && node.bodyHtml.replace(/<[^>]+>/g, ' ').toLowerCase().includes(t)) return true;
  return false;
}

// Flows (DFD) search: process title match (id/label/dottedNumber), body opt-in.
export function flowProcessMatches(proc: FlowProcess, term: string, includeBody: boolean): boolean {
  const t = term.toLowerCase();
  if (proc.id.toLowerCase().includes(t)) return true;
  if (proc.label.toLowerCase().includes(t)) return true;
  if (proc.dottedNumber.toLowerCase().includes(t)) return true;
  if (includeBody && proc.body.toLowerCase().includes(t)) return true;
  return false;
}

// Flows (DFD) search: external title match (id/label), body opt-in.
export function flowExternalMatches(ext: FlowExternal, term: string, includeBody: boolean): boolean {
  const t = term.toLowerCase();
  if (ext.id.toLowerCase().includes(t)) return true;
  if (ext.label.toLowerCase().includes(t)) return true;
  if (includeBody && ext.body.toLowerCase().includes(t)) return true;
  return false;
}

// Flows (DFD) search: store title match (name/displayName), body opt-in.
export function flowStoreMatches(store: FlowStoreRef, term: string, includeBody: boolean): boolean {
  const t = term.toLowerCase();
  if (store.name.toLowerCase().includes(t)) return true;
  if (store.displayName.toLowerCase().includes(t)) return true;
  if (includeBody && store.body?.toLowerCase().includes(t)) return true;
  return false;
}

// Flows (DFD) search: diagram title match (id/title). No body field on
// FlowDiagram itself, so there is no includeBody variant.
export function flowDiagramMatches(diagram: FlowDiagram, term: string): boolean {
  const t = term.toLowerCase();
  if (diagram.id.toLowerCase().includes(t)) return true;
  if (diagram.title.toLowerCase().includes(t)) return true;
  return false;
}

export type FlowSearchResultKind = 'process' | 'external' | 'store' | 'diagram';

/** One dropdown row: what matched, its token, and the diagram it lives in. */
export type FlowSearchResult = {
  kind: FlowSearchResultKind;
  /** Base token in the proc:/ext:/<kind>: scheme of FlowDiagramSvg's layout
   *  node.id — the key nodeOpacity/edgeOpacity compare against, NOT the
   *  data-token DOM attribute (which stamps externals as the bare id).
   *  Role-split --src/--snk/--read/--write suffixes are a render-time layout
   *  concern, never part of this token. */
  token: string;
  label: string;
  /** Only present for kind 'process'. */
  dottedNumber?: string;
  diagramId: string;
  diagramTitle: string;
};

/**
 * Recursively walk every non-synthetic diagram (sub-DFDs included) and collect
 * every process / external / store / diagram-title match, grouped in walk
 * order (parent before children; within a diagram: diagram title, then
 * processes, externals, stores in their authored order).
 *
 * Synthetic diagrams (SYNTHETIC_DIAGRAM_IDS — the derived context/L1 wrapper
 * diagrams) are excluded from results but still walked through so their
 * user-authored leaf subDfds are reached.
 *
 * Pure; no I/O.
 */
export function searchFlowDiagrams(
  diagrams: FlowDiagram[],
  term: string,
  includeBody: boolean,
): FlowSearchResult[] {
  const results: FlowSearchResult[] = [];

  function walk(diagram: FlowDiagram): void {
    if (!SYNTHETIC_DIAGRAM_IDS.has(diagram.id)) {
      if (flowDiagramMatches(diagram, term)) {
        results.push({
          kind: 'diagram',
          token: `diagram:${diagram.id}`,
          label: diagram.title,
          diagramId: diagram.id,
          diagramTitle: diagram.title,
        });
      }
      for (const proc of diagram.processes) {
        if (flowProcessMatches(proc, term, includeBody)) {
          results.push({
            kind: 'process',
            token: `proc:${proc.id}`,
            label: proc.label,
            dottedNumber: proc.dottedNumber,
            diagramId: diagram.id,
            diagramTitle: diagram.title,
          });
        }
      }
      for (const ext of diagram.externals) {
        if (flowExternalMatches(ext, term, includeBody)) {
          results.push({
            kind: 'external',
            token: `ext:${ext.id}`,
            label: ext.label,
            diagramId: diagram.id,
            diagramTitle: diagram.title,
          });
        }
      }
      for (const store of diagram.storeRefs) {
        if (flowStoreMatches(store, term, includeBody)) {
          results.push({
            kind: 'store',
            token: `${store.kind}:${store.name}`,
            label: store.displayName,
            diagramId: diagram.id,
            diagramTitle: diagram.title,
          });
        }
      }
    }
    for (const sub of diagram.subDfds) {
      walk(sub);
    }
  }

  for (const diagram of diagrams) {
    walk(diagram);
  }

  return results;
}
