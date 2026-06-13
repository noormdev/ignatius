/**
 * flow-spotlight.ts — pure flow-connection logic for the DD browse lens.
 *
 * Pure module: no DOM, no React, no Bun/Node imports. Browser-safe and
 * unit-testable with plain FlowDiagram[] literals.
 *
 * Canonical token scheme:
 *   - Entity card id  = bare entity name (e.g. "Payment").
 *     An entity's flow-lookup token = "db:<name>".
 *   - Flow-node card id = FlowEndpoint.raw, e.g. "proc:<id>", "ext:<id>",
 *     "file:<name>", "cache:<name>", etc.
 *
 * `activeToken` is always a "<kind>:<name>" endpoint string. The entity case
 * passes "db:<entityId>" as the lookup token.
 *
 * `otherCardId` resolution:
 *   - db:<name> other-endpoint → bare entity id "<name>" (cross-domain link)
 *   - every other kind → "<kind>:<name>" (the other endpoint's `raw`)
 *
 * Invariants:
 *   - Walks every FlowEdge across all diagrams AND sub-DFDs (recursive).
 *   - Self-edges (from.raw === to.raw === activeToken) are excluded.
 *   - All edges to the same otherCardId bundle into ONE FlowSpotlightConnection.
 *   - direction is 'both' when the bundle contains both out and in edges.
 *   - Within a bundle: out edges appear before in edges.
 *   - Result sorted ascending by otherCardId.
 *   - Unknown token / no edges → [], no throw.
 *   - Search-agnostic: returns all real FlowEdge connections regardless of
 *     what is currently rendered on the grid.
 */

import type { FlowDiagram, FlowEdge } from '../../flows/flow-parse';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FlowSpotlightEdge = {
  direction: 'out' | 'in';
  /** FlowEdge.data, with array payloads joined with ", ". */
  data: string;
};

export type FlowSpotlightConnection = {
  /** Grid card id of the other endpoint (bare entity id for db:, raw token otherwise). */
  otherCardId: string;
  direction: 'out' | 'in' | 'both';
  /** Bundled edges; out edges first, then in edges. */
  edges: FlowSpotlightEdge[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveData(data: string | string[]): string {
  return Array.isArray(data) ? data.join(', ') : data;
}

/**
 * Resolve an endpoint's raw token to the grid card id it maps to.
 *   db:<name>  → bare "<name>"   (entity card id namespace)
 *   anything else → "<kind>:<name>"  (flow-node card id namespace = raw)
 */
function resolveCardId(raw: string, kind: string, name: string): string {
  return kind === 'db' ? name : raw;
}

// ---------------------------------------------------------------------------
// buildFlowSpotlightConnections
// ---------------------------------------------------------------------------

export function buildFlowSpotlightConnections(
  diagrams: FlowDiagram[],
  activeToken: string,
): FlowSpotlightConnection[] {
  // map from otherCardId → accumulated out/in edges (preserves out-first order)
  const bundles = new Map<string, { outEdges: FlowSpotlightEdge[]; inEdges: FlowSpotlightEdge[] }>();

  function processEdge(edge: FlowEdge): void {
    const fromRaw = edge.from.raw;
    const toRaw = edge.to.raw;

    if (fromRaw === activeToken) {
      // active node is the source → out edge
      if (toRaw === activeToken) return; // self-edge
      const otherCardId = resolveCardId(toRaw, edge.to.kind, edge.to.name);
      let bundle = bundles.get(otherCardId);
      if (bundle === undefined) {
        bundle = { outEdges: [], inEdges: [] };
        bundles.set(otherCardId, bundle);
      }
      bundle.outEdges.push({ direction: 'out', data: resolveData(edge.data) });
    } else if (toRaw === activeToken) {
      // active node is the sink → in edge
      // (self-edge already excluded by the fromRaw === activeToken branch above)
      const otherCardId = resolveCardId(fromRaw, edge.from.kind, edge.from.name);
      let bundle = bundles.get(otherCardId);
      if (bundle === undefined) {
        bundle = { outEdges: [], inEdges: [] };
        bundles.set(otherCardId, bundle);
      }
      bundle.inEdges.push({ direction: 'in', data: resolveData(edge.data) });
    }
  }

  function walkDiagram(diagram: FlowDiagram): void {
    for (const edge of diagram.edges) {
      processEdge(edge);
    }
    for (const sub of diagram.subDfds) {
      walkDiagram(sub);
    }
  }

  for (const diagram of diagrams) {
    walkDiagram(diagram);
  }

  if (bundles.size === 0) return [];

  const result: FlowSpotlightConnection[] = [];
  for (const [otherCardId, { outEdges, inEdges }] of bundles) {
    const edges: FlowSpotlightEdge[] = [...outEdges, ...inEdges];
    const hasOut = outEdges.length > 0;
    const hasIn = inEdges.length > 0;
    const direction: 'out' | 'in' | 'both' =
      hasOut && hasIn ? 'both' : hasOut ? 'out' : 'in';
    result.push({ otherCardId, direction, edges });
  }

  result.sort((a, b) =>
    a.otherCardId < b.otherCardId ? -1 : a.otherCardId > b.otherCardId ? 1 : 0,
  );
  return result;
}
