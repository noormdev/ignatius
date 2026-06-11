/**
 * flow-usage-index.ts — pure flow-node↔process cross-reference helpers.
 *
 * Two exports:
 *
 * `buildEntityUsageIndex` — unchanged legacy export.
 *   Maps entity id (bare, e.g. "Payment") → ProcessUsage[].
 *   Only `db:` endpoints count. Used by the entity dialog's Processes section.
 *
 * `buildFlowNodeUsageIndex` — superset, token-keyed map.
 *   Maps "kind:name" token (e.g. "db:Payment", "ext:Customer", "file:gateway-log")
 *   → ProcessUsage[]. Covers ALL non-proc endpoints so external/store dialogs can
 *   render the same Processes cross-reference table.
 *
 * Both walk diagrams recursively (including sub-DFDs) and apply the same dedup
 * logic: one entry per (nodeToken, processId) pair; read/write/readwrite direction.
 */

import type { FlowDiagram, FlowProcess, FlowEndpoint } from './flow-parse';

export type ProcessUsage = {
  processId: string;
  processLabel: string;
  dottedNumber: string;
  dfdId: string;
  dfdTitle: string;
  direction: 'read' | 'write' | 'readwrite';
};

type EntryAcc = {
  entityId: string;
  read: boolean;
  write: boolean;
  processId: string;
  processLabel: string;
  dottedNumber: string;
  dfdId: string;
  dfdTitle: string;
};

/**
 * Collects all `db:` entity references from processes in `diagrams`
 * (recursively including sub-DFDs) and returns a map:
 *   entityId → ProcessUsage[]
 *
 * The map only contains entries for entities that actually appear in at least
 * one process's inputs or outputs.
 */
export function buildEntityUsageIndex(diagrams: FlowDiagram[]): Map<string, ProcessUsage[]> {
  // One accumulator entry per (entityId × processId) pair.
  const acc = new Map<string, EntryAcc>();

  function entryKey(entityId: string, processId: string): string {
    return `${entityId}\0${processId}`;
  }

  function visitProcess(process: FlowProcess, dfdId: string, dfdTitle: string): void {
    // Input edges: from: <source>  to: proc:<processId>
    // A db: source means the process reads from that entity.
    for (const edge of process.inputs) {
      if (edge.from.kind === 'db') {
        const entityId = edge.from.name;
        const k = entryKey(entityId, process.id);
        const existing = acc.get(k);
        if (!existing) {
          acc.set(k, {
            entityId,
            read: true,
            write: false,
            processId: process.id,
            processLabel: process.label,
            dottedNumber: process.dottedNumber,
            dfdId,
            dfdTitle,
          });
        } else {
          existing.read = true;
        }
      }
    }

    // Output edges: from: proc:<processId>  to: <destination>
    // A db: destination means the process writes to that entity.
    for (const edge of process.outputs) {
      if (edge.to.kind === 'db') {
        const entityId = edge.to.name;
        const k = entryKey(entityId, process.id);
        const existing = acc.get(k);
        if (!existing) {
          acc.set(k, {
            entityId,
            read: false,
            write: true,
            processId: process.id,
            processLabel: process.label,
            dottedNumber: process.dottedNumber,
            dfdId,
            dfdTitle,
          });
        } else {
          existing.write = true;
        }
      }
    }
  }

  function walkDiagram(diagram: FlowDiagram): void {
    for (const process of diagram.processes) {
      visitProcess(process, diagram.id, diagram.title);
    }
    for (const sub of diagram.subDfds) {
      walkDiagram(sub);
    }
  }

  for (const diagram of diagrams) {
    walkDiagram(diagram);
  }

  // Merge read/write flags and group results by entityId.
  const result = new Map<string, ProcessUsage[]>();

  for (const entry of acc.values()) {
    const direction: ProcessUsage['direction'] =
      entry.read && entry.write ? 'readwrite' : entry.write ? 'write' : 'read';

    const usage: ProcessUsage = {
      processId: entry.processId,
      processLabel: entry.processLabel,
      dottedNumber: entry.dottedNumber,
      dfdId: entry.dfdId,
      dfdTitle: entry.dfdTitle,
      direction,
    };

    const list = result.get(entry.entityId);
    if (list) {
      list.push(usage);
    } else {
      result.set(entry.entityId, [usage]);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// buildFlowNodeUsageIndex — token-keyed superset (ext:, store kinds, db:)
// ---------------------------------------------------------------------------

/**
 * Builds a map from "kind:name" token → ProcessUsage[] for ALL non-proc
 * endpoints (db:, ext:, cache:, queue:, file:, doc:, manual:, other:).
 *
 * Keys use the same format as the flow doc resolver tokens so callers can look
 * up a node's usages with a single token string, e.g.:
 *   index.get('ext:Customer')       → ProcessUsage[]
 *   index.get('file:gateway-log')   → ProcessUsage[]
 *   index.get('db:Payment')         → ProcessUsage[]
 *
 * `buildEntityUsageIndex` is kept unchanged; entity dialog callers continue
 * to use it and look up by bare entity id.
 */
export function buildFlowNodeUsageIndex(diagrams: FlowDiagram[]): Map<string, ProcessUsage[]> {
  const acc = new Map<string, EntryAcc>();

  function tokenOf(ep: FlowEndpoint): string {
    return `${ep.kind}:${ep.name}`;
  }

  function entryKey(token: string, processId: string): string {
    return `${token}\0${processId}`;
  }

  function recordEndpoint(ep: FlowEndpoint, isRead: boolean, process: FlowProcess, dfdId: string, dfdTitle: string): void {
    if (ep.kind === 'proc') return;
    const token = tokenOf(ep);
    const k = entryKey(token, process.id);
    const existing = acc.get(k);
    if (!existing) {
      acc.set(k, {
        entityId: token,
        read: isRead,
        write: !isRead,
        processId: process.id,
        processLabel: process.label,
        dottedNumber: process.dottedNumber,
        dfdId,
        dfdTitle,
      });
    } else if (isRead) {
      existing.read = true;
    } else {
      existing.write = true;
    }
  }

  function visitProcess(process: FlowProcess, dfdId: string, dfdTitle: string): void {
    for (const edge of process.inputs) {
      recordEndpoint(edge.from, true, process, dfdId, dfdTitle);
    }
    for (const edge of process.outputs) {
      recordEndpoint(edge.to, false, process, dfdId, dfdTitle);
    }
  }

  function walkDiagram(diagram: FlowDiagram): void {
    for (const process of diagram.processes) {
      visitProcess(process, diagram.id, diagram.title);
    }
    for (const sub of diagram.subDfds) {
      walkDiagram(sub);
    }
  }

  for (const diagram of diagrams) {
    walkDiagram(diagram);
  }

  const result = new Map<string, ProcessUsage[]>();

  for (const entry of acc.values()) {
    const direction: ProcessUsage['direction'] =
      entry.read && entry.write ? 'readwrite' : entry.write ? 'write' : 'read';

    const usage: ProcessUsage = {
      processId: entry.processId,
      processLabel: entry.processLabel,
      dottedNumber: entry.dottedNumber,
      dfdId: entry.dfdId,
      dfdTitle: entry.dfdTitle,
      direction,
    };

    const list = result.get(entry.entityId);
    if (list) {
      list.push(usage);
    } else {
      result.set(entry.entityId, [usage]);
    }
  }

  return result;
}
