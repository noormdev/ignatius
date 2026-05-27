// =============================================================================
// types.ts — type definitions for both raw parsed YAML and the built Model
// =============================================================================

// -----------------------------------------------------------------------------
// Stage 1 output: RAW structural shapes (what YAML literally produced, validated
// for shape only — no semantic meaning yet).
// -----------------------------------------------------------------------------

export type LogicalType =
  | 'text' | 'integer' | 'decimal' | 'boolean'
  | 'date' | 'datetime' | 'binary';

export interface RawDoc {
  meta?: RawMeta;
  groups: Record<string, string>;          // groupName -> description
  entities: Record<string, RawEntity>;     // entityName -> entity body
}

export interface RawMeta {
  name?: string;
  version?: string;
  desc?: string;
  updated?: string | Date;
}

export interface RawEntity {
  desc?: string;
  groups?: string[];
  pk: string[];
  columns: Record<string, RawColumn>;
  ak?: RawAlternateKey[];
  relationships?: {
    identifying?: Record<string, RawRelationship | RawRelationship[]>;
    referential?: Record<string, RawRelationship | RawRelationship[]>;
  };
  subtypes?: RawSubtypeCluster[];
  values?: Record<string, Record<string, unknown>> | Array<Record<string, unknown>>;
  constraints?: RawConstraint[];
}

export interface RawColumn {
  type: LogicalType;
  nullable?: boolean;
  default?: string;
  desc?: string;
}

export interface RawAlternateKey {
  rule: string;
  desc?: string;
  columns: string[];
}

export interface RawRelationship {
  desc?: string;
  on: Record<string, string>;              // childColumn -> parentColumn
  predicate: { fwd: string; rev: string };
}

export interface RawSubtypeCluster {
  desc?: string;
  exclusive: boolean;
  members:
    | Record<string, Record<string, string>>  // exclusive: { SubtypeName: { discCol: "T.col.VAL" } }
    | string[];                                 // inclusive: [SubtypeName, ...]
}

export interface RawConstraint {
  rule: string;
  desc?: string;
  spans?: string[];
}

// -----------------------------------------------------------------------------
// Stage 2+ output: the BUILT Model with derivations populated.
// -----------------------------------------------------------------------------

export type Classification =
  | 'independent' | 'dependent' | 'subtype' | 'basetype' | 'associative' | 'classifier';

export interface Model {
  meta: RawMeta;
  groups: Map<string, GroupInfo>;
  nodes: Map<string, Node>;
  edges: Edge[];
  subtypeClusters: SubtypeCluster[];
  constraintSpans: ConstraintSpan[];
}

export interface GroupInfo {
  name: string;
  desc: string;
}

export interface Node {
  name: string;
  desc?: string;
  classification: Classification;          // DERIVED
  primaryGroup?: string;                   // DERIVED
  effectiveGroups: string[];               // DERIVED
  pk: string[];
  ak: AlternateKey[];
  columns: Column[];
  values?: Array<Record<string, unknown>>;
  constraints: Constraint[];
}

export interface Column {
  name: string;
  type: LogicalType;
  nullable: boolean;
  default?: string;
  desc?: string;
  isPK: boolean;                           // DERIVED
  isFK: boolean;                           // DERIVED
  akMembership: string[];                  // DERIVED — AK IDs this col belongs to
}

export interface AlternateKey {
  id: string;                              // DERIVED — ak_<entity>_<rule>
  rule: string;
  desc?: string;
  columns: string[];
}

export type Cardinality = '1' | '0..1' | 'many';

export interface Edge {
  parent: string;
  child: string;
  kind: 'identifying' | 'referential';
  on: Map<string, string>;                 // childCol -> parentCol
  predicate: { fwd: string; rev: string };
  cardinality: { parent: Cardinality; child: Cardinality };  // DERIVED
  desc?: string;
  clusterRef?: SubtypeCluster;             // set if edge is the IS A from subtype to basetype
}

export interface SubtypeCluster {
  basetype: string;
  exclusive: boolean;
  members: SubtypeMember[];
  desc?: string;
}

export interface SubtypeMember {
  subtype: string;
  discriminator?: { column: string; classifierPath: string };  // exclusive only
}

export interface Constraint {
  id: string;                              // DERIVED — <entity>_<rule>
  rule: string;
  desc?: string;
  spans?: string[];
}

export interface ConstraintSpan {
  source: string;
  target: string;
  constraintId: string;
}

// -----------------------------------------------------------------------------
// Layout output
// -----------------------------------------------------------------------------

export interface NodePosition {
  group: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutResult = Map<string, NodePosition>;

export interface EdgeRoute {
  edgeIndex: number;                          // index into model.edges
  points: Array<{ x: number; y: number }>;    // polyline: source port -> bends -> target port
}

export type EdgeRoutes = Map<number, EdgeRoute>;

// -----------------------------------------------------------------------------
// Issue tracking — structural errors and validation errors share a shape
// -----------------------------------------------------------------------------

export interface Issue {
  severity: 'error' | 'warning';
  phase: 'parse' | 'build' | 'validate';
  message: string;
  location?: string;                       // e.g. "Party.relationships.identifying.PartyType"
}
