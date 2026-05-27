# Markdown-Driven IDEF1X ERD Visualizer — Design Document


## Overview

A tool for authoring and exploring IDEF1X-style relational data models where:

- The source of truth is markdown. Each entity lives in its own `.md` file with YAML frontmatter for graph structure and a prose body for documentation.
- The visual is generated, not hand-drawn. A Cytoscape.js graph view is derived deterministically from the markdown corpus using ELK's layered algorithm.
- Clicking a node shows the entity's rendered markdown documentation in a side panel.


## Source Format

One markdown file per entity in a `models/` directory. A `_config.yaml` at the root defines groups and their colors.

### Entity file structure

```markdown
---
entity: EntityName
classification: Independent
group: identity
pk:
  - col_a
  - col_b
columns:
  col_a: { type: integer }
  col_b: { type: text, nullable: true }
ak:
  - rule: "unique whatever"
    columns: [col_b]
relationships:
  - target: ParentEntity
    identifying: true
    on:
      col_a: parent_col
    predicate: "is part of"
subtypes:
  - exclusive: true
    members:
      ChildA: { discriminator_col: Classifier.column.VALUE }
      ChildB: { discriminator_col: Classifier.column.OTHER }
---

# Entity Name

Prose documentation, attribute tables, business rules, constraints.
```

### `_config.yaml`

```yaml
groups:
  identity:
    label: Identity & Accounts
    color: "#2ea043"
  transactional:
    label: Transactional
    color: "#d29922"
  catalog:
    label: Catalog
    color: "#58a6ff"
  reference:
    label: Reference / Enumerable
    color: "#6e7681"
```


## Key Decisions

### Cardinality is derived, never declared

PK structure + relationship type + FK nullability fully determine cardinality. No `cardinality` field exists in the frontmatter.

**Identifying edges** (parent PK migrates into child PK):

| Condition | Parent | Child |
|---|---|---|
| Child is a subtype | 1 | 0..1 |
| Child PK equals FK columns exactly | 1 | 1 |
| Child PK has columns beyond FK | 1 | many |

**Referential edges** (parent PK migrates as non-PK FK):

| FK nullable | FK forms AK on child | Parent | Child |
|---|---|---|---|
| No | Yes | 1 | 1 |
| No | No | 1 | many |
| Yes | Yes | 0..1 | 1 |
| Yes | No | 0..1 | many |

### Relationships use `on:` column mappings

Following the original spec, relationships declare `on: { child_col: parent_col }` to explicitly map FK columns to parent columns. Composite keys carry multiple pairs.

### Classification is structural, not role-based

Classification determines visual shape (square vs rounded corners). It is derived from the entity's identifying parent count, not from whether it hosts subtypes.

| Rule (first match wins) | Classification |
|---|---|
| Appears as member in another entity's `subtypes` cluster | Subtype |
| Has 2+ identifying parents | Associative |
| Has 1 identifying parent | Dependent |
| Single-column PK, no identifying parents, ≤3 columns, has a description/name column, has `values` | Classifier |
| Otherwise | Independent |

An entity can be both Independent and host subtypes (e.g., Party). An entity can be both Dependent and host subtypes (e.g., Identity). The basetype role is expressed through the `subtypes` frontmatter block and rendered via diamond joiners — it does not override the structural classification.

### Groups are color-only, not spatial

Groups assign border color and pastel background fill to nodes. They do not influence layout proximity. Defined in `_config.yaml`, referenced by `group:` in each entity's frontmatter. Entities without a group fall back to a neutral gray.

### Subtype clusters use diamond joiners

Subtype relationships are visualized by inserting a diamond-shaped joiner node between the basetype and its subtypes:

- **Exclusive** (exactly one subtype applies): diamond displays "X". The basetype has a discriminator column.
- **Inclusive** (any combination of subtypes): diamond is empty. Membership is existence-based.

The identifying edges from subtypes to the basetype are rewired through the joiner for visual clarity.


## Visual Notation

### Node shapes

| Classification | Shape |
|---|---|
| Independent, Classifier | Square corners (rectangle) |
| Dependent, Subtype, Associative | Rounded corners |

### Edge styles

| Edge type | Style |
|---|---|
| Identifying | Solid, gray (#8b949e), 2px |
| Referential | Dashed, dark gray (#3d424a), 1.2px |
| Subtype (through joiner) | Solid, gray, 1.5px |

### Crow's foot markers

Custom SVG overlay draws IDEF1X crow's foot notation at each edge endpoint:

| Cardinality | Symbol | Description |
|---|---|---|
| 1 (one and only one) | `\|\|` | Two perpendicular bars |
| 0..1 (zero or one) | `\|O` | Bar + hollow circle |
| many (one or many) | `>\|` | Three-pronged crow's foot + bar |

Markers are drawn on top of the edge line. Colors match their edge (gray for identifying, dark gray for referential). Markers redraw on pan/zoom.

### Node colors

- Border color: group color from `_config.yaml`
- Background fill: pastel (30% mix of group color with dark background #0e1116)
- Default (no group): neutral gray (#6e7681)


## Architecture

```
models/                    Entity markdown files (one per entity)
models/_config.yaml        Group definitions with colors

src/parse.ts               Reads models dir, parses frontmatter, derives cardinality,
                           builds typed Model (nodes, edges, subtypeClusters, groups)
src/server.ts              Bun.serve() — serves HTML + /api/model JSON endpoint
src/App.tsx                React app — Cytoscape graph + doc panel
src/markers.ts             SVG overlay for crow's foot cardinality markers
src/main.tsx               React entry point
src/index.html             HTML shell
src/styles.css             Layout and doc panel styles
```

### Pipeline

```
models/*.md
    │
    ▼  parse.ts (frontmatter + markdown-it)
Model { nodes, edges, subtypeClusters, groups }
    │
    ▼  /api/model (JSON)
    │
    ▼  App.tsx (Cytoscape + ELK layered layout)
Rendered graph + doc panel
    │
    ▼  markers.ts (SVG overlay)
Crow's foot notation on edges
```


## Stack

| Concern | Choice |
|---|---|
| Runtime | Bun |
| Source format | Markdown + YAML frontmatter |
| YAML parser | `yaml` (YAML 1.2) |
| Markdown renderer | `markdown-it` |
| Graph renderer | Cytoscape.js |
| Layout engine | ELK (layered algorithm via `cytoscape-elk`) |
| Frontend framework | React 19 |
| Cardinality markers | Custom SVG overlay |


## Out of Scope

- SQL/DDL generation — logical model only
- Live editing of the diagram modifying markdown — markdown is the source of truth
- Spatial grouping — groups are color-only
- Custom edge routing — using ELK's orthogonal routing
- Multi-file YAML or includes
- Database introspection
