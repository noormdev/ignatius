/**
 * spotlight-inherited.ts — pure key-inheritance LINEAGE logic for the DD browse
 * lens and the DG graph (key-inheritance-lineage).
 *
 * Pure module: no DOM, no React, no Bun/Node imports. Browser-safe and
 * unit-testable with plain Model literals + a ModelIndex. Same discipline as
 * `spotlight.ts`.
 *
 * ── The rule (the whole feature) ────────────────────────────────────────────
 *
 * Lineage follows ONLY KEY-INHERITANCE edges — never a secondary (non-key) FK.
 *
 * A **key edge** (a.k.a. identifying / PK-FK edge) is an edge whose foreign-key
 * columns (the child-side columns — the KEYS of `edge.on`) are ALL contained in
 * the child node's primary key. This is a SUBSET test (FK ⊆ child PK), not
 * equality:
 *
 *   - Subtype member → basetype (FK == full PK)            → ⊆ ✓ key edge
 *   - SalesInvoice → Party (party_id ⊂ {party_id,inv_no})  → ⊆ ✓ key edge
 *     (the identifying 1:many case — the FK is a PROPER SUBSET of the PK)
 *   - SIL_Product → Product (product_id ∉ child PK)        → ⊄ ✗ secondary FK
 *   - SI_Line → LineItemType, Party → PartyType (classifier FKs) → ✗ secondary
 *
 * On the real `key-inherited` model the parser's derived `edge.identifying`
 * flag is exactly equivalent to FK ⊆ PK on every edge (verified empirically).
 * We use the FK ⊆ PK test as the DEFINITION — it is the precise IDEF1X
 * "identifying" semantics and is robust if the parser's derivation ever drifts.
 *
 * ── Lineage ─────────────────────────────────────────────────────────────────
 *
 * The **lineage** of an entity is the transitive CONNECTED COMPONENT of that
 * entity in the graph of KEY EDGES ONLY, traversed in BOTH directions (key edges
 * are treated as undirected — two entities share lineage if connected by any
 * chain of key edges). This is the set of entities that share a primary-key
 * ancestry. Subtype clusters fall out naturally: every subtype member→basetype
 * relationship IS a key edge (FK == full PK), so the key-edge component already
 * captures subtype membership — no separate cluster walk is needed.
 *
 * ── Inherited connections (the return value) ────────────────────────────────
 *
 * = the lineage members, EXCLUDING:
 *   - the entity itself, AND
 *   - its DIRECT real-edge neighbours (entities already connected to it by any
 *     real graph edge — those render as solid lines; we never also draw a
 *     dotted lineage line to them).
 *
 * One bundle per otherId; result sorted ascending by otherId. An entity in a
 * trivial (singleton) lineage, or whose lineage adds nothing beyond its direct
 * neighbours, returns [].
 *
 * `direction` / `via` are LESS meaningful under the lineage model (a lineage
 * link is a shared-key kinship, not a single FK with an inherent direction):
 *   - `direction` is always `'out'` — the line points FROM the active card
 *     OUTWARD to the lineage member. The DD `SpotlightOverlay` renders an
 *     `'out'` connection as ONE line with a single arrowhead at the far (member)
 *     end (source → member). DG ephemeral edges are arrowless, so `direction`
 *     is unused there.
 *   - `via` is the nearest key-edge predecessor on the shortest key-edge path
 *     from the active entity (so the DD pill can read "via <nearest kin>"), or
 *     `INHERITED_IDENTITY` when no nearer key-edge kin exists. Consumers
 *     (`SpotlightOverlay`, `GraphView`) mainly use `otherId`.
 */

import type { ModelIndex } from '../../model/model-index';
import type { ModelEdge } from '../../model/parse';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `via` provenance marker on a lineage connection:
 * - `'identity'` — no nearer key-edge kin than the active entity itself; the
 *   connection is a direct shared-key sibling.
 * - any other string — the nearest key-edge kin (predecessor on the key-edge
 *   path) the lineage member was reached through, so the renderer can label
 *   "via <member>".
 */
export const INHERITED_IDENTITY = 'identity';

export type InheritedConnection = {
  otherId: string;
  /**
   * Always `'out'` — the lineage line points FROM the active card OUTWARD to the
   * lineage member. The `SpotlightOverlay` renders an `'out'` connection as ONE
   * line with a single arrowhead at the far (member) end. The union retains
   * `'in'`/`'both'` for shape compatibility with the other connection kinds.
   */
  direction: 'out' | 'in' | 'both';
  /**
   * Provenance: `INHERITED_IDENTITY` when the active entity is itself the
   * nearest key-edge kin, else the nearest key-edge kin id the member was
   * reached through (so the renderer can label "via <kin>").
   */
  via: string;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when `edge` is a KEY edge: every child-side FK column (the keys
 * of `edge.on`) is contained in the child (source) node's primary key. This is
 * the FK ⊆ child-PK subset test — the precise IDEF1X identifying semantics. A
 * secondary (non-key) FK fails this test and is never followed for lineage.
 */
function isKeyEdge(index: ModelIndex, edge: ModelEdge): boolean {
  const fkCols = Object.keys(edge.on);
  if (fkCols.length === 0) return false;

  const childPk = index.pkByNode.get(edge.source);
  if (childPk === undefined || childPk.length === 0) return false;

  const pkSet = new Set(childPk);
  for (const col of fkCols) {
    if (!pkSet.has(col)) return false;
  }
  return true;
}

/**
 * Key-edge neighbours of `nodeId` in one undirected step: the other endpoint of
 * every KEY edge incident on `nodeId`, whether `nodeId` is the child (outgoing)
 * or the parent (incoming).
 */
function keyEdgeNeighbors(index: ModelIndex, nodeId: string): string[] {
  const neighbors: string[] = [];

  for (const edge of index.edgesBySource.get(nodeId) ?? []) {
    if (isKeyEdge(index, edge)) neighbors.push(edge.target);
  }
  for (const edge of index.edgesByTarget.get(nodeId) ?? []) {
    if (isKeyEdge(index, edge)) neighbors.push(edge.source);
  }

  return neighbors;
}

/**
 * All DIRECT real-edge neighbours of `entityId` — the other endpoint of every
 * real graph edge incident on it, in either direction. These render as solid
 * lines, so they are excluded from the dotted lineage set.
 */
function directNeighbors(index: ModelIndex, entityId: string): Set<string> {
  const direct = new Set<string>();
  for (const edge of index.edgesBySource.get(entityId) ?? []) direct.add(edge.target);
  for (const edge of index.edgesByTarget.get(entityId) ?? []) direct.add(edge.source);
  direct.delete(entityId);
  return direct;
}

/**
 * Breadth-first traversal of the KEY-edge connected component of `entityId`,
 * treating key edges as undirected. Returns each reached member mapped to the
 * nearest key-edge predecessor on its shortest path from `entityId` (the BFS
 * parent). `entityId` maps to itself. Cycle-safe via the visited map.
 */
function buildLineageWithPredecessors(
  index: ModelIndex,
  entityId: string,
): Map<string, string> {
  // member id → predecessor id (the node it was first discovered from).
  const predecessorOf = new Map<string, string>();
  predecessorOf.set(entityId, entityId);

  const queue: string[] = [entityId];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head++;
    if (current === undefined) break;
    for (const neighbor of keyEdgeNeighbors(index, current)) {
      if (!predecessorOf.has(neighbor)) {
        predecessorOf.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  return predecessorOf;
}

// ---------------------------------------------------------------------------
// buildInheritedConnections
// ---------------------------------------------------------------------------

export function buildInheritedConnections(
  index: ModelIndex,
  entityId: string,
): InheritedConnection[] {
  // The lineage: the transitive connected component over key edges (both
  // directions), each member tagged with the nearest key-edge predecessor.
  const predecessorOf = buildLineageWithPredecessors(index, entityId);

  // Singleton lineage (no key-edge kin) → nothing to surface.
  if (predecessorOf.size <= 1) return [];

  // Direct real-edge neighbours render as solid lines — exclude them.
  const direct = directNeighbors(index, entityId);

  const result: InheritedConnection[] = [];
  for (const [memberId, predecessor] of predecessorOf) {
    if (memberId === entityId) continue;
    if (direct.has(memberId)) continue;

    // `via`: the nearest key-edge kin the member was reached through. When the
    // predecessor IS the active entity, there is no nearer kin to name — label
    // it as a direct shared-key sibling (INHERITED_IDENTITY).
    const via = predecessor === entityId ? INHERITED_IDENTITY : predecessor;
    // `direction = 'out'`: the lineage line points FROM the active (selected)
    // card OUTWARD to the lineage member. The DD `SpotlightOverlay` renders an
    // `'out'` connection as ONE line with a single arrowhead at the far (member)
    // end. (DG ephemeral edges are arrowless, so `direction` is unused there.)
    result.push({ otherId: memberId, direction: 'out', via });
  }

  result.sort((a, b) => (a.otherId < b.otherId ? -1 : a.otherId > b.otherId ? 1 : 0));
  return result;
}
