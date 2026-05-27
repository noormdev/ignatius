# IDEF1X Graphing Engine — Specification

Platform-neutral specification for a YAML-driven IDEF1X data model graphing tool. Covers grammar, in-memory data structures, derivation rules, validation, layout algorithm, edge routing, port assignment, and rendering. Anything not stated here is undefined behavior.

Reading order: principles (§1) → grammar (§2) → data structure (§3) → derivations (§4) → validation (§5) → layout (§6) → edge routing & ports (§7) → rendering (§8). Out-of-scope (§9) and pipeline summary (§10) close it out.

---

## 1. Design Principles

- **Platform-neutral logical modeling.** Logical types only (`text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary`). No engine dialects.
- **IDEF1X-faithful.** Identifying and non-identifying ("referential") are the two relationship kinds. Key migration is the structural mechanism. Subtypes are identity sharing (not composition).
- **Within-table inference allowed; cross-table inference forbidden.** Each entity is fully self-describing in isolation. The basetype lists its subtype members AND each subtype declares its identifying relationship back. Same fact on both sides — that's reinforcement, not redundancy to eliminate.
- **Default-deny on nullability.** All columns are non-nullable unless `nullable: true` is opted in.
- **Rule-named constraints and AKs.** Their natural-language `rule:` phrase becomes the global ID after snake-casing and prefixing.
- **Cardinality derived, not declared.** PK structure + cluster context + FK nullability fully determine cardinality.
- **M:N requires an explicit associative entity.** Structurally enforced.
- **Visual clarity over algorithmic purity.** The renderer prioritizes (in order): no edge crossing through a node; no two edges sharing the same endpoint on a node; minimal edge crossings between edges; minimal bend count.

---

## 2. YAML Grammar

### 2.1 Top-Level Structure

A flat YAML map. Top-level keys are either meta-blocks (`_`-prefixed) or entity definitions. The implementation uses a **YAML 1.2 parser** (e.g. the `yaml` npm package), which avoids the YAML 1.1 boolean-synonym collision around the bare keyword `on`.

```yaml
_meta:    { ... }   # optional model metadata
_groups:  { ... }   # optional group declarations

EntityA:  { ... }   # entity definitions
EntityB:  { ... }
```

The underscore prefix is reserved for meta-blocks. Entity names cannot start with one, which keeps entity naming unconstrained — `Groups`, `Values`, `Meta` are all valid entity names.

### 2.2 `_meta`

Optional. Model-level documentation.

```yaml
_meta:
  name:    "Model Name"
  version: "0.1.0"
  desc:    "Description of the model"
  updated: 2026-05-08
```

All fields optional. Surfaced in data-dictionary output; not consumed by layout.

### 2.3 `_groups`

Optional. Declares the visual modules.

```yaml
_groups:
  accounts: "Description of accounts group"
  payments: "Description of payments group"
```

Map of group name → description. Every group name referenced from an entity's `groups:` field must appear here.

### 2.4 Entity Body

```yaml
EntityName:
  desc:          "Optional entity-level description"
  groups:        [group1, group2]
  pk:            [col1, col2]
  columns:       { ... }
  ak:            [ ... ]
  relationships: { identifying: ..., referential: ... }
  subtypes:      [ ... ]
  values:        { ... }
  constraints:   [ ... ]
```

Required: `pk`, `columns`. All others optional.

### 2.5 Columns

```yaml
columns:
  column_name: { type: integer, nullable: true, default: 0, desc: "..." }
```

- `type` (required): one of `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary`.
- `nullable` (default `false`): opt-in only; most columns omit it.
- `default` (optional): logical default value. Literal or function name (`now`). Documentation only.
- `desc` (optional): free-form description.

Migrated FK columns are declared explicitly. The relationship's `on:` map binds them to the parent's columns.

### 2.6 Alternate Keys (`ak`)

```yaml
ak:
  - rule:    "unique tax identifier"
    desc:    "Tax ID must be unique across all rows"
    columns: [tax_id]
```

A list of AK declarations. Each:
- `rule` (required): semantic phrase. Snake-cased and prefixed with `ak_<entity_snake>_` to derive the global ID (e.g., `ak_business_unique_tax_identifier`).
- `desc` (optional): longer explanation.
- `columns` (required): one or more columns forming the AK. Composite AKs list multiple.

### 2.7 Relationships

Relationships live on the **child** entity (the side holding the FK). The parent never back-declares except in the subtype special case (§2.8).

```yaml
relationships:
  identifying:                     # parent PK migrates into child PK
    ParentEntity:
      desc: "Optional"
      on: { child_col: parent_col, ... }
      predicate: { fwd: "parent verb", rev: "child verb" }

  referential:                     # parent PK migrates as non-PK FK on child
    ParentEntity:
      on: { child_col: parent_col }
      predicate: { fwd, rev }
```

Field semantics:
- Keyed by parent entity name (single relationship to that parent).
- `on` (required): map of child column → parent column. Composite keys carry multiple pairs.
- `predicate` (required): `{ fwd, rev }`, independently authored verbs in each direction. `fwd` reads parent→child, `rev` reads child→parent. Neither is derived from the other.

For multiple FKs to the same parent (anti-pattern, but supported), the value under the parent key becomes an array. This pattern usually indicates a smell — it tends to require nullable FK columns — and is best refactored into an associative-with-role-classifier.

For composite-key joins (single relationship, multi-column anchor), `on` has multiple pairs:

```yaml
relationships:
  identifying:
    ParentEntity:
      on:
        col_a: parent_col_a
        col_b: parent_col_b
      predicate: { fwd, rev }
```

### 2.8 Subtype Clusters

```yaml
subtypes:
  - desc:      "Optional cluster description"
    exclusive: true                            # true = exclusive (X-joiner), false = inclusive
    members:                                   # MAP for exclusive, LIST for inclusive
      SubtypeA: { discriminator_col: ClassifierTable.column.VALUE }
      SubtypeB: { discriminator_col: ClassifierTable.column.OTHER_VALUE }
```

A list — a basetype may have multiple independent clusters.

- `exclusive` (required): boolean.
- `members`:
  - For **exclusive** clusters: map of subtype name → discriminator check `{ basetype_column: classifier_path }`. The path is `Table.column.VALUE` (three-part: table, the column being checked on that table, and the specific value).
  - For **inclusive** clusters: list of subtype names. Membership is existence-based; no discriminator column on the basetype.

Subtype entities themselves declare their own `pk` (equal to basetype PK), `columns`, and an explicit identifying relationship back to the basetype with `predicate: { fwd: "...", rev: "is a" }`. Cross-table reinforcement is required — the basetype's `subtypes:` block and the subtype's `relationships.identifying:` block both state the relationship.

### 2.9 Values (Seed Data)

Optional. Sample or reference rows useful primarily on classifiers.

```yaml
values:
  PRIMARY_KEY_VALUE: { description: "...", other_col: "..." }
  ANOTHER_VALUE:     { description: "..." }
```

Map keyed by single-column PK value. For composite PKs, fall back to array form:

```yaml
values:
  - { col_a: x, col_b: y, other: "..." }
```

### 2.10 Constraints

```yaml
constraints:
  - rule:  "natural language constraint phrase"
    desc:  "Longer explanation, can include formal logic"
    spans: [OtherEntity, AnotherEntity]
```

- `rule` (required): semantic phrase. Snake-cased and prefixed with `<entity_snake>_` to derive the global ID (e.g., `payment_allocation_not_exceeding_payment`).
- `desc` (optional): explanation. Free-form English. Engineers translate to CHECK / trigger / function in the target engine.
- `spans` (optional): list of other entities referenced by the constraint. Presence triggers a dotted line in the diagram. Absence means the constraint is purely domain-level (no diagram footprint).

---

## 3. In-Memory Data Structure

Produced by the parser; consumed by layout, routing, and rendering. The YAML is not re-read after parse.

```typescript
type Model = {
  meta:            ModelMeta
  groups:          Map<GroupName, GroupInfo>
  nodes:           Map<EntityName, Node>
  edges:           Edge[]
  subtypeClusters: SubtypeCluster[]
  constraintSpans: ConstraintSpan[]
}

type ModelMeta = {
  name?:    string
  version?: string
  desc?:    string
  updated?: Date
}

type GroupInfo = {
  name: string
  desc: string
}

type Node = {
  name:            EntityName
  desc?:           string
  classification:  'independent' | 'dependent' | 'subtype' | 'basetype' | 'associative' | 'classifier'   // DERIVED
  primaryGroup?:   GroupName                                                                              // DERIVED
  effectiveGroups: GroupName[]                                                                            // DERIVED (primary + ancestors)
  pk:              ColumnName[]
  ak:              AlternateKey[]
  columns:         Column[]
  values?:         Array<Record<string, unknown>>
  constraints:     Constraint[]
}

type Column = {
  name:         ColumnName
  type:         LogicalType
  nullable:     boolean
  default?:     string
  desc?:        string
  isPK:         boolean              // DERIVED — column appears in entity.pk
  isFK:         boolean              // DERIVED — column appears as child-side in some edge.on
  akMembership: string[]             // DERIVED — list of AK IDs this column belongs to
}

type AlternateKey = {
  id:      string                    // DERIVED — ak_<entity_snake>_<rule_snake>
  rule:    string
  desc?:   string
  columns: ColumnName[]
}

type Cardinality = '1' | '0..1' | 'many'

type Edge = {
  parent:      EntityName
  child:       EntityName
  kind:        'identifying' | 'referential'
  on:          Map<ChildColumn, ParentColumn>
  predicate:   { fwd: string; rev: string }
  cardinality: { parent: Cardinality; child: Cardinality }    // DERIVED
  desc?:       string
  clusterRef?: SubtypeCluster                                  // populated if this is the IS A edge from a subtype to its basetype
}

type SubtypeCluster = {
  basetype:  EntityName
  exclusive: boolean
  members:   SubtypeMember[]
  desc?:     string
}

type SubtypeMember = {
  subtype:        EntityName
  discriminator?: { column: ColumnName; classifierPath: string }   // exclusive only
}

type Constraint = {
  id:     string                     // DERIVED — <entity_snake>_<rule_snake>
  rule:   string
  desc?:  string
  spans?: EntityName[]
}

type ConstraintSpan = {
  source:       EntityName           // entity that owns the constraint
  target:       EntityName           // entity referenced in spans
  constraintId: string               // refers back to source.constraints[].id
}
```

**Rationale for the shape:**

- **Nodes and edges are flat lookups.** Entities can have multiple parents (associatives, multi-parent identifying); no tree shape would fit. Map of entities + list of edges = clean topology.
- **`subtypeClusters` is separate from `edges`.** The IS A edges from subtypes to basetype DO appear in `edges` as `kind: 'identifying'`. Cluster metadata (exclusive flag, discriminator) lives separately so the renderer can draw a single joiner instead of N parallel arrows.
- **`constraintSpans` is a separate list.** They're documentation overlays, not topology. The layout engine ignores them entirely; only the renderer uses them for dotted lines.

---

## 4. Derivation Rules

Everything in this section is computed at parse time and stored on the structure. The YAML doesn't carry these fields.

### 4.1 Classification

For each entity, evaluated in order — first match wins:

1. Has a `subtypes:` block → **basetype**.
2. Appears as a member in some other entity's `subtypes:` cluster → **subtype**.
3. Has 2+ identifying parents → **associative**.
4. Has 1+ identifying parent → **dependent**.
5. Has no identifying parents AND no outgoing identifying edges AND single-column PK AND referenced as parent in ≥1 referential edges AND fits the lookup shape → **classifier**.
6. Otherwise → **independent**.

The "lookup shape" check for rule 5 requires:
- At most 3 columns total, AND
- At least one column named `description`, `desc`, `label`, or `name`.

Without this tightening, every small independent entity that happens to be referenced (like `Product` or `Subscription`) gets mis-classified as a classifier. The lookup-shape check is heuristic, not perfect — if it ever fails for a real case, the resolution is to add an explicit `role: classifier` flag on the entity. That's a future extension; not in the current grammar.

Note: an entity can be both basetype and dependent (e.g., `Identity` in the sample model). Rule 1 wins because the layout treatment is more specific.

### 4.2 Effective Groups

For each entity, `effectiveGroups` is the union of:

1. The entity's own declared `groups:` (if any).
2. The `effectiveGroups` of every entity it has an **identifying** relationship to (recursive walk).

Inheritance flows downward through identifying relationships only. Referential parents do NOT propagate groups.

For a subtype, the basetype is an identifying parent (the IS A edge); inheritance flows through it.

For an associative entity with multiple identifying parents, the inherited set is the union from all parents.

### 4.3 Primary Group

The single "most specific" group for visual placement:

- If the entity declares `groups:` explicitly → last entry in the declared list (right-most = most specific by convention).
- Else → last entry in `effectiveGroups` after the inheritance walk completes.

For an associative entity that declares no `groups:` and inherits a set whose entries come from different parent chains, the renderer places the entity in the spatial gap between its parent groups rather than picking arbitrarily.

### 4.4 Cardinality

For each edge, computed from PK structure + cluster context + FK nullability.

**Identifying edges:**

| Condition | parent | child |
|---|---|---|
| Edge is part of a subtype cluster (`clusterRef` set) | `1` | `0..1` |
| `child.pk` equals `parent.pk` exactly (non-subtype) | `1` | `1` |
| `child.pk` equals `parent.pk` plus local columns | `1` | `many` |

The cluster joiner (X for exclusive, inclusive variant for inclusive) carries the cluster-level semantics on top of the individual edge cardinality.

**Referential edges:**

Inspect the FK columns on the child:

| Parent end determined by | Child end determined by | Resulting cardinality |
|---|---|---|
| All FK cols non-nullable | FK cols form an AK | 1 : 1 |
| All FK cols non-nullable | FK cols not in any AK | 1 : many |
| Any FK col nullable | FK cols form an AK | 0..1 : 1 |
| Any FK col nullable | FK cols not in any AK | 0..1 : many |

**M:N is structurally impossible.** Attempting to express it requires declaring an associative entity, which by construction resolves into two 1:N identifying edges.

This derivation yields all IDEF1X cardinality codes (1, Z, P) without any author input.

### 4.5 Derived IDs

- `Constraint.id = <entity_snake>_<rule_snake>`
- `AlternateKey.id = ak_<entity_snake>_<rule_snake>`

`<entity_snake>` is the entity name converted to snake_case (PascalCase / Title_Case / camelCase → snake_case, with `_` already present preserved as-is).

`<rule_snake>` is the rule phrase with whitespace collapsed to single underscores, lowercased.

IDs must be globally unique after derivation (validation 13).

### 4.6 Column Flags

For each column on each node:

- `isPK` ← column name appears in `entity.pk`
- `isFK` ← column name appears as a key (child side) in any `edge.on` where this entity is the child
- `akMembership` ← list of AK IDs (`ak.id`) where this column appears in the AK's `columns`

---

## 5. Validation Rules

Two validation passes:

- **Structural** (during parse, §2): shape, required keys, type checks. Catches malformed YAML before any semantic work.
- **Semantic** (after build + derive, this section): reference resolution, consistency, cycle detection.

Semantic checks below; each one halts the pipeline on first error encountered, with phase + location attribution for clear error messages.

1. **Group references resolve.** Every group name in any entity's effective groups must appear in `_groups`.
2. **PK non-empty.** Every entity has at least one column in `pk`.
3. **PK columns exist.** Every column listed in `pk` is declared in `columns`.
4. **AK columns exist.** Every column listed in any AK's `columns` is declared in `columns`.
5. **AK non-empty.** Every AK has at least one column.
6. **Anchor columns exist.** For every edge, every child column in `on` is declared on the child; every parent column in `on` is declared on the parent.
7. **Identifying anchor matches parent PK.** For each identifying edge, the set of parent columns in `on` must equal the parent's PK exactly.
8. **Subtype PK equals basetype PK.** Each subtype's `pk` equals its basetype's `pk` column-by-column.
9. **Subtype belongs to exactly one cluster.** No subtype is a member of multiple clusters.
10. **Exclusive cluster members resolve.** Every `Table.column.VALUE` path resolves to a real entity, a real column on that entity, and a real value in that entity's `values:` block.
11. **Constraint spans resolve.** Every entity named in any `constraints[].spans` exists.
12. **No identifying cycles.** The graph of identifying edges (including subtype IS A edges) is a DAG.
13. **ID uniqueness.** All derived AK IDs and constraint IDs are globally unique.
14. **Predicates non-empty.** Every relationship has both `predicate.fwd` and `predicate.rev` as non-empty strings.
15. **Identifying FK is non-nullable.** No identifying edge may have any nullable child column in its `on` map. (Identifying means the FK is part of the PK; PK columns can't be null.)

---

## 6. Layout Algorithm

Output is a flat coordinate map: `{ entityName: { group, x, y, width, height } }`. Two passes:

### 6.1 Pass A — Within-Group Hierarchy (Sugiyama)

For each group island, collect entities whose `primaryGroup` equals this group, and the identifying edges between them. Apply Sugiyama's four phases:

1. **Cycle removal.** No-op for ER models (validation 12 guarantees a DAG).
2. **Layer assignment.** Longest-path: `layer(node) = max(layer(parent), 0) + 1` over identifying parents within the group. Roots → layer 0. Subtypes → one layer below their basetype.
3. **Crossing reduction.** Order siblings within each layer to minimize edge crossings between adjacent layers. Use barycenter or median heuristic — both are O(n log n) per pass and converge in 2–3 iterations. Insert dummy vertices for any in-group edge spanning more than one layer.
4. **Coordinate assignment.** Convert (layer, position-in-layer) into (x, y) within the group's bounding box.

The group's bounding box dimensions are determined by its contents — no fixed cell size. Cross-group edges are not present in this pass; they're handled after pass B.

### 6.2 Pass B — Group Placement

Treat each group as a super-node with the bounding box from pass A. Build a meta-graph where meta-edges are aggregated cross-group relationship counts. Apply a force-directed pass (Fruchterman-Reingold or similar) — groups with more cross-edges sit closer; isolated groups drift to the margins. The meta-graph is small (typically 3–10 nodes), so this converges in milliseconds.

**Classifier gutter.** Classifiers referenced by entities from multiple groups go in a dedicated side gutter at the canvas margin, not as a group island. Classifiers referenced only from one group stay within that group's island. Decision is per-classifier, made during this pass.

---

## 7. Edge Routing and Ports

This phase exists to satisfy two visual-clarity rules:

- **Edges must not pass through other nodes.**
- **No two edges may share the same endpoint on a node.** Every edge that meets a node terminates at its own dedicated port so each cardinality marker is independently visible.

### 7.1 Port Assignment

Each node has four edge zones along its boundary: top, right, bottom, left. Each zone is subdivided into `N` evenly-spaced port slots, where `N` scales with the number of edges incident on that zone (minimum spacing of 12 px between ports). Default starting layout assumes ≤ 4 ports per side; the renderer expands the node height/width if more are needed.

**Assignment rules (in order):**

1. For each node, gather all incident edges (incoming and outgoing).
2. For each edge, choose the natural zone based on the other endpoint's position:
   - Other endpoint above → top zone
   - Below → bottom zone
   - Left → left zone
   - Right → right zone
3. Within each zone, order edges along the boundary in the order their other endpoints sort along the perpendicular axis. (For a top zone, sort by the other endpoint's x-coordinate.)
4. Distribute the ports evenly across the zone's available length.

Subtype joiners are special: a single port on the basetype (centered on its bottom edge) connects to the joiner glyph, and from the joiner one port per subtype connects down.

### 7.2 Orthogonal Edge Routing

After ports are assigned, route each edge as an orthogonal path (right-angle bends only) from source port to target port.

**Algorithm: A\* over the orthogonal visibility graph.** (Wybrow et al. 2009 is the well-cited reference.)

1. Build a visibility graph: nodes (the rectangles) are obstacles; the visibility graph consists of all horizontal and vertical lines through node corners and ports, with intersections as graph vertices.
2. For each edge, run A* from source port to target port, with the cost function:
   - Primary: path length
   - Secondary: bend count (each 90° turn adds a fixed penalty)
   - Tertiary: number of shared segments with already-routed edges (encourage edge bundling along common corridors when there's no other cost)
3. After all edges are routed, run a **nudge pass**: for parallel edges sharing a common segment, separate them by a small offset (typically 6–10 px) to keep their lines independently visible.

**Routing priorities (hard → soft):**

1. **Hard constraint**: an edge never passes through a node's interior.
2. **Hard constraint**: an edge never shares an endpoint with another edge on the same node.
3. **Soft preference**: minimize crossings with other edges. The visibility-graph A* with bend penalty gets most of this; a post-pass swap-test on adjacent crossings can squeeze out a few more.
4. **Soft preference**: minimize bend count.
5. **Soft preference**: short paths.

When (3) and (4) conflict, prefer (3) — clarity beats compactness.

### 7.3 Constraint-Span Routing

Constraint-span edges (`ConstraintSpan` entries, rendered as dotted lines) are routed after all structural edges. They use the same visibility-graph A* but with **higher bend penalty** so they curve around rather than competing for the cleanest corridors. They get lower priority on port slots — structural edges always get their preferred ports first, constraint-span edges take what's left.

### 7.4 Output

Edge routing produces, for each edge, a polyline:

```typescript
type RoutedEdge = Edge & {
  sourcePort: { x: number; y: number; side: 'top'|'right'|'bottom'|'left' }
  targetPort: { x: number; y: number; side: 'top'|'right'|'bottom'|'left' }
  waypoints: Array<{ x: number; y: number }>   // includes source port at [0] and target port at [last]
}
```

The renderer consumes the polyline directly. Cardinality end markers attach at `sourcePort` and `targetPort`, oriented according to the `side`.

---

## 8. Rendering

### 8.1 Stack

The rendering layer uses **React Flow** (from the XYFlow project) for the interactive shell — viewport, pan/zoom, drag, selection, click — and **D3** primitives for IDEF1X-specific visual elements (marker glyphs, joiner symbols, path generation).

- Layout is computed by the TypeScript pipeline (§3–§7) and passed to React Flow as fully-positioned nodes and routed edges.
- Custom React Flow node components render IDEF1X entity boxes with the right shape, content, and click behavior.
- A custom React Flow edge component consumes the routed polyline and renders the SVG path plus end markers.

### 8.2 Node Shapes

- **Independent** → rectangular box, square corners.
- **Dependent** → rectangular box, rounded corners.
- **Subtype** → rectangular box, rounded corners.
- **Associative** → rectangular box, rounded corners. Optional "A" badge in corner.
- **Classifier** → smaller rectangular box with "C" badge. Placed in the classifier gutter.
- **Basetype** → rectangular box, square corners if independent, rounded if dependent.

### 8.3 Node Content (Collapsed View)

By default, each node displays:

- **Header**: entity name.
- **PK section**: PK column names with PK indicator.
- **AK section** (if any): AK columns with their derived ID label.
- **FK section** (if any): FK columns with FK indicator and a thin pointer to the parent entity.

All other columns hidden until expanded.

### 8.4 Subtype Joiners

For each `SubtypeCluster`:

- A single edge from the basetype's bottom port to a joiner symbol.
- **Joiner symbol**:
  - `exclusive: true` → **X** in a small circle.
  - `exclusive: false` → shaded/striped triangle (inclusive marker).
- Lines branch from the joiner to each subtype's top port.

The joiner is a synthetic node positioned between basetype and subtype layers — it participates in port assignment and routing the same way as a real node.

### 8.5 Edge Styles

| Edge type | Style | Source |
|---|---|---|
| Identifying (not in cluster) | Solid line | `edge.kind = 'identifying'`, `clusterRef` unset |
| Subtype cluster | Solid line through joiner | aggregated per cluster |
| Referential | Dashed line | `edge.kind = 'referential'` |
| Constraint span | Dotted line, lower opacity | `constraintSpans` entries |

### 8.6 End Markers (Cardinality)

Drawn at the port where the edge meets the node, computed from `edge.cardinality`:

| End | Cardinality value | Marker |
|---|---|---|
| Child | `many` | Crow's foot |
| Child | `1` | Single bar |
| Child | `0..1` | Bar + open circle |
| Parent | `1` | (no marker — mandatory default) |
| Parent | `0..1` | Open diamond |

Markers are oriented based on the port's `side` so they always read outward from the node.

### 8.7 Groups

Each group renders as a soft-outlined region encompassing its member entities, with the group name as a header label. **Color is not used to distinguish groups** (color is reserved for entity classification). Groups use background tint and outline only.

### 8.8 Click-to-Expand Panel

Clicking a node opens a detail panel:

**Columns table:**

| Column | Type | Key | Nullable | Default | Description |

Plus separate sections:

- **AKs** — ID, columns, rule, description.
- **Constraints** — ID, rule, description, spans (if any).
- **Values** (classifiers / reference data) — full table of seed rows.
- **Subtype cluster details** (basetypes only) — exclusivity flag, member list, discriminator column and path.
- **Identifying parents** — list of parent entities and on-mappings.
- **Referential parents** — list of parent entities and on-mappings.
- **Children referencing this** (derived from the edge list) — list of entities pointing to this one, with kind.

---

## 9. Out of Scope

- Engine-specific DDL generation (SQL Server T-SQL, PostgreSQL, Oracle, etc.). The model is platform-neutral by design; engine translation is a downstream concern.
- Non-unique indexes for performance. Distinct from AKs, which are uniqueness constraints.
- Soft-delete patterns, audit columns (`created_at`, `updated_by`). Model as regular columns if needed.
- Schemas / namespaces. Groups handle the equivalent visualization concern.
- Many-to-many relationships without an explicit associative table. Structurally impossible.
- Polymorphic FK patterns (single FK pointing to one of several entity types). Express via subtype clusters or separate role-named FKs.
- Live editing of the diagram modifying the YAML round-trip. The YAML is the source of truth; the diagram is read-only output.
- Multi-file YAML or includes. A model is a single document.

---

## 10. Pipeline Summary

```
                            ┌──────────────────────┐
                            │     YAML source      │
                            └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │  Stage 1: parse.ts   │   structural checks
                            │   → RawDoc + Issues  │   (YAML 1.2 parser)
                            └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │  Stage 2: build.ts   │   assemble Model
                            │       → Model        │   (nodes/edges/clusters)
                            └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │  Stage 3: derive.ts  │   classification,
                            │  → Model (enriched)  │   groups, cardinality
                            └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │ Stage 4: validate.ts │   15 semantic checks
                            │       → Issues       │
                            └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │  Stage 5: layout.ts  │   Sugiyama per group +
                            │     → positions      │   group placement
                            └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │ Stage 6: routing.ts  │   port assignment +
                            │ → routed polylines   │   A* orthogonal routing
                            └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │   React Flow + D3    │   interactive shell,
                            │      (rendering)     │   IDEF1X primitives
                            └──────────────────────┘
```

Stages 1–6 are pure functions producing typed outputs. The renderer is the only stateful piece. Each stage can be tested in isolation against the previous stage's output.

---

*End of specification.*
