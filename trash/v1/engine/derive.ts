// =============================================================================
// derive.ts — Stage 3: populate derived fields on the Model.
//
// Inputs:  built Model (nodes/edges/clusters populated)
// Outputs: same Model with classification, groups, cardinality, clusterRef set
//
// Order matters:
//   1) clusterRef on edges (needs subtypeClusters lookup)
//   2) classification on nodes (needs cluster membership)
//   3) effective groups (needs identifying edges)
//   4) primary group (needs effective groups)
//   5) cardinality on edges (needs cluster membership + PKs + AK info)
// =============================================================================

import { Model, Node, Edge, SubtypeCluster, Cardinality } from './types';

export function derive(model: Model): void {
  const clusterByBasetype = indexClustersByBasetype(model.subtypeClusters);
  const clusterMembership = indexSubtypeMembership(model.subtypeClusters);

  setClusterRefOnEdges(model.edges, clusterMembership);
  classifyNodes(model.nodes, model.edges, clusterByBasetype, clusterMembership);
  populateEffectiveGroups(model.nodes, model.edges);
  populatePrimaryGroup(model.nodes);
  populateCardinality(model.edges, model.nodes, clusterMembership);
}

// -----------------------------------------------------------------------------
// 1. clusterRef on edges
// -----------------------------------------------------------------------------

function setClusterRefOnEdges(
  edges: Edge[],
  clusterMembership: Map<string, SubtypeCluster>
): void {
  for (const e of edges) {
    if (e.kind !== 'identifying') continue;
    const cluster = clusterMembership.get(e.child);
    if (cluster && cluster.basetype === e.parent) {
      e.clusterRef = cluster;
    }
  }
}

// -----------------------------------------------------------------------------
// 2. Classification
// -----------------------------------------------------------------------------

function classifyNodes(
  nodes: Map<string, Node>,
  edges: Edge[],
  clusterByBasetype: Map<string, SubtypeCluster[]>,
  clusterMembership: Map<string, SubtypeCluster>
): void {
  // Index identifying-parent count per child
  const identifyingParentCount = new Map<string, number>();
  for (const e of edges) {
    if (e.kind === 'identifying') {
      identifyingParentCount.set(e.child, (identifyingParentCount.get(e.child) ?? 0) + 1);
    }
  }

  // Track outgoing-identifying and inbound-referential for classifier heuristic
  const hasOutgoingIdentifying = new Set<string>();
  const inboundReferentialCount = new Map<string, number>();
  for (const e of edges) {
    if (e.kind === 'identifying') hasOutgoingIdentifying.add(e.parent);
    if (e.kind === 'referential') {
      inboundReferentialCount.set(e.parent, (inboundReferentialCount.get(e.parent) ?? 0) + 1);
    }
  }

  for (const node of nodes.values()) {
    const idCount = identifyingParentCount.get(node.name) ?? 0;

    if (clusterByBasetype.has(node.name)) {
      node.classification = 'basetype';
    } else if (clusterMembership.has(node.name)) {
      node.classification = 'subtype';
    } else if (idCount >= 2) {
      node.classification = 'associative';
    } else if (idCount === 1) {
      node.classification = 'dependent';
    } else {
      // Classifier heuristic: small PK, no outgoing identifying, referenced as parent
      const outgoing = hasOutgoingIdentifying.has(node.name);
      const refCount = inboundReferentialCount.get(node.name) ?? 0;
      const couldBeClassifier =
        node.pk.length === 1 && !outgoing && refCount >= 1;

      // Stricter check: classifier should be a tiny lookup (heuristically: ≤ 3 columns,
      // and the non-PK columns look like descriptions/labels). Otherwise it's just
      // an independent entity that happens to be referenced.
      const looksLikeLookup =
        node.columns.length <= 3 &&
        node.columns.some(c =>
          ['description', 'label', 'name', 'desc'].includes(c.name)
        );

      node.classification = (couldBeClassifier && looksLikeLookup) ? 'classifier' : 'independent';
    }
  }
}

// -----------------------------------------------------------------------------
// 3. Effective groups (inherited via identifying ancestry)
// -----------------------------------------------------------------------------

function populateEffectiveGroups(nodes: Map<string, Node>, edges: Edge[]): void {
  // Build identifying-parent adjacency: child -> [parentName, ...]
  const identifyingParents = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== 'identifying') continue;
    if (!identifyingParents.has(e.child)) identifyingParents.set(e.child, []);
    identifyingParents.get(e.child)!.push(e.parent);
  }

  // We need the *declared* groups before computing effective. Read them off the
  // original raw object? No — we kept them on the node already as effectiveGroups
  // bootstrap. Actually we didn't. Let's fix that: declared groups come from the
  // RawEntity but were not propagated to Node. We'll need to thread them through.
  // For this pass we'll grab them from a side map populated below.

  // Walk + memoize. We rely on validation 12 (no identifying cycles) to terminate.
  const memo = new Map<string, string[]>();

  function walk(name: string): string[] {
    if (memo.has(name)) return memo.get(name)!;
    memo.set(name, []);  // cycle guard

    const node = nodes.get(name)!;
    const inherited: string[] = [];
    for (const p of identifyingParents.get(name) ?? []) {
      for (const g of walk(p)) {
        if (!inherited.includes(g)) inherited.push(g);
      }
    }
    // node.effectiveGroups currently holds DECLARED groups (set by caller pre-derive)
    const declared = node.effectiveGroups;
    const result: string[] = [];
    const seen = new Set<string>();
    for (const g of [...inherited, ...declared]) {
      if (!seen.has(g)) {
        result.push(g);
        seen.add(g);
      }
    }
    memo.set(name, result);
    return result;
  }

  // First, snapshot declared groups so we can overwrite effectiveGroups safely
  const declared = new Map<string, string[]>();
  for (const [n, node] of nodes) declared.set(n, [...node.effectiveGroups]);

  // Walk
  const computed = new Map<string, string[]>();
  for (const name of nodes.keys()) computed.set(name, walk(name));
  for (const [name, node] of nodes) {
    node.effectiveGroups = computed.get(name)!;
  }
}

// -----------------------------------------------------------------------------
// 4. Primary group
// -----------------------------------------------------------------------------

function populatePrimaryGroup(nodes: Map<string, Node>): void {
  for (const node of nodes.values()) {
    if (node.effectiveGroups.length === 0) {
      node.primaryGroup = undefined;
    } else {
      // Primary = LAST entry in effectiveGroups, which by construction is either
      // the node's own last declared group, or the last inherited group.
      node.primaryGroup = node.effectiveGroups[node.effectiveGroups.length - 1];
    }
  }
}

// -----------------------------------------------------------------------------
// 5. Cardinality
// -----------------------------------------------------------------------------

function populateCardinality(
  edges: Edge[],
  nodes: Map<string, Node>,
  _clusterMembership: Map<string, SubtypeCluster>
): void {
  for (const e of edges) {
    e.cardinality = deriveCardinality(e, nodes);
  }
}

function deriveCardinality(
  edge: Edge,
  nodes: Map<string, Node>
): { parent: Cardinality; child: Cardinality } {
  const parent = nodes.get(edge.parent)!;
  const child = nodes.get(edge.child)!;

  if (edge.kind === 'identifying') {
    if (edge.clusterRef) {
      // Subtype IS A edge: 1 on parent end, 0..1 on child end
      return { parent: '1', child: '0..1' };
    }
    // Compare PK sets
    if (sameStringSet(child.pk, parent.pk)) {
      return { parent: '1', child: '1' };
    }
    return { parent: '1', child: 'many' };
  }

  // Referential: derive from FK nullability + AK membership
  const fkCols = Array.from(edge.on.keys());
  const childColsByName = new Map(child.columns.map(c => [c.name, c]));
  const fkNullable = fkCols.some(c => childColsByName.get(c)?.nullable);
  const fkSet = new Set(fkCols);
  const fkIsAk = child.ak.some(a => sameStringSet(a.columns, fkCols));

  const parentEnd: Cardinality = fkNullable ? '0..1' : '1';
  const childEnd: Cardinality = fkIsAk ? '1' : 'many';
  return { parent: parentEnd, child: childEnd };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function indexClustersByBasetype(
  clusters: SubtypeCluster[]
): Map<string, SubtypeCluster[]> {
  const m = new Map<string, SubtypeCluster[]>();
  for (const c of clusters) {
    if (!m.has(c.basetype)) m.set(c.basetype, []);
    m.get(c.basetype)!.push(c);
  }
  return m;
}

function indexSubtypeMembership(
  clusters: SubtypeCluster[]
): Map<string, SubtypeCluster> {
  const m = new Map<string, SubtypeCluster>();
  for (const c of clusters) {
    for (const mem of c.members) {
      m.set(mem.subtype, c);
    }
  }
  return m;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every(x => sa.has(x));
}

// -----------------------------------------------------------------------------
// Bootstrap helper used during build: pre-seed declared groups into effectiveGroups
// so that derive() can read them out. This keeps the build/derive separation clean.
// -----------------------------------------------------------------------------

export function seedDeclaredGroups(
  nodes: Map<string, Node>,
  doc: { entities: Record<string, { groups?: string[] }> }
): void {
  for (const [name, body] of Object.entries(doc.entities)) {
    const node = nodes.get(name);
    if (!node) continue;
    node.effectiveGroups = body.groups ? [...body.groups] : [];
  }
}
