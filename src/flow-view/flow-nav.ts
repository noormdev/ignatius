/**
 * flow-nav.ts — the leveled DFD tree as navigation data: the flow index
 * (process hierarchy) and the breadcrumb level menus.
 *
 * Pure module, browser-safe. Diagrams are addressed by id path from a root,
 * never by a bare id: sub-DFD ids are process file names, which two flows may
 * share.
 */

import type { FlowDiagram, FlowProcess } from '../flows/flow-parse';
import { CONTEXT_DIAGRAM_ID, SYNTHETIC_DIAGRAM_IDS, SYSTEM_PROCESS_ID } from '../flows/flow-derive-levels';
import { compareDottedProcesses } from '../app/logic/search';

// Processes arrive in file order; navigation reads in number order.
function inNumberOrder(processes: readonly FlowProcess[]): FlowProcess[] {
  return [...processes].sort(compareDottedProcesses);
}

/** A diagram reachable from a breadcrumb level menu. */
export type FlowLevelEntry = {
  diagramId: string;
  /** Dotted number of the process the diagram decomposes; '' for a root. */
  number: string;
  label: string;
  description?: string;
  processCount: number;
};

/** One row of the flow index: a root diagram or a process. */
export type FlowIndexNode = {
  /** Unique across the tree: the id path joined with '/'. */
  key: string;
  number: string;
  label: string;
  description?: string;
  /** Diagram id path (root first) that clicking the row opens: the process's
   *  own sub-DFD when it has one, else the diagram that contains it. */
  path: string[];
  /** True when `path` ends at this row's own diagram. */
  opensOwnDiagram: boolean;
  children: FlowIndexNode[];
};

/** Walk `ids` down from the roots; null when any step is missing. */
export function resolveDiagramPath(roots: readonly FlowDiagram[], ids: readonly string[]): FlowDiagram[] | null {
  const path: FlowDiagram[] = [];
  let level: readonly FlowDiagram[] = roots;
  for (const id of ids) {
    const next = level.find(d => d.id === id);
    if (!next) return null;
    path.push(next);
    level = next.subDfds;
  }
  return path.length > 0 ? path : null;
}

/**
 * Where the Flows view opens with no `dfd=`: the System overview, which shows
 * every flow, rather than the one-box Context diagram above it. A tree that
 * was not leveled opens on its first root.
 */
export function defaultDiagramPath(roots: readonly FlowDiagram[]): FlowDiagram[] {
  const root = roots[0];
  if (!root) return [];
  const system = root.id === CONTEXT_DIAGRAM_ID ? root.subDfds.find(d => d.id === SYSTEM_PROCESS_ID) : undefined;
  return system ? [root, system] : [root];
}

/**
 * A diagram's deep-link reference (`dfd=`): its id path below the derived
 * Context and System levels, joined with '/' (`invoicing/Submit-PCI`). A
 * derived diagram is referenced by its own id.
 */
export function diagramRef(path: readonly FlowDiagram[]): string {
  const ids = path.map(d => d.id);
  const authored = ids.filter(id => !SYNTHETIC_DIAGRAM_IDS.has(id));
  return (authored.length > 0 ? authored : ids.slice(-1)).join('/');
}

/**
 * Resolve a deep-link reference to the first diagram path, in tree order,
 * whose trailing ids match it. A bare id is a one-segment reference, so links
 * written before references carried paths still resolve.
 */
export function findDiagramByRef(roots: readonly FlowDiagram[], ref: string): FlowDiagram[] | null {
  const segments = ref.split('/');
  function search(level: readonly FlowDiagram[], path: FlowDiagram[]): FlowDiagram[] | null {
    for (const d of level) {
      const next = [...path, d];
      const tail = next.slice(-segments.length).map(x => x.id);
      if (tail.length === segments.length && tail.every((id, i) => id === segments[i])) return next;
      const found = search(d.subDfds, next);
      if (found) return found;
    }
    return null;
  }
  return search(roots, []);
}

/**
 * Describe a process for navigation: its own `description:`, else its sub-DFD
 * folder's, else (the synthetic whole-system process) the model's.
 */
function describeProcess(process: FlowProcess, sub: FlowDiagram | undefined, modelDescription: string | undefined): string | undefined {
  return process.description
    ?? sub?.description
    ?? (process.id === SYSTEM_PROCESS_ID ? modelDescription : undefined);
}

/**
 * The diagrams one level below `parent` (its sub-DFDs, in number order), or
 * the roots when `parent` is null. These are what a breadcrumb at that level
 * can switch between.
 */
export function levelEntries(
  parent: FlowDiagram | null,
  roots: readonly FlowDiagram[],
  modelDescription?: string,
): FlowLevelEntry[] {
  if (parent === null) {
    return roots.map(d => ({
      diagramId: d.id,
      number: '',
      label: d.title,
      description: d.description ?? modelDescription,
      processCount: d.processes.length,
    }));
  }
  const entries: FlowLevelEntry[] = [];
  for (const process of inNumberOrder(parent.processes)) {
    const sub = parent.subDfds.find(d => d.id === process.id);
    if (!sub) continue;
    entries.push({
      diagramId: sub.id,
      number: process.dottedNumber,
      label: process.label,
      description: describeProcess(process, sub, modelDescription),
      processCount: sub.processes.length,
    });
  }
  return entries;
}

function processNodes(diagram: FlowDiagram, path: string[], modelDescription: string | undefined): FlowIndexNode[] {
  return inNumberOrder(diagram.processes).map(process => {
    const sub = diagram.subDfds.find(d => d.id === process.id);
    const ownPath = sub ? [...path, sub.id] : path;
    return {
      key: [...path, process.id].join('/'),
      number: process.dottedNumber,
      label: process.label,
      description: describeProcess(process, sub, modelDescription),
      path: ownPath,
      opensOwnDiagram: sub !== undefined,
      children: sub ? processNodes(sub, ownPath, modelDescription) : [],
    };
  });
}

/**
 * The whole process hierarchy, authored diagrams only: the derived Context and
 * System levels are not rows, so the flows are the top level and their
 * processes nest beneath. An unleveled tree lists one row per root.
 */
export function buildFlowIndex(roots: readonly FlowDiagram[], modelDescription?: string): FlowIndexNode[] {
  const nodes = roots.map(root => ({
    key: root.id,
    number: '',
    label: root.title,
    description: root.description ?? modelDescription,
    path: [root.id],
    opensOwnDiagram: true,
    children: processNodes(root, [root.id], modelDescription),
  }));
  return withoutDerivedLevels(nodes);
}

function withoutDerivedLevels(nodes: FlowIndexNode[]): FlowIndexNode[] {
  return nodes.flatMap(node => {
    const ownId = node.path.at(-1);
    return node.opensOwnDiagram && ownId !== undefined && SYNTHETIC_DIAGRAM_IDS.has(ownId)
      ? withoutDerivedLevels(node.children)
      : [node];
  });
}
