/**
 * spotlight.ts — pure spotlight-connection logic for the DD browse lens.
 *
 * Pure module: no DOM, no React, no Bun/Node imports. Browser-safe and
 * unit-testable with plain Model literals + a ModelIndex.
 *
 * Invariants:
 * - Sources: only edgesBySource (out) and edgesByTarget (in). No model.edges scans.
 * - Self-edges (source === target === entityId) are excluded.
 * - All edges to/from the same otherId bundle into ONE SpotlightConnection.
 * - direction is 'both' when a bundle contains edges from both sets.
 * - Within a bundle: out edges appear before in edges.
 * - Result sorted ascending by otherId.
 * - Unknown entityId / no edges → [], no throw.
 */

import type { ModelIndex } from '../../model/model-index';
import type { ModelEdge, Predicate } from '../../model/parse';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SpotlightEdge = {
  direction: 'out' | 'in';
  predicate: Predicate;
  cardinality: ModelEdge['cardinality'];
  identifying: boolean;
};

export type SpotlightConnection = {
  otherId: string;
  direction: 'out' | 'in' | 'both';
  /** 1+ edges, insertion order: out edges first, then in. */
  edges: SpotlightEdge[];
};

// ---------------------------------------------------------------------------
// buildSpotlightConnections
// ---------------------------------------------------------------------------

export function buildSpotlightConnections(
  index: ModelIndex,
  entityId: string,
): SpotlightConnection[] {
  // map from otherId → accumulated edges, preserving out-first insertion order
  const bundles = new Map<string, { outEdges: SpotlightEdge[]; inEdges: SpotlightEdge[] }>();

  // out edges: entityId is the source (FK holder / child side)
  const outEdges = index.edgesBySource.get(entityId);
  if (outEdges !== undefined) {
    for (const edge of outEdges) {
      if (edge.target === entityId) continue; // self-edge
      let bundle = bundles.get(edge.target);
      if (bundle === undefined) {
        bundle = { outEdges: [], inEdges: [] };
        bundles.set(edge.target, bundle);
      }
      bundle.outEdges.push({
        direction: 'out',
        predicate: edge.predicate,
        cardinality: edge.cardinality,
        identifying: edge.identifying,
      });
    }
  }

  // in edges: entityId is the target (referenced / parent side)
  const inEdges = index.edgesByTarget.get(entityId);
  if (inEdges !== undefined) {
    for (const edge of inEdges) {
      if (edge.source === entityId) continue; // self-edge
      let bundle = bundles.get(edge.source);
      if (bundle === undefined) {
        bundle = { outEdges: [], inEdges: [] };
        bundles.set(edge.source, bundle);
      }
      bundle.inEdges.push({
        direction: 'in',
        predicate: edge.predicate,
        cardinality: edge.cardinality,
        identifying: edge.identifying,
      });
    }
  }

  if (bundles.size === 0) return [];

  const result: SpotlightConnection[] = [];
  for (const [otherId, { outEdges: outs, inEdges: ins }] of bundles) {
    const edges: SpotlightEdge[] = [...outs, ...ins];
    const hasOut = outs.length > 0;
    const hasIn = ins.length > 0;
    const direction: 'out' | 'in' | 'both' =
      hasOut && hasIn ? 'both' : hasOut ? 'out' : 'in';
    result.push({ otherId, direction, edges });
  }

  result.sort((a, b) => (a.otherId < b.otherId ? -1 : a.otherId > b.otherId ? 1 : 0));
  return result;
}
