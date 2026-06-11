/**
 * model-index.ts — Precomputed O(1) lookup maps for a parsed Model.
 *
 * Pure module: no Bun/Node/DOM imports. Browser-safe and unit-testable with
 * plain Model literals (same discipline as src/model/validate.ts).
 *
 * Build-on-consume: Maps do not survive JSON serialization. Call
 * `buildModelIndex(model)` wherever a Model enters a consumer (after
 * parseModels, after a fetch/SSE model-changed event, after reading the static
 * global). Never attach the index to the serialized Model or any JSON payload.
 */

import type { Model, ModelNode, ModelEdge, SubtypeCluster, ColumnDef } from './parse';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ModelIndex = {
  /** node.id → ModelNode */
  nodeById: Map<string, ModelNode>;
  /** All node ids as a Set for O(1) membership tests */
  nodeIdSet: Set<string>;
  /** edge.source id → edges with that source */
  edgesBySource: Map<string, ModelEdge[]>;
  /** edge.target id → edges with that target */
  edgesByTarget: Map<string, ModelEdge[]>;
  /**
   * Stable `"source>target"` token → ModelEdge.
   * Key produced by `endpointKey(edge.source, edge.target)`.
   */
  edgeByEndpointPair: Map<string, ModelEdge>;
  /** node.id → pk column names */
  pkByNode: Map<string, string[]>;
  /** node.id → the node's declared columns Record<name, ColumnDef> */
  columnsByNode: Map<string, Record<string, ColumnDef>>;
  /**
   * node.id → Set of all column names that participate in any alternate key
   * (mirrors the `validKeys` set in validate.ts `checkAlternateKeys`).
   * Absent for nodes with no alternate keys.
   */
  akColumnsByNode: Map<string, Set<string>>;
  /**
   * node.id → Set of FK column names the node contributes as the child side
   * of an edge (i.e., `Object.keys(edge.on)` for every outgoing edge from that
   * node — mirrors `sourceCols` in validate.ts `checkEdgeDanglingFkColumn`).
   * Absent for nodes with no outgoing edges.
   */
  fkColumnsByNode: Map<string, Set<string>>;
  /**
   * member id → the first SubtypeCluster that lists it.
   * For a member that appears in multiple clusters use `clustersByMemberId`.
   */
  subtypeMemberToCluster: Map<string, SubtypeCluster>;
  /**
   * member id → ALL SubtypeClusters that list it (array).
   * A member can legitimately appear in more than one cluster.
   */
  clustersByMemberId: Map<string, SubtypeCluster[]>;
  /** basetype id → SubtypeCluster */
  basetypeClusterById: Map<string, SubtypeCluster>;
  /** group id → nodes belonging to that group (nodes with no group are omitted) */
  nodesByGroup: Map<string, ModelNode[]>;
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Stable endpoint key for `edgeByEndpointPair`.
 * Format: `"source>target"` — the `>` separator cannot appear in entity ids
 * (which are PascalCase identifiers), so the key is unambiguous.
 */
export function endpointKey(source: string, target: string): string {
  return `${source}>${target}`;
}

// ---------------------------------------------------------------------------
// buildModelIndex
// ---------------------------------------------------------------------------

/**
 * Build a bundle of O(1) lookup maps from a parsed Model.
 *
 * - Pure: no I/O, no Bun/Node, no DOM. Identical Model in → identical index out.
 * - Empty model → all maps empty, no throw.
 * - FK derivation: mirrors validate.ts `checkEdgeDanglingFkColumn` which uses
 *   `Object.keys(edge.on)` as the set of FK columns on the source node.
 * - AK derivation: mirrors validate.ts `checkAlternateKeys` `validKeys` set —
 *   union of `node.pk` and `Object.keys(node.columns)`.
 */
export function buildModelIndex(model: Model): ModelIndex {
  // -- nodeById / nodeIdSet --------------------------------------------------
  const nodeById = new Map<string, ModelNode>();
  const nodeIdSet = new Set<string>();
  for (const node of model.nodes) {
    nodeById.set(node.id, node);
    nodeIdSet.add(node.id);
  }

  // -- pkByNode / columnsByNode / akColumnsByNode ---------------------------
  const pkByNode = new Map<string, string[]>();
  const columnsByNode = new Map<string, Record<string, ColumnDef>>();
  const akColumnsByNode = new Map<string, Set<string>>();

  for (const node of model.nodes) {
    pkByNode.set(node.id, node.pk);
    columnsByNode.set(node.id, node.columns);

    // AK columns: any column named in any alternateKey.columns array.
    // Mirrors the `validKeys` set in validate.ts checkAlternateKeys (line 353–356)
    // which includes pk + columns; here we only index the AK-participanting columns.
    if (node.alternateKeys.length > 0) {
      const akCols = new Set<string>();
      for (const ak of node.alternateKeys) {
        for (const col of ak.columns) {
          akCols.add(col);
        }
      }
      if (akCols.size > 0) {
        akColumnsByNode.set(node.id, akCols);
      }
    }
  }

  // -- edgesBySource / edgesByTarget / edgeByEndpointPair / fkColumnsByNode --
  const edgesBySource = new Map<string, ModelEdge[]>();
  const edgesByTarget = new Map<string, ModelEdge[]>();
  const edgeByEndpointPair = new Map<string, ModelEdge>();
  const fkColumnsByNode = new Map<string, Set<string>>();

  for (const edge of model.edges) {
    // edgesBySource
    const srcList = edgesBySource.get(edge.source);
    if (srcList !== undefined) {
      srcList.push(edge);
    } else {
      edgesBySource.set(edge.source, [edge]);
    }

    // edgesByTarget
    const tgtList = edgesByTarget.get(edge.target);
    if (tgtList !== undefined) {
      tgtList.push(edge);
    } else {
      edgesByTarget.set(edge.target, [edge]);
    }

    // edgeByEndpointPair
    edgeByEndpointPair.set(endpointKey(edge.source, edge.target), edge);

    // fkColumnsByNode — FK cols are the keys of edge.on on the source node.
    // Mirrors validate.ts checkEdgeDanglingFkColumn (line 423):
    //   const sourceCols = new Set(Object.keys(sourceNode.columns ?? {}));
    //   const missing = Object.keys(edge.on).filter(col => !sourceCols.has(col));
    const fkColNames = Object.keys(edge.on);
    if (fkColNames.length > 0) {
      const existing = fkColumnsByNode.get(edge.source);
      if (existing !== undefined) {
        for (const col of fkColNames) {
          existing.add(col);
        }
      } else {
        fkColumnsByNode.set(edge.source, new Set(fkColNames));
      }
    }
  }

  // -- subtype cluster maps --------------------------------------------------
  const subtypeMemberToCluster = new Map<string, SubtypeCluster>();
  const clustersByMemberId = new Map<string, SubtypeCluster[]>();
  const basetypeClusterById = new Map<string, SubtypeCluster>();

  for (const cluster of model.subtypeClusters) {
    basetypeClusterById.set(cluster.basetype, cluster);

    for (const memberId of cluster.members) {
      // subtypeMemberToCluster — first-wins for multi-cluster members
      if (!subtypeMemberToCluster.has(memberId)) {
        subtypeMemberToCluster.set(memberId, cluster);
      }

      // clustersByMemberId — accumulate all clusters for the member
      const existing = clustersByMemberId.get(memberId);
      if (existing !== undefined) {
        existing.push(cluster);
      } else {
        clustersByMemberId.set(memberId, [cluster]);
      }
    }
  }

  // -- nodesByGroup ----------------------------------------------------------
  const nodesByGroup = new Map<string, ModelNode[]>();

  for (const node of model.nodes) {
    if (node.group === undefined) continue;
    const existing = nodesByGroup.get(node.group);
    if (existing !== undefined) {
      existing.push(node);
    } else {
      nodesByGroup.set(node.group, [node]);
    }
  }

  return {
    nodeById,
    nodeIdSet,
    edgesBySource,
    edgesByTarget,
    edgeByEndpointPair,
    pkByNode,
    columnsByNode,
    akColumnsByNode,
    fkColumnsByNode,
    subtypeMemberToCluster,
    clustersByMemberId,
    basetypeClusterById,
    nodesByGroup,
  };
}
