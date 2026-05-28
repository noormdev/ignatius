# IDEF1X Graphing Engine — Spec

> **⚠ HISTORICAL — superseded.** This is the original single-YAML-file design from the start of the project. The shipped tool uses per-entity markdown files with YAML frontmatter, organized under `models/<group>/*.md`. Groups are defined in `models/_groups/*.md`, theme in `models/_theme.yaml`.
>
> Current docs:
> - `docs/design/markdown-driven-erd.md` — current architecture and source format
> - `docs/spec/cli-and-outputs.md` — the shipped CLI tool spec
>
> This file is kept for historical reference only — it documents principles and derivation rules (cardinality, classification, subtypes) that still apply, but the YAML grammar in §2 is NOT how the tool reads input today.

A YAML-driven IDEF1X-style data model authoring tool. The user writes YAML; the tool parses it, validates it semantically, computes a layout, and renders the diagram in the browser.

This spec describes only what is actually built. Speculative routing algorithms, custom port systems, and any feature not yet shipped are deliberately out.

Reading order: principles (§1) → grammar (§2) → data model (§3) → derivations (§4) → validation (§5) → layout (§6) → rendering (§7) → app shell (§8) → out of scope (§9).



## 1. Principles

- **Platform-neutral logical modeling.** Logical types only: `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary`. No engine dialects.
- **IDEF1X-faithful relationships.** Identifying and referential are the two kinds. Key migration is the structural mechanism.
- **Subtypes are identity sharing, not composition.** A subtype's PK equals its basetype's PK exactly.
- **Within-table inference allowed; cross-table inference forbidden.** Each entity is fully self-describing in isolation. Both sides of an IS A reinforce each other — the basetype lists members, the subtype declares its identifying relationship back. That is reinforcement, not redundancy.
- **Default-deny on nullability.** All columns are non-nullable unless `nullable: true` is opted in.
- **Rule-named constraints and AKs.** Their natural-language `rule:` becomes the global ID after snake-casing and prefixing.
- **Cardinality is derived, not declared.** PK structure + cluster context + FK nullability fully determines it.
- **M:N requires an explicit associative entity.** Structurally enforced.



## 2. YAML Grammar

### 2.1 Top level

A flat YAML 1.2 map. Top-level keys are either meta-blocks (`_`-prefixed) or entity definitions.

    _meta:    { ... }   # optional model metadata
    _groups:  { ... }   # optional group declarations

    EntityA:  { ... }   # entity definitions
    EntityB:  { ... }

The underscore prefix is reserved for meta-blocks. Entity names may not start with one. The `yaml` npm package (YAML 1.2) is used so the bare keyword `on` is not coerced to a boolean.

### 2.2 `_meta`

Optional. Model-level documentation.

    _meta:
      name:    "Model Name"
      version: "0.1.0"
      desc:    "Description of the model"
      updated: 2026-05-08

All fields optional. Surfaced in the data dictionary; not consumed by layout.

### 2.3 `_groups`

Optional. Declares the visual modules.

    _groups:
      accounts: "Description of accounts group"
      payments: "Description of payments group"

Map of group name → description. Every group name referenced from an entity's `groups:` field must appear here.

### 2.4 Entity body

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

Required: `pk`, `columns`. All others optional.

### 2.5 Columns

    columns:
      column_name: { type: integer, nullable: true, default: 0, desc: "..." }

- `type` (required): one of `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary`.
- `nullable` (default `false`): opt-in only.
- `default` (optional): logical default value, literal or function name (`now`). Documentation only.
- `desc` (optional): free-form description.

Migrated FK columns are declared explicitly. The relationship's `on:` map binds them to the parent's columns.

### 2.6 Alternate keys (`ak`)

    ak:
      - rule:    "unique tax identifier"
        desc:    "Tax ID must be unique across all rows"
        columns: [tax_id]

- `rule` (required): semantic phrase. Snake-cased and prefixed with `ak_<entity_snake>_` to derive the global ID (`ak_business_unique_tax_identifier`).
- `desc` (optional): longer explanation.
- `columns` (required): one or more columns forming the AK.

### 2.7 Relationships

Relationships live on the **child** entity (the FK side). The parent never back-declares except in the subtype case (§2.8).

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

- Keyed by parent entity name (single relationship to that parent).
- `on` (required): map of child column → parent column. Composite keys carry multiple pairs.
- `predicate` (required): `{ fwd, rev }`, independently authored verbs. `fwd` reads parent→child, `rev` reads child→parent. Neither is derived from the other.

For multiple FKs to the same parent (anti-pattern, but supported), the value becomes an array. This usually indicates a smell — refactor into an associative-with-role-classifier when possible.

### 2.8 Subtype clusters

    subtypes:
      - desc:      "Optional cluster description"
        exclusive: true                            # true = X-joiner, false = inclusive
        members:                                   # MAP for exclusive, LIST for inclusive
          SubtypeA: { discriminator_col: ClassifierTable.column.VALUE }
          SubtypeB: { discriminator_col: ClassifierTable.column.OTHER_VALUE }

A list — a basetype may have multiple independent clusters.

- `exclusive` (required): boolean.
- `members`:
    - **exclusive**: map of subtype name → discriminator check `{ basetype_column: classifier_path }`. The path is `Table.column.VALUE` — three parts, dot-joined.
    - **inclusive**: list of subtype names. Membership is existence-based; no discriminator column on the basetype.

Subtype entities themselves declare their own `pk` (equal to basetype PK), `columns`, and an explicit identifying relationship back to the basetype with `predicate: { fwd: "...", rev: "is a" }`. Reinforcement is required.

### 2.9 Values (seed data)

Optional. Sample or reference rows, useful primarily on classifiers.

    values:
      PRIMARY_KEY_VALUE: { description: "...", other_col: "..." }
      ANOTHER_VALUE:     { description: "..." }

Map keyed by single-column PK value. For composite PKs, fall back to array form:

    values:
      - { col_a: x, col_b: y, other: "..." }

### 2.10 Constraints

    constraints:
      - rule:  "natural language constraint phrase"
        desc:  "Longer explanation"
        spans: [OtherEntity, AnotherEntity]

- `rule` (required): semantic phrase. Snake-cased and prefixed with `<entity_snake>_` to derive the global ID.
- `desc` (optional): explanation. Engineers translate to CHECK / trigger / function in the target engine.
- `spans` (optional): list of other entities the constraint references. Presence triggers a dotted overlay edge in the diagram.



## 3. Data Model

Produced by the parser; consumed by layout and rendering. The YAML is not re-read after parse.

    type Model = {
      meta:            ModelMeta
      groups:          Map<GroupName, GroupInfo>
      nodes:           Map<EntityName, Node>
      edges:           Edge[]
      subtypeClusters: SubtypeCluster[]
      constraintSpans: ConstraintSpan[]
    }

    type Node = {
      name:            EntityName
      desc?:           string
      classification:  'independent' | 'dependent' | 'subtype' | 'basetype' | 'associative' | 'classifier'   // DERIVED
      primaryGroup?:   GroupName                                                                              // DERIVED
      effectiveGroups: GroupName[]                                                                            // DERIVED
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
      isPK:         boolean              // DERIVED
      isFK:         boolean              // DERIVED
      akMembership: string[]             // DERIVED
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
      clusterRef?: SubtypeCluster                                  // set if this is the IS A edge
    }

    type SubtypeCluster = {
      basetype:  EntityName
      exclusive: boolean
      members:   { subtype: EntityName; discriminator?: { column: ColumnName; classifierPath: string } }[]
      desc?:     string
    }

    type ConstraintSpan = {
      source:       EntityName     // entity that owns the constraint
      target:       EntityName     // entity referenced in spans
      constraintId: string
    }

Nodes and edges are flat lookups because entities can have multiple parents (associatives, multi-parent identifying); no tree shape would fit.

Subtype-cluster metadata is separate from the edge list. The IS A edges still appear in `edges` as `kind: 'identifying'`, but the cluster's exclusive flag and discriminators live on `subtypeClusters` so a renderer can draw a single joiner instead of N parallel arrows.

`constraintSpans` are documentation overlays. Layout ignores them; only the renderer touches them.



## 4. Derivations

Computed at parse time.

### 4.1 Classification

Per entity, first-match-wins:

1. Has a `subtypes:` block → **basetype**.
2. Appears as a member in some other entity's `subtypes:` cluster → **subtype**.
3. Has 2+ identifying parents → **associative**.
4. Has 1+ identifying parent → **dependent**.
5. Single-column PK AND no outgoing identifying AND referenced as parent in ≥1 referential edges AND ≤3 columns AND has a column named `description`/`desc`/`label`/`name` → **classifier**.
6. Otherwise → **independent**.

The lookup-shape check on rule 5 is heuristic. Without it, every small independent entity that happens to be referenced (e.g. `Product`, `Subscription`) gets mis-classified as a classifier. If the heuristic ever fails on a real model, the resolution is to add an explicit `role: classifier` flag on the entity. That extension is not in the current grammar.

An entity can be both basetype and dependent (e.g., `Identity` in the sample). Rule 1 wins because the basetype layout treatment is more specific.

### 4.2 Effective groups

Per entity, the union of:

1. The entity's own declared `groups:` (if any).
2. The `effectiveGroups` of every entity it has an **identifying** relationship to (recursive walk).

Inheritance flows downward through identifying relationships only. Referential parents do NOT propagate groups. For a subtype, the basetype is an identifying parent (the IS A edge); inheritance flows through it.

### 4.3 Primary group

The single most-specific group used for visual placement:

- If the entity declares `groups:` explicitly → last entry in the declared list (right-most = most specific by convention).
- Else → last entry in `effectiveGroups` after the inheritance walk completes.

### 4.4 Cardinality

**Identifying edges:**

| Condition | parent | child |
|---|---|---|
| Edge is part of a subtype cluster (`clusterRef` set) | `1` | `0..1` |
| `child.pk` equals `parent.pk` exactly (non-subtype) | `1` | `1` |
| `child.pk` equals `parent.pk` plus local columns | `1` | `many` |

**Referential edges:**

| FK columns nullability | FK columns form an AK on the child | parent | child |
|---|---|---|---|
| All non-nullable | yes | `1` | `1` |
| All non-nullable | no | `1` | `many` |
| Any nullable | yes | `0..1` | `1` |
| Any nullable | no | `0..1` | `many` |

(`1` on the child end is shorthand for "at most one"; the strict `0..1` interpretation is equivalent in IDEF1X notation.)

**M:N is structurally impossible** — declaring it requires an associative entity, which by construction resolves to two 1:N identifying edges.

### 4.5 Derived IDs

- `Constraint.id = <entity_snake>_<rule_snake>`
- `AlternateKey.id = ak_<entity_snake>_<rule_snake>`

Snake-case rule: PascalCase / camelCase → snake_case, whitespace and hyphens collapse to single underscores, lowercase. IDs must be globally unique (validation 13).

### 4.6 Column flags

For each column on each node:

- `isPK` ← column name appears in `entity.pk`.
- `isFK` ← column name appears as a child-side key in any `edge.on` where this entity is the child.
- `akMembership` ← list of AK IDs where this column appears.



## 5. Validation

Two passes:

- **Structural** (during parse): shape, required keys, type checks. Catches malformed YAML before any semantic work.
- **Semantic** (after build + derive): reference resolution, consistency, cycle detection.

Semantic checks (each halts on first error with phase + location):

1. **Group references resolve.** Every group name in any entity's effective groups exists in `_groups`.
2. **PK non-empty.** Every entity has at least one column in `pk`.
3. **PK columns exist.** Every column listed in `pk` is declared in `columns`.
4. **AK columns exist.** Every column listed in any AK's `columns` is declared in `columns`.
5. **Anchor columns exist.** Every child column in `on` is declared on the child; every parent column in `on` is declared on the parent.
6. **Identifying anchor matches parent PK.** For each identifying edge, the set of parent columns in `on` equals the parent's PK exactly.
7. **Subtype PK equals basetype PK.** Each subtype's `pk` equals its basetype's `pk` column-by-column.
8. **Subtype belongs to exactly one cluster.** No subtype is a member of multiple clusters.
9. **Exclusive cluster members resolve.** Every `Table.column.VALUE` path resolves to a real entity, a real column on that entity, and a value present in that entity's `values:` block.
10. **Constraint spans resolve.** Every entity named in any `constraints[].spans` exists.
11. **No identifying cycles.** The graph of identifying edges (including subtype IS A edges) is a DAG.
12. **ID uniqueness.** All derived AK IDs and constraint IDs are globally unique.
13. **Identifying FK is non-nullable.** No identifying edge may have any nullable child column in its `on` map.

(Predicates non-empty and AK non-empty are enforced structurally in parse and don't need a second pass.)



## 6. Layout

Output is a flat coordinate map: `Map<EntityName, { group, x, y, width, height }>`. Two passes.

### 6.1 Within-group hierarchy (Sugiyama)

For each group island, collect entities whose `primaryGroup` equals this group, and the identifying edges between them. Apply Sugiyama-style layering:

1. **Layer assignment.** Longest-path: `layer(node) = max(layer(parent), 0) + 1` over identifying parents within the group. Roots → layer 0.
2. **Order within layer.** Sort siblings under the same parent together, then alphabetically within each parent group.
3. **Coordinate assignment.** Convert (layer, position-in-layer) into (x, y) within the group's local box.

The group's bounding box is determined by its contents — no fixed cell size. Cross-group edges are not placed in this pass.

### 6.2 Group placement

Place each group as a super-node. Current implementation: deterministic 3-column arrangement, sorting groups by cross-edge weight (heaviest groups go to the center column). The meta-graph is small (typically 3–10 groups), so a force-directed pass would converge instantly if we want to upgrade later, but the deterministic version is enough for the sample model.



## 7. Rendering

Stack: **React 19 + React Flow (`@xyflow/react`) + plain SVG markers**. No D3.

### 7.1 What the renderer consumes

The engine produces a typed `RenderModel`:

- `nodes`: positioned per §6, classified per §4.1.
- `edges`: from `model.edges`, with cardinality from §4.4, kind, and `clusterRef`.
- `subtypeClusters`: for joiner glyphs (rendered separately, not yet implemented).
- `constraintSpans`: rendered as dotted overlay edges.

### 7.2 Node rendering

Custom React Flow node component. Visual variation by classification:

| Classification | Shape |
|---|---|
| `independent` | Square corners |
| `dependent`, `subtype`, `associative`, `basetype` | Rounded corners |
| `classifier` | Smaller box, distinct accent |

Node body shows: header (entity name), PK columns, AK columns (with derived ID label), FK columns. Other columns are hidden in collapsed view.

### 7.3 Edge rendering

Custom React Flow edge component:

| Edge kind | Style |
|---|---|
| Identifying (not in cluster) | Solid |
| Identifying through joiner | Solid (joiner not yet implemented) |
| Referential | Dashed |
| Constraint span | Dotted, lower opacity |

End markers (cardinality) attach at edge endpoints as static SVG `<marker>` defs. Crow's foot, single bar, bar+circle, open diamond. Drawn from `edge.cardinality`.

### 7.4 Routing

Current: React Flow's default edge routing (bezier or smoothstep) — edges may pass through node interiors when paths get crowded. This is a deliberate limitation for v1; custom orthogonal routing with port assignment is deferred until the visual quality from the defaults is no longer enough.

### 7.5 Color

Color is reserved for entity classification per §7.2. Groups use background tint and outline, not color.



## 8. App Shell

Single-page Bun + React app. Two panes:

- **Left**: Monaco YAML editor. Loaded with the bundled sample on first visit; user-edited content persists to `localStorage` (debounced).
- **Right**: React Flow graph rendering the current YAML.

On every YAML change, the engine pipeline runs end-to-end and the graph re-renders. Validation issues surface in a small panel that overlays the graph view (or a status strip).

A reset button restores the bundled sample and clears localStorage.



## 9. Out of Scope

- Engine-specific DDL generation. Logical model only.
- Non-unique indexes (distinct from AKs).
- Soft-delete / audit columns. Model as regular columns if needed.
- Schemas / namespaces. Groups are the analog.
- M:N without an associative.
- Polymorphic FK patterns. Express via subtype clusters or role-named FKs.
- Live editing of the diagram modifying the YAML round-trip. YAML is the source of truth.
- Multi-file YAML or includes.
- Custom orthogonal edge routing (deferred — see §7.4).
- Subtype joiner glyphs (deferred — drawn as plain edges for now).
- Click-to-expand detail panel (deferred).



## 10. Pipeline Summary

    YAML source
        │
        ▼  parse.ts        (structural validation, YAML 1.2)
    RawDoc + Issues
        │
        ▼  build.ts        (assemble nodes/edges/clusters/spans)
    Model
        │
        ▼  derive.ts       (classification, groups, cardinality)
    Model (enriched)
        │
        ▼  validate.ts     (13 semantic checks)
    Issues
        │
        ▼  layout.ts       (Sugiyama within groups + group placement)
    NodePosition map
        │
        ▼  React + React Flow
    Rendered diagram

Stages 1–5 are pure functions producing typed outputs. Each stage can be tested in isolation against the previous stage's output. The renderer is the only stateful piece.
