// =============================================================================
// build.ts — Stage 2: RawDoc → Model (build nodes, edges, clusters, spans).
//
// At this stage we trust that the input is structurally valid (parse.ts has
// already run and rejected malformed input). We focus on assembling the
// in-memory graph.
//
// Derivations happen in derive.ts AFTER this stage.
// =============================================================================

import {
  RawDoc, RawEntity, RawRelationship, Model, Node, Edge, SubtypeCluster,
  SubtypeMember, ConstraintSpan, GroupInfo, AlternateKey, Column, Constraint,
} from './types';
import { snakeCase } from './util';

export function buildModel(doc: RawDoc): Model {
  // Groups: copy declarations into the registry.
  const groups = new Map<string, GroupInfo>();
  for (const [name, desc] of Object.entries(doc.groups)) {
    groups.set(name, { name, desc });
  }

  // Pass 1: enumerate edges, clusters, and constraint spans from every entity.
  const edges: Edge[] = [];
  const subtypeClusters: SubtypeCluster[] = [];
  const constraintSpans: ConstraintSpan[] = [];

  for (const [ename, body] of Object.entries(doc.entities)) {
    collectEdges(ename, body, edges);
    collectClusters(ename, body, subtypeClusters);
    collectConstraintSpans(ename, body, constraintSpans);
  }

  // Pass 2: build nodes. Need edges (for isFK derivation) ready first.
  const nodes = new Map<string, Node>();
  for (const [ename, body] of Object.entries(doc.entities)) {
    nodes.set(ename, buildNode(ename, body, edges));
  }

  return {
    meta: doc.meta ?? {},
    groups,
    nodes,
    edges,
    subtypeClusters,
    constraintSpans,
  };
}

function collectEdges(ename: string, body: RawEntity, edges: Edge[]): void {
  const rels = body.relationships;
  if (!rels) return;

  for (const kind of ['identifying', 'referential'] as const) {
    const block = rels[kind];
    if (!block) continue;

    for (const [parentName, rel] of Object.entries(block)) {
      const list = Array.isArray(rel) ? rel : [rel];
      for (const r of list) {
        edges.push({
          parent: parentName,
          child: ename,
          kind,
          on: new Map(Object.entries(r.on)),
          predicate: { fwd: r.predicate.fwd, rev: r.predicate.rev },
          desc: r.desc,
          // cardinality & clusterRef populated by derive.ts
          cardinality: { parent: '1', child: 'many' },
        });
      }
    }
  }
}

function collectClusters(ename: string, body: RawEntity, clusters: SubtypeCluster[]): void {
  if (!body.subtypes) return;
  for (const c of body.subtypes) {
    const members: SubtypeMember[] = [];
    if (c.exclusive) {
      const membersMap = c.members as Record<string, Record<string, string>>;
      for (const [sname, discMap] of Object.entries(membersMap)) {
        const entries = Object.entries(discMap);
        if (entries.length !== 1) {
          // shape validated already; shouldn't get here
          continue;
        }
        const [discCol, discPath] = entries[0];
        members.push({ subtype: sname, discriminator: { column: discCol, classifierPath: discPath } });
      }
    } else {
      const memberList = c.members as string[];
      for (const sname of memberList) {
        members.push({ subtype: sname });
      }
    }
    clusters.push({
      basetype: ename,
      exclusive: c.exclusive,
      members,
      desc: c.desc,
    });
  }
}

function collectConstraintSpans(ename: string, body: RawEntity, spans: ConstraintSpan[]): void {
  if (!body.constraints) return;
  for (const c of body.constraints) {
    if (!c.spans) continue;
    const cid = `${snakeCase(ename)}_${snakeCase(c.rule)}`;
    for (const target of c.spans) {
      spans.push({ source: ename, target, constraintId: cid });
    }
  }
}

function buildNode(name: string, body: RawEntity, edges: Edge[]): Node {
  // Find FK columns: any child-side column appearing in any edge.on where this is the child
  const fkCols = new Set<string>();
  for (const e of edges) {
    if (e.child !== name) continue;
    for (const cc of e.on.keys()) fkCols.add(cc);
  }

  // Build AKs with derived IDs
  const ak: AlternateKey[] = (body.ak ?? []).map(a => ({
    id: `ak_${snakeCase(name)}_${snakeCase(a.rule)}`,
    rule: a.rule,
    desc: a.desc,
    columns: a.columns,
  }));

  // Column -> list of AK IDs it participates in
  const akMembership = new Map<string, string[]>();
  for (const a of ak) {
    for (const col of a.columns) {
      if (!akMembership.has(col)) akMembership.set(col, []);
      akMembership.get(col)!.push(a.id);
    }
  }

  const pkSet = new Set(body.pk);
  const columns: Column[] = Object.entries(body.columns).map(([cname, c]) => ({
    name: cname,
    type: c.type,
    nullable: c.nullable ?? false,
    default: c.default,
    desc: c.desc,
    isPK: pkSet.has(cname),
    isFK: fkCols.has(cname),
    akMembership: akMembership.get(cname) ?? [],
  }));

  const constraints: Constraint[] = (body.constraints ?? []).map(c => ({
    id: `${snakeCase(name)}_${snakeCase(c.rule)}`,
    rule: c.rule,
    desc: c.desc,
    spans: c.spans,
  }));

  // values can be a map or an array — normalize to array form for the Node
  let values: Array<Record<string, unknown>> | undefined;
  if (body.values) {
    if (Array.isArray(body.values)) {
      values = body.values;
    } else {
      // map form: key is the single-col PK value; flatten with the PK column name
      const pkCol = body.pk[0];
      values = Object.entries(body.values).map(([k, v]) => ({ [pkCol]: k, ...v }));
    }
  }

  return {
    name,
    desc: body.desc,
    classification: 'independent',         // placeholder; derive.ts populates
    primaryGroup: undefined,                // populated by derive.ts
    effectiveGroups: [],                    // populated by derive.ts
    pk: body.pk,
    ak,
    columns,
    values,
    constraints,
  };
}
