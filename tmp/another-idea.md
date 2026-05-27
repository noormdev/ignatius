# Markdown-Driven Relational Schema Visualizer — Design Brief

## Project Vision

Build a tool for authoring and exploring IDEF1X-style relational data models where:

1. **The source of truth is markdown.** Each entity lives in its own `.md` file. Humans read and edit it like documentation. LLMs read and write it fluently because it is just markdown with YAML frontmatter — one of the most common patterns in their training data.
2. **The visual is generated, not hand-drawn.** An ERD-style graph view is derived deterministically from the markdown corpus. Layout is computed by a proven algorithm, not by manually positioning nodes.
3. **The two views stay in sync.** Clicking a node in the graph opens the rendered markdown for that entity. There is no separate "diagram file" that can drift from the documentation.

The end result feels like Obsidian, but specialized for relational schemas: rich per-entity documentation, navigable cross-references, and a structured ERD instead of a force-directed cloud of dots.

---

## Source Format

One markdown file per entity. The structured graph data lives in YAML frontmatter. The prose documentation lives in the body.

```markdown
---
entity: Order
classification: Independent      # Independent | Dependent | Subtype | Associative | Classifier
primary_key:
  style: surrogate               # surrogate | natural | composite
  columns: [order_id]
alternate_keys:
  - { name: AK-1, columns: [order_number] }
relationships:
  - predicate: contains
    target: Order_Line
    cardinality: 1:M
    identifying: true
    fk_nullable: false
  - predicate: placed_by
    target: Customer
    cardinality: M:1
    identifying: false
    fk_nullable: false
---

# Order

An independent entity representing a customer's commitment to purchase one or
more products at agreed-upon prices.

## Attributes

| # | Attribute    | Logical type | Key role        | Nullable | Business rule                        |
|---|--------------|--------------|-----------------|----------|--------------------------------------|
| 1 | order_id     | integer      | PK (surrogate)  | No       | System-assigned                      |
| 2 | order_number | text         | AK-1            | No       | Format `ORD-YYYYMMDD-NNNN`           |
| 3 | order_date   | date         | —               | No       | Defaults to current date             |
| 4 | status       | text         | —               | No       | Domain: {Draft, Submitted, ...}      |
| 5 | customer_id  | integer      | FK → Customer   | No       | Migrated from Customer               |

## Notes

Status transitions follow [[Order_Status_State_Machine]].
```

### Why this split

- **Frontmatter is the formal graph.** Three lines of YAML parsing produces the complete node + edge data. No ambiguity, no string heuristics.
- **The body is documentation.** Full IDEF1X catalog cards, attribute tables, business rules, free prose. Renders to HTML for the doc panel.
- **Wikilinks in the body are secondary edges.** `[[Other_Entity]]` references in the prose become "see also" connections that augment the graph without competing with the formal relationships in frontmatter.

### Composite keys and composite FKs

When a relationship spans multiple columns, list them explicitly:

```yaml
relationships:
  - predicate: identifies
    target: Order_Line
    cardinality: 1:M
    identifying: true
    columns: [order_id, line_seq]   # the migrated key components
```

The parser does not infer composite keys — they are declared.

---

## Architecture

```
   markdown files                parser              in-memory graph
   ┌────────────────┐           ┌───────┐           ┌─────────────────┐
   │ Order.md       │──────────▶│       │──────────▶│ nodes: entities │
   │ Customer.md    │           │ parse │           │ edges: rels     │
   │ Order_Line.md  │──────────▶│       │──────────▶│ metadata: docs  │
   └────────────────┘           └───────┘           └─────────────────┘
                                                            │
                                ┌───────────────────────────┴───────────┐
                                ▼                                       ▼
                       ┌────────────────────┐                ┌──────────────────┐
                       │ Cytoscape + ELK    │                │ Markdown renderer│
                       │ (graph view)       │                │ (doc panel)      │
                       └────────────────────┘                └──────────────────┘
                                │                                       ▲
                                └───── node click ──────────────────────┘
```

### Pipeline stages

1. **Glob and parse.** Walk a directory of `.md` files. For each: parse YAML frontmatter (e.g. `gray-matter`), parse the markdown body (e.g. `remark` / `markdown-it`), extract wikilinks.
2. **Build the intermediate representation.** A single JSON object: `{ nodes: [...], edges: [...] }` where each node carries its full frontmatter and a reference to its rendered HTML body.
3. **Render two views from the same IR.** The graph view feeds nodes/edges to the layout engine; the doc panel renders the HTML body of whichever node is selected.
4. **Watch and reload.** File-system watcher re-parses changed files, recomputes the IR, and updates both views without a full reload.

### Why this shape

The parser, the IR, the doc renderer, and the layout engine are all independent. Swap any one without touching the others. Critically, the layout engine is a single configuration line — switch from one algorithm to another in an afternoon.

---

## Layout Engine: Cytoscape.js + ELK

The hardest part of any schema visualizer is layout — ranking nodes, routing edges, avoiding crossings. This is a 40-year-old research problem. Do not solve it from scratch.

**Cytoscape.js** is the rendering and interaction layer. It handles node drawing, edge drawing, pan, zoom, click, hover, search, and styling. Its stylesheet system is essentially CSS for graphs, which lines up perfectly with IDEF1X notation needs.

**ELK** (Eclipse Layout Kernel, JS port via `elkjs` and `cytoscape-elk`) is the layout engine. It computes node positions and edge routes from the graph structure alone.

### Why ELK over dagre

Both are hierarchical-DAG layout engines and both work with Cytoscape. ELK wins for this project on two specific features:

1. **Ports.** ELK can terminate an edge at a specific point on a node — a particular column row inside a table — rather than at the node's center. This is how dbdiagram.io draws FK lines that point to the actual column. Dagre routes to centroids only.
2. **Nested hierarchy.** ELK supports subgraphs that contain other nodes (boxes inside boxes). This is the natural primitive for subtype clusters (a supertype box wrapping its subtypes), classifier groupings, and bounded-context partitions. Dagre cannot do nested layout coherently.

ELK also ships multiple algorithms in one package — `layered` is the Sugiyama-style hierarchical layout to default to, but `force`, `stress`, `radial`, and `mrtree` are available for alternate views ("show me the whole vault as a force graph") without swapping libraries.

### Tradeoffs to know

- **Bundle size.** ELK is several MB; dagre is ~50KB. Irrelevant for a desktop authoring tool, relevant if this ever ships to mobile.
- **Async API.** ELK's layout call returns a Promise. Plan for this in the render loop.
- **Configuration surface.** ELK exposes dozens of `elk.*` options per element. The defaults are sensible; tune as needed.

### Practical advice

Build with **dagre first** to get the end-to-end pipeline working in a day. Switch the layout call to **ELK** the moment you want ports or nested clusters. The only line that changes:

```js
// before
cy.layout({ name: 'dagre', rankDir: 'TB' });
// after
cy.layout({ name: 'elk', elk: { algorithm: 'layered', 'elk.direction': 'DOWN' } });
```

Parser, IR, doc renderer, interaction handlers — none of them care.

### Minimal integration sketch

```js
import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
cytoscape.use(elk);

const cy = cytoscape({
  container: document.getElementById('graph'),
  elements: buildElementsFromIR(ir),
  layout: {
    name: 'elk',
    elk: {
      algorithm: 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': 80,
      'elk.spacing.nodeNode': 40,
      'elk.edgeRouting': 'ORTHOGONAL',
    },
  },
  style: cytoscapeStylesheet,
});

cy.on('tap', 'node', (evt) => {
  showEntityDoc(evt.target.id());   // render the markdown body in the doc panel
});
```

### One DAG caveat

ELK's `layered` algorithm assumes the graph is acyclic. Self-references (`Employee.manager_id → Employee`) and the rare circular-FK case need handling — mark those edges to be excluded from layout computation but still rendered. ELK exposes `elk.layered.cycleBreaking.strategy` for this; in practice, tagging the edge and filtering it out of the layout input is cleanest.

---

## IDEF1X Notation in Cytoscape Styles

Cytoscape stylesheets bind visual properties to data attributes. The IDEF1X conventions map cleanly:

```js
const cytoscapeStylesheet = [
  // Nodes: independent entities get sharp corners, dependent get rounded
  { selector: 'node[classification = "Independent"]',
    style: { shape: 'rectangle', 'background-color': '#f8f8f8' } },
  { selector: 'node[classification = "Dependent"]',
    style: { shape: 'round-rectangle', 'background-color': '#fff8e1' } },
  { selector: 'node[classification = "Classifier"]',
    style: { shape: 'rectangle', 'border-style': 'dashed' } },

  // Edges: identifying = solid, non-identifying = dashed
  { selector: 'edge[identifying]',
    style: { 'line-style': 'solid', width: 2 } },
  { selector: 'edge[!identifying]',
    style: { 'line-style': 'dashed', width: 1.5 } },

  // Optional FK gets a circle at the child end (IDEF1X convention)
  { selector: 'edge[fk_nullable]',
    style: { 'source-arrow-shape': 'circle', 'source-arrow-fill': 'hollow' } },

  // Subtype edges get a triangle discriminator marker
  { selector: 'edge[kind = "subtype"]',
    style: { 'target-arrow-shape': 'triangle', 'target-arrow-fill': 'hollow' } },
];
```

Every IDEF1X visual convention (crow's-foot endpoints, the "many" symbol, exclusive vs inclusive subtype discriminators) is achievable through selectors on edge data. None of it requires custom rendering.

---

## Layout as Soft Hints, Not Coordinates

A core design decision: **the markdown source stores the logical model only.** It does not store x/y positions. Position is a property of the rendering, not the model.

But pure auto-layout on a 60-table schema produces something usable, not something *good*. The compromise is **soft hints in frontmatter** that bias the auto-layout without dictating it:

```yaml
layout:
  cluster: billing           # group with other 'billing' entities
  rank: 2                    # prefer placement at this hierarchical level
  align: left                # anchor toward left edge of cluster
```

These feed into ELK as constraints (`elk.partitioning.partition`, `elk.position`, etc.). The result is reproducible, version-controllable layout that an LLM can author — because soft hints are just more YAML.

What this rejects: hand-dragging tables and saving pixel coordinates back into the source. That path leads to source files that diff badly, that LLMs cannot meaningfully edit, and that drift from the model whenever someone resizes their viewport.

---

## What to Borrow from Quartz

[Quartz](https://github.com/jackyzha0/quartz) is a static site generator for Obsidian vaults. It already solves parts of this pipeline:

- Markdown + frontmatter parsing
- Wikilink resolution across files
- Backlinks index
- A graph view (force-directed, swap for ELK)
- A documentation site with clickable navigation

A defensible build path: fork or study Quartz, replace its force-directed graph renderer with a Cytoscape + ELK ERD renderer, and tighten the frontmatter schema to be ERD-specific. Most of the parsing and watch-mode infrastructure is reusable.

---

## Worked Example: Three Entities

### `Customer.md`

```markdown
---
entity: Customer
classification: Independent
primary_key: { style: surrogate, columns: [customer_id] }
alternate_keys:
  - { name: AK-1, columns: [email] }
relationships: []
---

# Customer

An independent party that places orders. Identified by a system-assigned
surrogate key; email serves as a unique alternate key for login.
```

### `Order.md`

```markdown
---
entity: Order
classification: Independent
primary_key: { style: surrogate, columns: [order_id] }
alternate_keys:
  - { name: AK-1, columns: [order_number] }
relationships:
  - predicate: placed_by
    target: Customer
    cardinality: M:1
    identifying: false
    fk_nullable: false
---

# Order

A customer's commitment to purchase one or more products. References the
placing [[Customer]]; the customer reference is mandatory but non-identifying —
the order has its own identity (`order_id`) independent of the customer.
```

### `Order_Line.md`

```markdown
---
entity: Order_Line
classification: Dependent
primary_key:
  style: composite
  columns: [order_id, line_seq]
relationships:
  - predicate: contained_in
    target: Order
    cardinality: M:1
    identifying: true
    fk_nullable: false
    columns: [order_id]
---

# Order_Line

A line item within an [[Order]]. The order's identity migrates into the line's
primary key (identifying relationship); a line cannot be uniquely identified
without knowing which order it belongs to.
```

### What the parser produces

```json
{
  "nodes": [
    { "id": "Customer",   "classification": "Independent" },
    { "id": "Order",      "classification": "Independent" },
    { "id": "Order_Line", "classification": "Dependent"   }
  ],
  "edges": [
    { "source": "Order",      "target": "Customer", "identifying": false, "predicate": "placed_by"    },
    { "source": "Order_Line", "target": "Order",    "identifying": true,  "predicate": "contained_in" }
  ]
}
```

### What ELK renders

A top-down hierarchical layout with `Customer` and `Order` near the top (both Independent, no incoming dependencies in this slice), `Order_Line` below `Order` connected by a solid line (identifying), and `Order` connected to `Customer` by a dashed line (non-identifying). Click any node, the doc panel renders that entity's markdown body.

---

## Open Questions

These are deliberate to-be-decided items, not oversights:

1. **Edge labels.** Do we render the predicate verb on every edge, only on hover, or only in a "verbose" mode? Verbose ERDs get cluttered fast.
2. **Schema namespaces.** Multi-schema models (e.g. `core.users` vs `billing.invoices`) — represent as folders, as a frontmatter field, or both?
3. **Subtype rendering.** Single nested box per cluster, or separate boxes connected by a discriminator hub node? ELK supports both; the choice is aesthetic.
4. **Validation.** Should the parser enforce IDEF1X rules (e.g. "subtype PK must equal supertype PK") at build time, or surface them as warnings in the UI?
5. **Diff view.** When the model changes, what does a useful "schema diff" view look like — color-coded edges/nodes for added/changed/removed?

These should be resolved through prototyping, not up front.

---

## Out of Scope

To keep the project tractable:

- **SQL generation.** This tool is for logical modeling. Generating DDL from the IR is a separate downstream concern.
- **Live database connection.** No introspecting running databases. Markdown is the source.
- **Real-time collaboration.** Single-author, git-backed workflow.
- **Custom layout algorithms.** Use ELK as configured. Do not write a layout engine.

---

## Recommended Initial Stack

| Concern              | Choice                                  |
|----------------------|-----------------------------------------|
| Source format        | Markdown + YAML frontmatter             |
| Frontmatter parser   | `gray-matter`                           |
| Markdown renderer    | `remark` + `remark-html` (or `markdown-it`) |
| Wikilink extraction  | `remark-wiki-link` or custom regex pass |
| Graph IR             | Plain JSON, in-memory                   |
| Graph renderer       | Cytoscape.js                            |
| Layout engine        | dagre to bootstrap, ELK to ship         |
| File watching        | `chokidar`                              |
| Dev shell            | Vite + TypeScript                       |

Everything in this stack is permissively licensed, mature, and well-documented. None of it is exotic.