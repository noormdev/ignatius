# Markdown-Driven IDEF1X ERD Visualizer — Design Document


## Overview

A tool for authoring and exploring IDEF1X-style relational data models where:

- The source of truth is markdown. Each entity lives in its own `.md` file with YAML frontmatter for graph structure and a prose body for documentation.
- The visual is generated, not hand-drawn. A Cytoscape.js graph view is derived deterministically from the markdown corpus using ELK's layered algorithm.
- Clicking a node opens a modal with the entity's attributes table (auto-generated from frontmatter) and rendered markdown documentation.


## Source Format

### Directory structure

Entities are organized into folders by group. A `_groups/` folder at the root holds group definitions as markdown files. Paths prefixed with `_` are reserved for meta-content and skipped during entity scanning.

```
models/
  _groups/
    identity.md
    transactional.md
    catalog.md
    reference.md
  identity/
    Party.md
    Person.md
    Business.md
    Identity.md
    License.md
    Passport.md
    SSN.md
    ITIN.md
  transactional/
    SalesOrder.md
    SO_Line.md
    ...
  catalog/
    Product.md
    Subscription.md
  reference/
    PartyType.md
    ...
```

The parser scans `**/*.md` recursively, skipping any path segment that starts with `_`.

### Entity file structure

YAML frontmatter holds all structured graph data. The markdown body is free-form documentation — notes, business rules, admonitions. The attributes table is auto-generated from frontmatter in the UI; it does not live in the body.

```markdown
---
entity: EntityName
classification: Independent
group: identity
pk:
  - col_a
  - col_b
columns:
  col_a: { type: integer, desc: "System-assigned identifier" }
  col_b: { type: text, nullable: true, default: "draft" }
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
    desc: "Each entity is exactly one of ChildA or ChildB"
    members:
      ChildA: { discriminator_col: Classifier.column.VALUE }
      ChildB: { discriminator_col: Classifier.column.OTHER }
---

# Entity Name

Free-form documentation. Business rules, notes, context.
No attributes table here — that's generated from the frontmatter.
```

### Column properties

| Property | Required | Description |
|---|---|---|
| `type` | Yes | Logical type: text, integer, decimal, boolean, date, datetime, binary |
| `nullable` | No | Default false. Opt-in only. |
| `default` | No | Logical default value (literal or function name like `now`). Shown in its own column in the UI. |
| `desc` | No | Brief purpose of this column — what function it serves, why it exists. Not a repeat of the column name. |

### Group file structure

Each group is a markdown file in `models/_groups/` with YAML frontmatter for label and color, and a prose body describing what the group encapsulates.

```markdown
---
label: Identity & Accounts
color: "#2ea043"
---

Party identity, classifications, and ID documents — the "who" layer.

Covers the core Party basetype, its exclusive subtypes (Business, Person),
and the inclusive identity document cluster (License, Passport, SSN, ITIN).
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

Groups assign border color and pastel background fill to nodes. They do not influence layout proximity. Defined as markdown files in `_groups/`, referenced by `group:` in each entity's frontmatter. Entities without a group fall back to neutral gray (#6e7681).

### Subtype clusters use diamond joiners

Subtype relationships are visualized by inserting a diamond-shaped joiner node between the basetype and its subtypes:

- **Exclusive** (exactly one subtype applies): diamond displays "X". The basetype has a discriminator column.
- **Inclusive** (any combination of subtypes): diamond is empty. Membership is existence-based.

The identifying edges from subtypes to the basetype are rewired through the joiner. Subtypes are grouped inside a compound node so ELK keeps them clustered together. The joiner sits outside the compound, centered between the basetype and its subtypes.

### Attributes table is auto-generated

The entity modal renders an attributes table directly from the structured frontmatter data (columns, pk, ak, relationships). The markdown body does not contain an attributes table — it is reserved for free-form documentation.

Column descriptions (`desc`) explain the purpose of a column — what function it serves, why it exists, how it affects the system. They are not a restatement of the column name or a place for default values.

### FK links are navigable

FK references in the attributes table (e.g., `FK → Party`) are clickable links that open the target entity's modal. Users can navigate the entire schema by following FK links without returning to the graph.

### Parent entities show downstream relationships

A "Relationships" table at the bottom of the modal lists all child entities that reference this entity, with clickable links, relationship type, predicate, and derived cardinality.


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

Markers are drawn on top of the edge line at a 10px offset from the node edge. Colors match their edge (gray for identifying, dark gray for referential). Markers scale proportionally with zoom (clamped 0.5x–2.5x) and redraw on pan/zoom/position changes.

### Node colors

- Border color: group color from `_groups/*.md`
- Background fill: pastel (30% mix of group color with dark background #0e1116)
- Default (no group): neutral gray (#6e7681)

### Layout

ELK layered algorithm with:

- Direction: top-down (DOWN)
- Orthogonal edge routing
- Layer spacing: dynamically computed from the longest predicate label (`charCount * 6px + 50px padding`, minimum 80px)
- Compound nodes for subtype clusters with `INCLUDE_CHILDREN` hierarchy handling
- NETWORK_SIMPLEX for node placement and layering
- EDGE_LENGTH post-compaction


## UI

### Graph view

Full-viewport Cytoscape canvas with pan/zoom. No sidebar — the graph uses the entire screen.

### Floating action button (FAB)

Bottom-right corner. Shows a 2×2 grid of group color dots. Click to open the groups modal.

### Groups modal

Lists each group with its color swatch, label, and rendered markdown description from `_groups/*.md`.

### Entity modal

Opened by clicking a node. Contains:

1. **Header** — entity name, classification badge, group badge, PK columns
2. **Attributes table** — auto-generated from frontmatter columns with: name, type, key role (PK/FK/AK with clickable FK links), nullable, default, description
3. **Markdown body** — rendered prose documentation
4. **Relationships table** — all child entities referencing this entity, with clickable links, type, predicate, cardinality

Click backdrop or × to close. FK links and relationship links navigate between entity modals.


## Architecture

```
models/
  _groups/*.md             Group definitions (frontmatter + prose)
  <group>/*.md             Entity files organized by group

src/parse.ts               Reads _groups/ and entity files recursively,
                           parses frontmatter, derives cardinality,
                           builds typed Model (nodes, edges, subtypeClusters, groups)
src/server.ts              Bun.serve() — serves HTML + /api/model JSON endpoint
src/App.tsx                React app — Cytoscape graph + entity/group modals + FAB
src/markers.ts             SVG overlay for crow's foot cardinality markers
src/main.tsx               React entry point
src/index.html             HTML shell
src/styles.css             Layout, modal, FAB, and doc styles
```

### Pipeline

```
models/_groups/*.md  ──►  group configs (label, color, desc HTML)
                              │
models/**/*.md       ──►  parse frontmatter + render body
                              │
                              ▼
                    Model { nodes, edges, subtypeClusters, groups }
                              │
                              ▼  /api/model (JSON)
                              │
                              ▼  App.tsx
                    ┌─────────┴──────────┐
                    │                    │
              Cytoscape + ELK      Entity modal
              (graph layout)       (attributes + docs)
                    │
                    ▼
              markers.ts (SVG)
              crow's foot notation
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
| Screenshots (dev) | Playwright (headless Chromium) |


## Out of Scope

- SQL/DDL generation — logical model only
- Live editing of the diagram modifying markdown — markdown is the source of truth
- Spatial grouping — groups are color-only
- Custom edge routing — using ELK's orthogonal routing
- Multi-file YAML or includes
- Database introspection
