import type { ColumnDef } from '../../model/parse';
import type { ChangeKind, ChangeReview } from '../../model/change-review';
import type { FlowDiagram } from '../../flows/flow-parse';

/** Gaussian standard deviation of a change glow, in diagram units; graph and flow glows share it so they match. */
export const GLOW_BLUR = 3.5;
/** How far a change glow's shape extends past the node's edge before blurring, in diagram units. */
export const GLOW_SPREAD = 3;

/** How one rendered element changed since the last approval. */
export type ChangeMark = { change: ChangeKind; unexplained: boolean };

export type EntityChanges = {
  mark: ChangeMark;
  columns: Map<string, ChangeMark>;
  /** Columns gone from the current model, as the baseline defined them. */
  removedColumns: [string, ColumnDef][];
};

/** An added or removed mark outranks `changed`; unexplained is sticky. */
export function addMark(marks: Map<string, ChangeMark>, id: string, change: ChangeKind, unexplained: boolean): ChangeMark {
  const prev = marks.get(id);
  const mark = {
    change: prev && change === 'changed' ? prev.change : change,
    unexplained: unexplained || (prev?.unexplained ?? false),
  };
  marks.set(id, mark);
  return mark;
}

/** Per-entity marks from entity, column, and doc items. A column-only or doc-only change marks its entity changed. */
export function entityChanges(review: ChangeReview): Map<string, EntityChanges> {
  const byEntity = new Map<string, EntityChanges>();
  const entityMarks = new Map<string, ChangeMark>();
  for (const item of review.items) {
    if (item.scope === 'relationship' || item.scope === 'flow') continue;
    const unexplained = item.status === 'unexplained';
    const mark = addMark(entityMarks, item.entity, item.scope === 'entity' ? item.kind : 'changed', unexplained);
    const entry: EntityChanges = byEntity.get(item.entity) ?? { mark, columns: new Map(), removedColumns: [] };
    entry.mark = mark;
    if (item.scope === 'column') {
      addMark(entry.columns, item.column, item.kind, unexplained);
      if (item.def) entry.removedColumns.push([item.column, item.def]);
    }
    byEntity.set(item.entity, entry);
  }
  return byEntity;
}

/** Marks for the nodes of one diagram, keyed by the flow renderer's base token (`proc:id`, `ext:id`, `kind:name`).
 *  A newly added diagram gives its own mark to every node it draws. */
export function flowNodeMarks(review: ChangeReview, diagram: FlowDiagram, diagramPath: string): Map<string, ChangeMark> {
  const marks = new Map<string, ChangeMark>();
  for (const item of review.items) {
    if (item.scope !== 'flow' || item.diagramPath !== diagramPath) continue;
    const unexplained = item.status === 'unexplained';
    if (item.node === undefined) {
      const tokens = [
        ...diagram.processes.map(p => `proc:${p.id}`),
        ...diagram.externals.map(e => `ext:${e.id}`),
        ...diagram.storeRefs.map(s => `${s.kind}:${s.name}`),
      ];
      for (const token of tokens) addMark(marks, token, item.kind, unexplained);
      continue;
    }
    const token = item.nodeKind === 'process' ? `proc:${item.node}`
      : item.nodeKind === 'external' ? `ext:${item.node}`
      : `${item.storeKind}:${item.node}`;
    addMark(marks, token, item.kind, unexplained);
  }
  return marks;
}

/** The worst change inside a flow index or level menu row's diagram. */
export type ChangeSeverity = 'added' | 'changed' | 'unexplained';

const SEVERITY_RANK: Record<ChangeSeverity, number> = { added: 0, changed: 1, unexplained: 2 };

/** A flow index or level menu row's own mark, the fields its change touched, and the worst change inside its diagram. */
export type FlowRowChanges = { mark: ChangeMark | null; fields: string[]; inside: ChangeSeverity | null };

/** `rowKey` is the row's id path joined by `/`. Its process's item, its own diagram's item, or the item adding the
 *  diagram it sits in marks it; with `opensOwnDiagram`, every other item at or below its own diagram grades `inside`. */
export function flowRowChanges(review: ChangeReview, rowKey: string, opensOwnDiagram: boolean): FlowRowChanges {
  const slash = rowKey.lastIndexOf('/');
  const parentPath = slash < 0 ? null : rowKey.slice(0, slash);
  const processId = rowKey.slice(slash + 1);
  const marks = new Map<string, ChangeMark>();
  const fields = new Set<string>();
  let inside: ChangeSeverity | null = null;
  for (const item of review.items) {
    if (item.scope !== 'flow') continue;
    const unexplained = item.status === 'unexplained';
    const namesProcess = item.nodeKind === 'process' && item.diagramPath === parentPath && item.node === processId;
    const namesDiagram = opensOwnDiagram && item.node === undefined && item.diagramPath === rowKey;
    const addsContainingDiagram = item.node === undefined && item.diagramPath === parentPath;
    if (namesProcess || namesDiagram || addsContainingDiagram) {
      addMark(marks, rowKey, item.kind, unexplained);
      item.fields?.forEach(field => fields.add(field));
    } else if (opensOwnDiagram && (item.diagramPath === rowKey || item.diagramPath.startsWith(`${rowKey}/`))) {
      const severity: ChangeSeverity = unexplained ? 'unexplained' : item.kind === 'added' ? 'added' : 'changed';
      if (inside === null || SEVERITY_RANK[severity] > SEVERITY_RANK[inside]) inside = severity;
    }
  }
  return { mark: marks.get(rowKey) ?? null, fields: [...fields], inside };
}
