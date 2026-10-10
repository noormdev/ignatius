import type { ColumnDef, Model, ModelEdge, ModelNode, SubtypeCluster } from './parse';
import type { FlowDiagram, FlowEdge, FlowEndpoint, FlowExternal, FlowProcess, FlowStoreRef } from '../flows/flow-parse';
import { SYNTHETIC_DIAGRAM_IDS } from '../flows/flow-derive-levels';
import { isRecord, md, parseFrontmatter } from '../flows/flow-markdown';
import { linkStateNeutral } from './wikilink';

/** The parsed model and flows at the last approval, stored as `.ignatius/baseline.json`. */
export type ModelSnapshot = { version: 1; model: Model; flows: FlowDiagram[] };

export type ChangeKind = 'added' | 'removed' | 'changed';

export type FlowNodeKind = 'process' | 'external' | 'store';

/** One semantic difference between two snapshots. `fields` is set on `changed` items only. */
export type ChangeItem =
  | { scope: 'entity'; kind: ChangeKind; entity: string; fields?: string[] }
  | {
      scope: 'column';
      kind: ChangeKind;
      entity: string;
      column: string;
      fields?: string[];
      /** Set on `removed` items: the column as the baseline defined it. */
      def?: ColumnDef;
    }
  | { scope: 'relationship'; kind: ChangeKind; source: string; target: string; on: Record<string, string>; fields?: string[] }
  | { scope: 'doc'; kind: 'changed'; entity: string }
  | {
      scope: 'flow';
      kind: ChangeKind;
      /** `FlowDiagram.id`, the name change notes use. */
      diagram: string;
      /** Ancestor ids joined by `/`; unique where sub-DFD ids repeat under different parents. */
      diagramPath: string;
      node?: string;
      nodeKind?: FlowNodeKind;
      /** Set on store items; `node` is the store name, which kinds can share. */
      storeKind?: FlowStoreRef['kind'];
      fields?: string[];
    };

export type ChangeNote = {
  file: string;
  title: string;
  /** Entity id → column names the note touches. */
  entities: Record<string, string[]>;
  /** `FlowDiagram.id` → process/external ids and store names the note touches. */
  flows: Record<string, string[]>;
  bodyHtml: string;
};

export type ChangeNoteError = { file: string; error: string };

export type ReviewedItem = ChangeItem & { status: 'explained' | 'unexplained'; notes: string[] };

/** Something a note names that has no matching change item. */
export type ChangeClaim =
  | { note: string; entity: string; column?: string }
  | { note: string; diagram: string; node?: string };

export type ChangeReview = {
  items: ReviewedItem[];
  claims: ChangeClaim[];
  notes: ChangeNote[];
  noteErrors: ChangeNoteError[];
  removedNodes: ModelNode[];
  removedEdges: ModelEdge[];
};

type Fields = Record<string, unknown>;

/** JSON with object keys sorted, so YAML key order never reads as a change. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (!isRecord(v)) return v;
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

function changedFields(before: Fields, after: Fields): string[] {
  return Object.keys(before).filter(key => canonical(before[key]) !== canonical(after[key]));
}

function diffKeyed<T>(
  before: Map<string, T>,
  after: Map<string, T>,
  onAdded: (key: string, value: T) => void,
  onRemoved: (key: string, value: T) => void,
  onBoth: (key: string, was: T, now: T) => void,
): void {
  for (const [key, was] of before) {
    const now = after.get(key);
    if (now === undefined) onRemoved(key, was);
    else onBoth(key, was, now);
  }
  for (const [key, now] of after) {
    if (!before.has(key)) onAdded(key, now);
  }
}

function byKey<T>(values: T[], key: (value: T) => string): Map<string, T> {
  return new Map(values.map(value => [key(value), value]));
}

function subtypesOf(basetype: string, clusters: SubtypeCluster[]): string[] {
  return clusters
    .filter(c => c.basetype === basetype)
    .map(c => canonical({ exclusive: c.exclusive, desc: c.desc, members: [...c.members].sort(), hasDiscriminator: c.hasDiscriminator }))
    .sort();
}

function entityFields(node: ModelNode, clusters: SubtypeCluster[]): Fields {
  return {
    pk: [...node.pk].sort(),
    ak: node.alternateKeys.map(ak => canonical({ rule: ak.rule, columns: [...ak.columns].sort() })).sort(),
    classification: node.classification,
    group: node.group,
    description: node.description,
    examples: node.examples,
    singleton: node.singleton ?? false,
    subtypes: subtypesOf(node.id, clusters),
  };
}

function columnFields(column: ColumnDef): Fields {
  return { type: column.type, nullable: column.nullable ?? false, default: column.default, desc: column.desc };
}

function relationshipFields(edge: ModelEdge): Fields {
  return { identifying: edge.identifying, on: edge.on, predicate: edge.predicate, cardinality: edge.cardinality };
}

function diffEntities(before: Model, after: Model, items: ChangeItem[]): void {
  diffKeyed(
    byKey(before.nodes, n => n.id),
    byKey(after.nodes, n => n.id),
    entity => items.push({ scope: 'entity', kind: 'added', entity }),
    entity => items.push({ scope: 'entity', kind: 'removed', entity }),
    (entity, was, now) => {
      const fields = changedFields(entityFields(was, before.subtypeClusters), entityFields(now, after.subtypeClusters));
      if (fields.length > 0) items.push({ scope: 'entity', kind: 'changed', entity, fields });
      diffKeyed(
        new Map(Object.entries(was.columns)),
        new Map(Object.entries(now.columns)),
        column => items.push({ scope: 'column', kind: 'added', entity, column }),
        (column, def) => items.push({ scope: 'column', kind: 'removed', entity, column, def }),
        (column, wasCol, nowCol) => {
          const colFields = changedFields(columnFields(wasCol), columnFields(nowCol));
          if (colFields.length > 0) items.push({ scope: 'column', kind: 'changed', entity, column, fields: colFields });
        },
      );
      if (linkStateNeutral(was.bodyHtml) !== linkStateNeutral(now.bodyHtml)) items.push({ scope: 'doc', kind: 'changed', entity });
    },
  );
}

function relationshipPair(edge: ModelEdge): string {
  return `${edge.source}\u0000${edge.target}`;
}

/** A source+target pair with two edges (dual-FK, self-referential) also keys on the FK mapping, or one would overwrite the other. */
function diffRelationships(before: ModelEdge[], after: ModelEdge[], items: ChangeItem[]): void {
  const shared = new Set<string>();
  for (const edges of [before, after]) {
    const seen = new Set<string>();
    for (const edge of edges) {
      const pair = relationshipPair(edge);
      if (seen.has(pair)) shared.add(pair);
      seen.add(pair);
    }
  }
  const key = (edge: ModelEdge) => {
    const pair = relationshipPair(edge);
    return shared.has(pair) ? `${pair}\u0000${canonical(edge.on)}` : pair;
  };
  const item = (kind: ChangeKind, edge: ModelEdge, fields?: string[]): ChangeItem => ({
    scope: 'relationship',
    kind,
    source: edge.source,
    target: edge.target,
    on: edge.on,
    ...(fields ? { fields } : {}),
  });
  diffKeyed(
    byKey(before, key),
    byKey(after, key),
    (_k, edge) => items.push(item('added', edge)),
    (_k, edge) => items.push(item('removed', edge)),
    (_k, was, now) => {
      const fields = changedFields(relationshipFields(was), relationshipFields(now));
      if (fields.length > 0) items.push(item('changed', now, fields));
    },
  );
}

function endpointKey(endpoint: FlowEndpoint | FlowStoreRef): string {
  return `${endpoint.kind}:${endpoint.name}`;
}

const processId = (p: FlowProcess) => p.id;
const externalId = (e: FlowExternal) => e.id;

type FlowNodeName = { node: string; storeKind?: FlowStoreRef['kind'] };

const processName = (p: FlowProcess): FlowNodeName => ({ node: p.id });
const externalName = (e: FlowExternal): FlowNodeName => ({ node: e.id });
const storeName = (s: FlowStoreRef): FlowNodeName => ({ node: s.name, storeKind: s.kind });

function flowEdgeKey(edge: FlowEdge): string {
  const data = Array.isArray(edge.data) ? [...edge.data].sort() : edge.data;
  return canonical({ from: endpointKey(edge.from), to: endpointKey(edge.to), data, label: edge.label, cluster: edge.cluster?.slug });
}

function processFields(p: FlowProcess): Fields {
  return {
    label: p.label,
    number: p.number,
    inputs: p.inputs.map(flowEdgeKey).sort(),
    outputs: p.outputs.map(flowEdgeKey).sort(),
    description: p.description,
    examples: p.examples,
    body: p.bodyHtml,
  };
}

function externalFields(e: FlowExternal): Fields {
  return { label: e.label, kind: e.kind, description: e.description, body: e.bodyHtml };
}

function storeFields(s: FlowStoreRef): Fields {
  return { kind: s.kind, displayName: s.displayName, description: s.description, body: s.bodyHtml };
}

/** Skips the derived context and L1 diagrams: no note can name them, and their nodes repeat the leaves'. */
function flattenDiagrams(
  diagrams: FlowDiagram[],
  parentPath = '',
  into = new Map<string, FlowDiagram>(),
): Map<string, FlowDiagram> {
  for (const d of diagrams) {
    const path = parentPath ? `${parentPath}/${d.id}` : d.id;
    if (!SYNTHETIC_DIAGRAM_IDS.has(d.id)) into.set(path, d);
    flattenDiagrams(d.subDfds, path, into);
  }
  return into;
}

type FlowWhere = { diagram: string; diagramPath: string; nodeKind: FlowNodeKind };

function diffFlowNodes<T>(
  where: FlowWhere,
  before: Map<string, T>,
  after: Map<string, T>,
  nameOf: (node: T) => FlowNodeName,
  fieldsOf: (node: T) => Fields,
  items: ChangeItem[],
): void {
  diffKeyed(
    before,
    after,
    (_key, value) => items.push({ scope: 'flow', kind: 'added', ...where, ...nameOf(value) }),
    (_key, value) => items.push({ scope: 'flow', kind: 'removed', ...where, ...nameOf(value) }),
    (_key, was, now) => {
      const fields = changedFields(fieldsOf(was), fieldsOf(now));
      if (fields.length > 0) items.push({ scope: 'flow', kind: 'changed', ...where, ...nameOf(now), fields });
    },
  );
}

function diffFlows(before: FlowDiagram[], after: FlowDiagram[], items: ChangeItem[]): void {
  diffKeyed(
    flattenDiagrams(before),
    flattenDiagrams(after),
    (diagramPath, d) => items.push({ scope: 'flow', kind: 'added', diagram: d.id, diagramPath }),
    (diagramPath, d) => items.push({ scope: 'flow', kind: 'removed', diagram: d.id, diagramPath }),
    (diagramPath, was, now) => {
      const at = (nodeKind: FlowNodeKind): FlowWhere => ({ diagram: now.id, diagramPath, nodeKind });
      diffFlowNodes(at('process'), byKey(was.processes, processId), byKey(now.processes, processId), processName, processFields, items);
      diffFlowNodes(at('external'), byKey(was.externals, externalId), byKey(now.externals, externalId), externalName, externalFields, items);
      diffFlowNodes(at('store'), byKey(was.storeRefs, endpointKey), byKey(now.storeRefs, endpointKey), storeName, storeFields, items);
    },
  );
}

/** Every semantic difference from `baseline` to `current`. Ordering of keys, columns, nodes, and edges is ignored. */
export function diffSnapshots(baseline: ModelSnapshot, current: ModelSnapshot): ChangeItem[] {
  const items: ChangeItem[] = [];
  diffEntities(baseline.model, current.model, items);
  diffRelationships(baseline.model.edges, current.model.edges, items);
  diffFlows(baseline.flows, current.flows, items);
  return items;
}

function readNameLists(value: unknown, key: string): Record<string, string[]> | string {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return `\`${key}\` must be a mapping`;
  const lists: Record<string, string[]> = {};
  for (const [name, list] of Object.entries(value)) {
    if (list === null) {
      lists[name] = [];
      continue;
    }
    if (!Array.isArray(list) || !list.every((entry): entry is string => typeof entry === 'string')) {
      return `\`${key}.${name}\` must be a list of names`;
    }
    lists[name] = list;
  }
  return lists;
}

/** Parse one `.ignatius/changes/<slug>.md` note. Bad frontmatter yields an error value, never a throw. */
export function parseChangeNote(file: string, text: string): ChangeNote | ChangeNoteError {
  let parsed: { frontmatter: Record<string, unknown>; body: string };
  try {
    parsed = parseFrontmatter(text);
  } catch (err) {
    return { file, error: err instanceof Error ? err.message : String(err) };
  }
  const { frontmatter, body } = parsed;

  const title = frontmatter['title'];
  if (typeof title !== 'string') return { file, error: '`title` must be a string' };
  const entities = readNameLists(frontmatter['entities'], 'entities');
  if (typeof entities === 'string') return { file, error: entities };
  const flows = readNameLists(frontmatter['flows'], 'flows');
  if (typeof flows === 'string') return { file, error: flows };

  return { file, title, entities, flows, bodyHtml: md.render(body) };
}

function listed(lists: Record<string, string[]>, name: string, member?: string): boolean {
  if (!Object.hasOwn(lists, name)) return false;
  return member === undefined || (lists[name]?.includes(member) ?? false);
}

function covers(note: ChangeNote, item: ChangeItem): boolean {
  switch (item.scope) {
    case 'entity':
    case 'doc':
      return listed(note.entities, item.entity);
    case 'column':
      return listed(note.entities, item.entity, item.column);
    case 'relationship':
      return listed(note.entities, item.source) || listed(note.entities, item.target);
    case 'flow':
      return listed(note.flows, item.diagram, item.node);
  }
}

function touchesEntity(item: ChangeItem, entity: string): boolean {
  if (item.scope === 'relationship') return item.source === entity || item.target === entity;
  return item.scope !== 'flow' && item.entity === entity;
}

function unchangedClaims(note: ChangeNote, items: ChangeItem[]): ChangeClaim[] {
  const claims: ChangeClaim[] = [];
  for (const [entity, columns] of Object.entries(note.entities)) {
    const entityItems = items.filter(item => touchesEntity(item, entity));
    if (entityItems.length === 0) {
      claims.push({ note: note.file, entity });
      continue;
    }
    if (entityItems.some(item => item.scope === 'entity' && item.kind !== 'changed')) continue;
    for (const column of columns) {
      if (!entityItems.some(item => item.scope === 'column' && item.column === column)) {
        claims.push({ note: note.file, entity, column });
      }
    }
  }
  for (const [diagram, nodes] of Object.entries(note.flows)) {
    const diagramItems = items.filter(item => item.scope === 'flow' && item.diagram === diagram);
    if (diagramItems.length === 0) {
      claims.push({ note: note.file, diagram });
      continue;
    }
    if (diagramItems.some(item => item.scope === 'flow' && item.node === undefined)) continue;
    for (const node of nodes) {
      if (!diagramItems.some(item => item.scope === 'flow' && item.node === node)) {
        claims.push({ note: note.file, diagram, node });
      }
    }
  }
  return claims;
}

/** Coverage per docs/spec/model-change-review.md. `baseline` supplies the nodes and edges of removed items. */
export function crossCheck(
  items: ChangeItem[],
  parsedNotes: (ChangeNote | ChangeNoteError)[],
  baseline: Model,
): ChangeReview {
  const notes: ChangeNote[] = [];
  const noteErrors: ChangeNoteError[] = [];
  for (const parsed of parsedNotes) {
    if ('error' in parsed) noteErrors.push(parsed);
    else notes.push(parsed);
  }

  const reviewed = items.map((item): ReviewedItem => {
    const covering = notes.filter(note => covers(note, item)).map(note => note.file);
    return { ...item, status: covering.length > 0 ? 'explained' : 'unexplained', notes: covering };
  });

  const removedIds = new Set(items.flatMap(i => (i.scope === 'entity' && i.kind === 'removed' ? [i.entity] : [])));
  const removedEdgeKeys = new Set(
    items.flatMap(i => (i.scope === 'relationship' && i.kind === 'removed' ? [canonical([i.source, i.target, i.on])] : [])),
  );

  return {
    items: reviewed,
    claims: notes.flatMap(note => unchangedClaims(note, items)),
    notes,
    noteErrors,
    removedNodes: baseline.nodes.filter(n => removedIds.has(n.id)),
    removedEdges: baseline.edges.filter(e => removedEdgeKeys.has(canonical([e.source, e.target, e.on]))),
  };
}
