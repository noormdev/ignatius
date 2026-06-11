import type { ModelNode, SubtypeCluster } from '../../model/parse';
import type { FlowProcess, FlowExternal, FlowStoreRef } from '../../flows/flow-parse';

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
