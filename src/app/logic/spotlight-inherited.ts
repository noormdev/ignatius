/**
 * spotlight-inherited.ts — pure inherited-connection logic for the DD browse lens (CP7, #9).
 *
 * Pure module: no DOM, no React, no Bun/Node imports. Browser-safe and
 * unit-testable with plain Model literals + a ModelIndex. Same discipline as
 * `spotlight.ts`.
 *
 * Why this exists: a 1:1 KEY-INHERITED subtype shares its basetype's primary key
 * — the child IS the parent — so it transitively participates in the basetype's
 * relationships and relates to its sibling subtypes. The direct-FK spotlight
 * (`buildSpotlightConnections`) walks only the active entity's OWN edges, so a
 * subtype looks unrelated to its parent's relationships and to its siblings.
 * This helper surfaces those INHERITED connections so the spotlight can render
 * them visually distinct from direct edges.
 *
 * Scope (v1): subtype clusters only — the model's canonical 1:1 key-inheritance
 * primitive (the owner's example: Business/Individual as subtypes of Party).
 * General identifying-1:1 dependent extension tables are an explicit non-goal
 * for CP7 (a natural future extension, but not inferred here — only
 * shared-identity subtype-cluster membership qualifies, else the spotlight
 * would over-connect through arbitrary FKs).
 *
 * Invariants:
 * - Active is a subtype member → surface the basetype + each sibling member as
 *   identity links, AND the basetype's direct FK connections.
 * - Active is a basetype → surface each member + each member's direct FK
 *   connections.
 * - De-duplicate against the active entity's OWN direct connections
 *   (`buildSpotlightConnections(index, activeId)`): never emit ANY inherited
 *   connection — identity links included — to an otherId the active connects to
 *   directly, and never emit a connection to the active itself. In the
 *   key-inherited convention a subtype has a direct identifying FK to its
 *   basetype, so the basetype renders ONCE as that solid direct line, not also
 *   as a dotted inherited identity line; siblings + the basetype's OTHER
 *   relationships still surface as inherited.
 * - Bundle duplicates: one inherited connection per otherId (first-seen `via`
 *   and direction win).
 * - Result sorted ascending by otherId.
 * - Active in no cluster, or unknown id → [].
 */

import type { ModelIndex } from '../../model/model-index';
import { buildSpotlightConnections } from './spotlight';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `via` provenance marker on an inherited connection:
 * - `'identity'` — the connection is a shared-key identity link (to the basetype
 *   or to a sibling/member of the same cluster), not a transitive relationship.
 * - any other string — the basetype id the relationship was inherited through.
 */
export const INHERITED_IDENTITY = 'identity';

export type InheritedConnection = {
  otherId: string;
  /**
   * Direction relative to the entity the relationship was inherited THROUGH
   * (the basetype for a member, the member for a basetype). `'both'` when the
   * underlying bundle carries edges in both directions. Identity links carry
   * `'both'` (a shared-key relationship has no inherent direction).
   */
  direction: 'out' | 'in' | 'both';
  /**
   * Provenance: `INHERITED_IDENTITY` for the basetype/sibling/member identity
   * link, else the basetype id the FK relationship was inherited through (so the
   * renderer can label "via <basetype>").
   */
  via: string;
};

// ---------------------------------------------------------------------------
// buildInheritedConnections
// ---------------------------------------------------------------------------

export function buildInheritedConnections(
  index: ModelIndex,
  entityId: string,
): InheritedConnection[] {
  // Resolve the cluster role of the active entity. A member belongs to (at
  // most, for v1) one cluster via subtypeMemberToCluster; a basetype is keyed
  // in basetypeClusterById.
  const asMember = index.subtypeMemberToCluster.get(entityId);
  const asBasetype = index.basetypeClusterById.get(entityId);

  if (asMember === undefined && asBasetype === undefined) return [];

  // The active entity's OWN direct connections — the de-dup baseline.
  const directOtherIds = new Set<string>();
  for (const c of buildSpotlightConnections(index, entityId)) {
    directOtherIds.add(c.otherId);
  }

  // Accumulate one bundle per otherId; first-seen via/direction win.
  const bundles = new Map<string, InheritedConnection>();

  /**
   * Add an inherited connection.
   *
   * ALL inherited connections — identity links (basetype/sibling/member) AND
   * transitive relationships (the basetype's / members' FK connections) — de-dup
   * against the active's OWN direct edges: an otherId the active already connects
   * to directly is never redrawn as a dotted inherited line. In the key-inherited
   * convention a subtype has a direct identifying FK edge to its basetype, so the
   * basetype renders ONCE as that solid direct FK line and is NOT also emitted as
   * an inherited identity line. Siblings and the basetype's OTHER relationships
   * (which are not direct edges of the active) still surface as inherited.
   */
  const add = (
    otherId: string,
    direction: 'out' | 'in' | 'both',
    via: string,
  ) => {
    if (otherId === entityId) return; // never the active entity itself
    if (directOtherIds.has(otherId)) return; // direct edge wins — never duplicate a direct edge
    if (bundles.has(otherId)) return; // first-seen wins (bundle duplicates)
    bundles.set(otherId, { otherId, direction, via });
  };

  if (asMember !== undefined) {
    const basetypeId = asMember.basetype;

    // (a) Identity links: the basetype + each sibling member. The basetype is
    //     dropped here when it is a direct FK of the active (the common
    //     key-inherited case) — it renders once as the solid direct line.
    add(basetypeId, 'both', INHERITED_IDENTITY);
    for (const memberId of asMember.members) {
      add(memberId, 'both', INHERITED_IDENTITY);
    }

    // (b) The basetype's direct FK connections — relationships inherited via the
    //     shared key. `via` = the basetype id.
    for (const c of buildSpotlightConnections(index, basetypeId)) {
      add(c.otherId, c.direction, basetypeId);
    }
  } else if (asBasetype !== undefined) {
    // (a) Identity links: each member. A member already a direct in-edge of the
    //     basetype (the key-inherited subtype→basetype FK) is dropped here — it
    //     renders once as the solid direct line.
    for (const memberId of asBasetype.members) {
      add(memberId, 'both', INHERITED_IDENTITY);
    }

    // (b) Each member's direct FK connections — inherited up to the basetype.
    //     `via` = the member id the relationship was inherited through.
    for (const memberId of asBasetype.members) {
      for (const c of buildSpotlightConnections(index, memberId)) {
        add(c.otherId, c.direction, memberId);
      }
    }
  }

  const result = [...bundles.values()];
  result.sort((a, b) => (a.otherId < b.otherId ? -1 : a.otherId > b.otherId ? 1 : 0));
  return result;
}
