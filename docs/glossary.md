# Glossary


Shared vocabulary for ignatius — the markdown-driven ERD + SSADM data-flow modeler. These abbreviations
appear across the code, specs, dialogs, and conversation; this is the one place humans and LLMs converge on
what they mean. When you write a spec, a commit, or a UI label, use these terms as defined.


## Terms


| Abbr | Term | What it is |
|------|------|------------|
| DG | Data Graph | the ERD graph view — the Cytoscape entity diagram (`#view=graph`) |
| DD | Data Dictionary | the searchable dictionary view (`#view=dict`) |
| DFD | Data Flow Diagram | an SSADM process flow; the Flows view (`#view=flow`) |
| DE | Data Entity | a modeled entity; appears inside a DFD as a `db:` store |
| DS | Data Store | any DFD store — DE-backed (`db:`) or a non-entity store (`cache`/`file`/`doc`/`queue`/`manual`/`other`) |
| EE | External Entity | a DFD external; a source or sink that sits outside the system boundary (the green Gane-Sarson box) |
| Process | — | a numbered transform hub in a DFD (the circle/rounded node that consumes inputs and produces outputs) |
| Data Flow | — | a labeled arrow in a DFD; the data moving between two nodes |


## Relationships worth stating


- **DS ⊃ DE.** Every `db:`-backed store *is* a data entity (it resolves to a real entity in the ERD and opens
  the rich entity dialog). A non-`db` store (a cache, file, queue, document, manual record, or other) is a data
  store but **not** an entity. So "store" and "entity" are not disjoint — entities are the `db:` subset of
  stores. Don't treat them as mutually exclusive.

- **EE vs DS.** An external entity (EE) is *outside* the system; a data store (DS) is *inside* it. Both can be a
  source or sink for a data flow, but only stores represent persisted state the system owns.

- **DE in two views.** The same data entity shows as a node in the **DG** (its structure and relationships) and
  as a `db:` **DS** in a **DFD** (its role in a process). The DD describes it once; both views link back to it.


## Flow view: stacks, clusters, and groups


| Term | What it is |
|---|---|
| Flow label | A prose `label:` on any input or output entry. Shown on the edge chip in place of the column-list preview; `data:` is unchanged and still backs the contract dialog. |
| Cluster | A set of entities that one process treats as one thing. Two sources: an author cluster, a `clusters/<slug>.md` file at the model root naming its members; and a subtype family, the `subtypes:` a basetype entity already declares. A process can reference an author cluster directly with a `cluster:` token. |
| Group | The ERD bucket from `groups/<name>.md`. Coarser than a cluster: one group can contain several clusters. In the flow view, the groups collapse level nests a group's clusters and stores under one row when a process touches two or more of them. |
| Stack | A rendered flow-view node standing in for two or more DS a process reads or writes together, drawn as one open-ended box with one row per store, cluster, or group. A cluster or group row carries a C or G cap and the stacked-paper marker: two sheets behind it, offset down and right, showing as lines under the row. Clicking it opens the stack dialog. |
| Collapse level | The global setting (`stores` / `clusters` / `groups`) deciding what one row of a stack represents. |
| Per-process view | The default flow-view rendering: one read stack and one write stack per process, built from the DS it touches in that direction. |
| Connected view | The flow-view toggle: one node per store, grouped per process and direction by cluster tag, author cluster, subtype family, group (groups level only), then adjacency. |
| Adjacency stack | A connected-view stack formed from stores wired to the same processes in the same directions, with no cluster or group in common. Labelled `N stores`, never a member's name. Switchable off with `flow_view: { adjacency_stacks: false }` in `ignatius.yml`. |


## Store kinds


Non-entity stores carry a `kind:` in their frontmatter, which also drives their color in the DFD (theme-aware,
overridable under `theme.flowKinds` in `ignatius.yml`):


- `db` — DE-backed store (a real entity)
- `cache` — ephemeral/derived state
- `queue` — message or work queue
- `file` — a file or log on disk
- `doc` — a document or form
- `manual` — a manual/paper record
- `other` — anything that doesn't fit the above
