/**
 * spotlight-inherited.ts — pure inherited-connection logic for the DD browse lens (CP7, #9).
 *
 * Pure module: no DOM, no React, no Bun/Node imports. Browser-safe and
 * unit-testable with plain Model literals + a ModelIndex. Same discipline as
 * `spotlight.ts`.
 *
 * Why this exists: a 1:1 KEY-INHERITED entity shares identity with its parent
 * — the child IS the parent — so it transitively participates in the parent's
 * relationships and relates to other members of the same identity group. The
 * direct-FK spotlight (`buildSpotlightConnections`) walks only the active
 * entity's OWN edges, so a key-inherited entity looks unrelated to its
 * group-mates' relationships. This helper surfaces those INHERITED connections
 * so the spotlight can render them visually distinct from direct edges.
 *
 * Two kinds of 1:1 key-inheritance edge:
 *
 * (a) Subtype membership — a subtype cluster's basetype ↔ each member.
 *     Both ends of the relationship share identity regardless of direction.
 *
 * (b) Dependent identifying-1:1 — a ModelEdge from child Cn to parent P where:
 *     - edge.identifying === true
 *     - edge.cardinality.parent === '1' AND edge.cardinality.child === '1'
 *     - Object.keys(edge.on) sorted === index.pkByNode.get(Cn) sorted
 *       (the FK columns are EXACTLY the child's full PK — no subset, no superset)
 *     The cardinality 1:1 guard cleanly excludes subtype edges (which derive
 *     child='0..1'), so the two kinds never double-count.
 *
 * Identity group of entityId = transitive closure over BOTH kinds of edge in
 * BOTH directions, with a visited Set so cycles terminate.
 *
 * Inferred connections (the return value):
 *   - De-dup baseline: the active entity's OWN direct connections
 *     (`buildSpotlightConnections(index, entityId)`). ALL inherited
 *     connections — identity links and transitive relationships — are
 *     de-duplicated against this set.
 *   - For every OTHER member M in the group: emit M as an identity link
 *     (via = INHERITED_IDENTITY, direction = 'both'), UNLESS M is already
 *     a direct connection of the active (de-duped).
 *   - For every OTHER member M in the group: for each connection C of
 *     `buildSpotlightConnections(index, M)` where C.otherId is NOT in the
 *     identity group: emit C.otherId as inherited (via = M id, direction =
 *     C.direction), UNLESS C.otherId is already a direct connection of the
 *     active (de-duped) OR already bundled (first-seen wins).
 *   - Result sorted ascending by otherId.
 *   - Active in no identity group (group size 1, no neighbors) → [].
 *
 * `via` rule:
 *   - Identity links (to a group member) → INHERITED_IDENTITY ('identity').
 *   - Inherited relationships → the group-member id M through which the
 *     relationship was reached (nearest hop). This is a single entity id, not
 *     a chain, so the existing SpotlightOverlay label "via <M>" stays clean.
 *
 * Invariants:
 * - Never emits the active entity itself.
 * - De-dup against direct edges is applied to ALL inherited connections,
 *   identity links included (a subtype's direct FK to its basetype renders
 *   once as the solid direct line, not also as a dotted inherited line).
 * - Bundle duplicates: one inherited connection per otherId (first-seen wins).
 * - Active entity in no identity group → [].
 */

import type { ModelIndex } from '../../model/model-index';
import { buildSpotlightConnections } from './spotlight';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `via` provenance marker on an inherited connection:
 * - `'identity'` — the connection is a shared-key identity link (to another
 *   member of the same identity group), not a transitive relationship.
 * - any other string — the group-member id the relationship was inherited
 *   through (the nearest hop from the active entity).
 */
export const INHERITED_IDENTITY = 'identity';

export type InheritedConnection = {
  otherId: string;
  /**
   * Direction relative to the entity the relationship was inherited THROUGH.
   * `'both'` when the underlying bundle carries edges in both directions.
   * Identity links carry `'both'` (shared-key relationship has no inherent direction).
   */
  direction: 'out' | 'in' | 'both';
  /**
   * Provenance: `INHERITED_IDENTITY` for identity links (another group member),
   * else the group-member id the FK relationship was inherited through (so the
   * renderer can label "via <member>").
   */
  via: string;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the edge from `childId` to `parentId` qualifies as a
 * dependent identifying-1:1 — i.e., the FK columns are exactly the child's
 * full PK. This guard distinguishes dep-1:1 extension tables from regular
 * identifying FKs whose child cardinality is '0..1' (subtypes) or 'many'.
 */
function isDepIdentifying11(
  index: ModelIndex,
  edge: { source: string; target: string; identifying: boolean; on: Record<string, string>; cardinality: { parent: string; child: string } },
): boolean {
  if (!edge.identifying) return false;
  if (edge.cardinality.parent !== '1') return false;
  if (edge.cardinality.child !== '1') return false;

  const childPk = index.pkByNode.get(edge.source);
  if (childPk === undefined || childPk.length === 0) return false;

  const fkCols = Object.keys(edge.on).sort();
  const pkCols = [...childPk].sort();

  if (fkCols.length !== pkCols.length) return false;
  for (let i = 0; i < fkCols.length; i++) {
    if (fkCols[i] !== pkCols[i]) return false;
  }
  return true;
}

/**
 * Find all identity-group neighbors of `nodeId` in one step:
 * - Subtype cluster membership (basetype ↔ each member)
 * - Qualifying outgoing dep-1:1 edges (child → parent)
 * - Qualifying incoming dep-1:1 edges (another child → nodeId as parent)
 */
function identityNeighbors(index: ModelIndex, nodeId: string): string[] {
  const neighbors: string[] = [];

  // (a) Subtype cluster links
  const asMember = index.subtypeMemberToCluster.get(nodeId);
  if (asMember !== undefined) {
    neighbors.push(asMember.basetype);
    for (const m of asMember.members) {
      if (m !== nodeId) neighbors.push(m);
    }
  }
  const asBasetype = index.basetypeClusterById.get(nodeId);
  if (asBasetype !== undefined) {
    for (const m of asBasetype.members) {
      neighbors.push(m);
    }
  }

  // (b) Qualifying outgoing dep-1:1 edges (nodeId is the child)
  const outEdges = index.edgesBySource.get(nodeId);
  if (outEdges !== undefined) {
    for (const edge of outEdges) {
      if (isDepIdentifying11(index, edge)) {
        neighbors.push(edge.target);
      }
    }
  }

  // (c) Qualifying incoming dep-1:1 edges (nodeId is the parent, edge.source is child)
  const inEdges = index.edgesByTarget.get(nodeId);
  if (inEdges !== undefined) {
    for (const edge of inEdges) {
      if (isDepIdentifying11(index, edge)) {
        neighbors.push(edge.source);
      }
    }
  }

  return neighbors;
}

/**
 * Compute the transitive identity group of `entityId` via BFS.
 * Returns the visited Set (includes entityId). Size 1 → no identity neighbors.
 */
function buildIdentityGroup(index: ModelIndex, entityId: string): Set<string> {
  const visited = new Set<string>();
  const worklist: string[] = [entityId];
  visited.add(entityId);

  while (worklist.length > 0) {
    const current = worklist.pop();
    if (current === undefined) break;
    for (const neighbor of identityNeighbors(index, current)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        worklist.push(neighbor);
      }
    }
  }

  return visited;
}

// ---------------------------------------------------------------------------
// buildInheritedConnections
// ---------------------------------------------------------------------------

export function buildInheritedConnections(
  index: ModelIndex,
  entityId: string,
): InheritedConnection[] {
  // Build the transitive identity group.
  const group = buildIdentityGroup(index, entityId);

  // Group size 1 means no identity neighbors — nothing to inherit.
  if (group.size <= 1) return [];

  // The active entity's OWN direct connections — the de-dup baseline.
  const directOtherIds = new Set<string>();
  for (const c of buildSpotlightConnections(index, entityId)) {
    directOtherIds.add(c.otherId);
  }

  // Accumulate one bundle per otherId; first-seen via/direction win.
  const bundles = new Map<string, InheritedConnection>();

  /**
   * Add an inherited connection.
   * Guards: never the active entity itself; never a direct edge (de-dup);
   * first-seen wins (one bundle per otherId).
   */
  const add = (
    otherId: string,
    direction: 'out' | 'in' | 'both',
    via: string,
  ) => {
    if (otherId === entityId) return;
    if (directOtherIds.has(otherId)) return;
    if (bundles.has(otherId)) return;
    bundles.set(otherId, { otherId, direction, via });
  };

  // For every other member M in the group:
  for (const memberId of group) {
    if (memberId === entityId) continue;

    // (1) The member itself as an identity link.
    add(memberId, 'both', INHERITED_IDENTITY);

    // (2) The member's external connections (those NOT in the identity group).
    for (const c of buildSpotlightConnections(index, memberId)) {
      if (group.has(c.otherId)) continue; // skip within-group edges
      add(c.otherId, c.direction, memberId);
    }
  }

  const result = [...bundles.values()];
  result.sort((a, b) => (a.otherId < b.otherId ? -1 : a.otherId > b.otherId ? 1 : 0));
  return result;
}
