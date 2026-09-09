# DFD store clusters


## Goal

Every input/output entry may carry a prose `label:`, shown on the edge chip in place of a column-list preview, with a contract dialog on every data-carrying edge. The default rendering becomes a per-process view — one read-stack and one write-stack per process — with a connected view (today's per-store rendering, plus cluster/subtype/group/adjacency grouping) as a global toggle, and a collapse level (stores/clusters/groups) deciding what a stack's rows stand for. This targets the density the AutomaStructure model exposes: its Compute Loads diagram is 9 processes, 22 stores, and 64 edges, and its parent design-building diagram is 10 processes, 79 stores, and 230 edges — every edge chip a truncated column list today.


## Non-goals

- Clusters of non-`db:` stores. Adjacency stacking still groups same-kind non-db stores; author clusters and the `cluster:` token are entity-only.
- Per-diagram cluster scoping. Cluster files live at the model root and apply wherever two or more members meet on any diagram.
- Per-diagram collapse level or view. Both the view (per-process/connected) and the collapse level (stores/clusters/groups) are global settings.
- Editing a cluster, a group, or a label from the viewer.
- ELK compound nodes or any change to the five-band layout contract.
- Cluster-level `examples:` rows. Examples stay keyed by member `db:` token.
- Changing the ERD, the dictionary's entity cards, subtype derivation, or the `groups/` format.
- Changing `flow-derive-levels.ts`. Synthetic context and Level 1 diagrams run through the same render-time pipeline as any leaf diagram; their edges carry no data (`data: ''`), so an explicit `cluster:` tag has nothing to survive promotion on, and promoted stores group implicitly like any other store.


## Success criteria

- [ ] Chips are labels everywhere: on `test/fixtures/hub-dfd`'s `hub-diagram` (see Change tree — modeled on AutomaStructure's Compute Loads: 8 processes, 17 stores, 31 edges, including two hub stores `HubStoreA`/`HubStoreB` read by every process, a 3-member subtype family, a 2-member author cluster, and a 2-member same-adjacency pair), every rendered edge chip is a `label:` string — none show a truncated column-list preview — and clicking any data-carrying edge opens a contract dialog listing every column with its store and type.
- [ ] Default per-process view: on `hub-diagram`, the 31 authored edges collapse to 13 rendered edges across 12 distinct store-side nodes. Each of the 8 processes renders one read-stack (`stack:<sorted member ids>--read`) containing that process's full read set, including `HubStoreA`/`HubStoreB`; the two processes (of the 8) whose read set is only the two hub stores share exactly one stack node; a process whose read set also includes a private store gets its own distinct stack; `HubStoreA` is flagged duplicated everywhere it appears in more than one distinct read-stack, and the per-process view draws no duplicate marker (the connected view still does); a process that writes only one store (below the 2-member stacking threshold) still renders that write as a plain node. Externals keep their existing one-source-copy/one-sink-copy rendering, unaffected by the view.
- [ ] Connected view + collapse level: toggling to the connected view on `hub-diagram`, at collapse level "clusters" the author cluster and the subtype family each render as one row inside whichever stack contains their members; at collapse level "groups", the same members nest under a group row when both members share an entity `group:`; at collapse level "stores" every table is its own row, with no cluster or group nesting.
- [ ] Adjacency stacking (connected view, default on): `hub-diagram`'s two same-adjacency stores — written only by the same one process, read by none, same `kind` — group under one `stack:<sorted member ids>--write` node labelled `2 stores` (never a member's name); its dialog lists the shared writer process (no readers). Setting `flow_view: { adjacency_stacks: false }` in `hub-dfd/ignatius.yml` and re-rendering leaves both as plain, unstacked store nodes.
- [ ] Subtype-family label rule: `hub-diagram`'s subtype-family stack row reads `<Basetype> subtypes` when the basetype itself is not among the touched stores, and reads the plain basetype name when it is.
- [ ] `models/llm-memory-db-mssql`'s `tag-administration`: the edge from Merge Tag carrying the `clusters/tag-junctions.md`-tagged output entry (Project_Tag, Artifact_Tag, Milestone_Tag, Task_Tag) renders a `Tag junctions` label chip — not a column-list preview — and clicking it opens the contract dialog listing all four stores with their columns and types.
- [ ] `ignatius validate models/llm-memory-db-mssql` and `ignatius validate models/key-inherited` both exit 0 with 0 new findings after `clusters/tag-junctions.md` and the fixture changes land.
- [ ] On `models/key-inherited`, a process reading `db:Party` together with `db:Person` and `db:Business` renders one collapsed row labelled Party (connected view, clusters or groups level), with no `clusters/` file and no change to `Party.md`'s `subtypes:` frontmatter.
- [ ] Validation, five rules, two fixtures: `test/fixtures/broken-flows-model` gains a process file whose `cluster:` entries fire `flow.unknown_cluster` (a slug with no `clusters/<slug>.md`), `flow.cluster_member_unknown` (a `data:` map key outside the cluster's `entities:`), and `flow.cluster_no_members` (an empty `data:` map) — the three rules a cluster *file* cannot fire. `test/fixtures/broken-flows-model/clusters/` gains a second cluster file that fires `flow.cluster_entity_unknown` (names an entity absent from the model) and `flow.cluster_overlap` (lists an entity already claimed by another cluster file).
- [ ] Node-id and fingerprint stability: rewriting Merge Tag's four `db:` output entries to the equivalent `cluster:tag-junctions` token yields the same `layoutFlowFingerprint` and the same node id (`cluster:tag-junctions--write`) as the unrewritten `db:` form, so a saved drag position on that diagram survives the rewrite. Adding a `label:` to any entry, with no other change, does not change `layoutFlowFingerprint`.
- [ ] Positions are stored per view: dragging a node in the per-process view and then toggling to the connected view on the same diagram does not apply the per-process drag to the connected-view layout, and vice versa — the persistence key is the diagram's layout fingerprint plus the active view name.
- [ ] Dialogs follow the existing flow-surface open rule: opening `StackDialog` or the contract dialog, then clicking through to an entity, closes the currently-open dialog before the entity dialog opens (the same rule `FlowSurface`'s `open` handler already applies to the doc dialog in `src/app/views/flow/FlowsView.tsx`).
- [ ] The dictionary's process IO table (`IoTable.tsx`) shows an entry's `label:` in place of its column list whenever one is present, matching the canvas chip.
- [ ] A stack edge whose members mix labelled and unlabelled entries shows the authored labels one per line followed by exactly one column-preview line covering every unlabelled member (Merge Tag's per-process write chip on `tag-administration` reads `Tag junctions` / `tag_id, memory_id`); a stack edge with no labelled member shows one preview line; the hover tooltip on any stack edge lists one `Store: col, col` line per member.
- [ ] Label clearance: ELK derives inter-band spacing from the tallest rendered edge chip, reserving the chip's full height plus 20px above and below (with the historical 60px minimum), so a multi-line stack label does not overlap its process or store grouping.
- [ ] Label dragging: once pointer movement crosses the click threshold, the chip slides along its routed edge while preserving the initial pointer-to-chip-centre offset; the first drag frame never snaps the chip centre to the pointer.
- [ ] `bun run test` passes (all `test/checks/*.ts`, exit 0), including new checks for labels, cluster parsing/expansion/validation, per-process and connected-view grouping, and the collapse level. `bun run build:cli` succeeds. Touched files introduce zero new `tsc --noEmit` errors vs. `bun run typecheck` baseline.
- [ ] `docs/guides/flows.md`, `docs/guides/folder-format.md`, `docs/guides/validation.md`, `docs/glossary.md`, `skills/ignatius-modeling/references/{dfd-authoring,flow-templates,discover-flow,verification}.md`, and `docs/wiki/feature-map.md` all describe labels, the two views, the collapse level, clusters, groups, and adjacency — including the one-sentence exception the `cluster:` prefix carves out of the otherwise-closed endpoint-prefix set.


## Approach

Approach C: the `cluster:` token expands to member `db:` edges at parse time; per-process stacks are the default render, with a connected view (grouping the expanded graph by cluster tag, author cluster, subtype family, group, and adjacency) as the toggle — see `docs/design/dfd-store-clusters.md`.


## Change tree

```
src/flows/
├── flow-clusters.ts .......... A  (FlowCluster, parseClusters, expandClusterEdges)
├── flow-markdown.ts .......... A  (shared frontmatter parse, markdown renderer, label normalisation)
├── flow-parse.ts ............. M  (label: on any input/output entry; FlowModel.clusters;
│                                    FlowEdge.cluster tag and clusterIssue marker; cluster:
│                                    intercepted before parseEndpoint)
└── flow-validate.ts .......... M  (flow.unknown_cluster, flow.cluster_member_unknown,
                                    flow.cluster_no_members, flow.cluster_entity_unknown,
                                    flow.cluster_overlap)
src/model/
├── parse.ts ................... M  (ModelMeta.flowView from ignatius.yml's flow_view: block)
└── validate.ts ................. M  (RuleId union + explanation text for the five new flow.cluster_* rules)
src/flow-view/
├── flow-layout.ts ............. M  (edge label falls back to the column preview; buildFlowData
│                                    opts: view/collapseLevel/clusters/subtypeClusters/groups;
│                                    buildPerProcessStacks; buildConnectedViewGrouping; row
│                                    breakdown per collapse level; stack/cluster/subtype/group/
│                                    adjacency node ids)
├── elk-flow-layout.ts ......... M  (nodeSize/bandOf handle stack nodes; computeElkLayout opts)
└── FlowDiagramSvg.tsx ......... M  (stacked StoreNode variant; StackDialog trigger; chip shows
                                     label only; contract dialog trigger on every data edge;
                                     search dimming over stack membership)
src/app/
├── App.tsx .................... M  (view + collapse-level state, localStorage persistence, hash writes)
├── globals.d.ts ............... M  (window.__FLOW_CLUSTERS__)
├── hash-router.ts ............. M  (flowview= and collapse= params; nextCollapseLevel)
├── hooks/useHashRoute.ts ....... M  (popstate reconcile for flowview= and collapse=)
├── hooks/useModelData.ts ....... M  (thread clusters through the live/static payload)
├── components/ui/FabMenu.tsx ... M  (view item, collapse item, Copy link in the flow branch)
├── views/flow/FlowsView.tsx .... M  (thread view/collapseLevel/clusters/subtypeClusters/groups
│                                     into computeElkLayout + FlowDiagramSvg; per-view position
│                                     key; StackDialog/contract-dialog open state, reusing the
│                                     existing dialog-close-before-entity-open rule)
└── components/
    ├── flow-node/
    │   ├── StackDialog.tsx ..... A  (rows at the current collapse level; row → members → entity)
    │   └── EdgeContractDialog.tsx  A  (group · store · column · type table)
    └── process/IoTable.tsx ...... M  (shows edge.label when present, else the column list)
src/server/server.ts ............ M  (/api/flow payload carries clusters)
src/generators/app.ts ............ M  (static export payload carries window.__FLOW_CLUSTERS__)
test/checks/
├── test-flow-edge-labels.ts ............... A  (label: on any entry; chip fallback; fingerprint unaffected)
├── test-flow-clusters-parse.ts ............ A  (parseClusters + cluster: token expansion + interception)
├── test-flow-clusters-validate.ts ......... A  (five new flow.cluster_* rules, two fixtures)
├── test-flow-view-grouping.ts ............. A  (per-process stacks; connected-view sources; collapse level)
└── test-dfd-stack-dialogs.ts .............. A  (browser: StackDialog, contract dialog, view/level toggles)
test/visual/
└── screenshot-store-clusters.ts ........... A  (per-process view, connected view at each collapse level,
                                                 StackDialog, contract dialog)
test/fixtures/
├── broken-flows-model/flows/checkout/Bad-Cluster-Ref.md .. A  (process fixture: unknown_cluster,
│                                                              cluster_member_unknown, cluster_no_members)
├── broken-flows-model/clusters/role-grants.md ............ A  (valid cluster, referenced by the above)
├── broken-flows-model/clusters/role-grants-invalid.md .... A  (cluster-file fixture: cluster_entity_unknown,
│                                                              cluster_overlap against role-grants.md)
└── hub-dfd/ ............................................... A  (model root: hub-diagram — 8 processes,
                                                                 17 stores, 31 edges; two hub stores read
                                                                 by every process, a 3-member subtype
                                                                 family, a 2-member author cluster, a
                                                                 2-member same-adjacency pair (written by
                                                                 one process, read by none), an
                                                                 ignatius.yml with flow_view.adjacency_stacks)
models/llm-memory-db-mssql/
└── clusters/tag-junctions.md .............. A  (proving-model cluster: Project_Tag, Artifact_Tag, Milestone_Tag, Task_Tag)
models/key-inherited/flows/order-to-cash/Create-Sales-Order/
└── Validate-Customer.md ................... M  (adds db:Person / db:Business reads — subtype-family proof)
docs/guides/
├── flows.md ................... M  (Labels, stacks, clusters, and groups section)
├── folder-format.md ........... M  (clusters/ joins the recognized root folders; groups/ notes its flow-view role)
└── validation.md ............... M  (five new rules in the Cluster rules table)
docs/glossary.md ................ M  (stack, cluster, group, collapse level, per-process view, connected view)
skills/ignatius-modeling/references/
├── dfd-authoring.md ............ M  (a label step and a cluster step)
├── flow-templates.md ........... M  (cluster file template; label: on the process template)
├── discover-flow.md ............ M  (asks whether derived stores belong together)
└── verification.md ............. M  (five rules in the flow rule reference table)
docs/wiki/feature-map.md ........ M  (one row)
```


## Outline

```
src/flows/flow-clusters.ts
  FlowCluster — a parsed clusters/<slug>.md: slug, label, entities, body, bodyHtml
  parseClusters — reads the model root's clusters/*.md files into a lookup keyed by slug
  expandClusterEdges — turns one cluster: input/output entry (its data: is an entity→columns map)
    into one FlowEdge per mapped member, each tagged with the owning cluster's slug and label

src/flows/flow-parse.ts
  parseEndpoint / buildEdgeFromInput / buildEdgeFromOutput
    intercept a cluster:<slug> token before ordinary endpoint parsing and route it through
    expandClusterEdges instead; read label: off every input/output entry, cluster or not
  parseFlows
    calls parseClusters alongside readExternalsDir/stores scan
  FlowModel
    clusters: FlowCluster[] — new field, sibling to externals
  FlowEdge
    gains a new optional label — independent of data:, carrying the chip text when authored

src/flows/flow-validate.ts
  checkUnknownCluster — Class B: cluster: with no clusters/<slug>.md; strips the edge
  checkClusterMemberUnknown — Class B: a data: map key not in the cluster's entities; strips that member's edge
  checkClusterNoMembers — Class A: a cluster: entry whose data: map is empty
  checkClusterEntityUnknown — Class A: a cluster file lists an entity absent from the model
  checkClusterOverlap — Class A: one entity appears in two cluster files

src/model/parse.ts
  ModelMeta
    gains an optional adjacency-stacks switch, parsed from ignatius.yml's flow_view: block,
      mirroring the existing flow_rules: → _meta.flowRules precedent

src/model/validate.ts
  RuleId — adds the five flow.cluster_* ids + explanation text

src/flow-view/flow-layout.ts
  buildFlowData
    takes an optional view/collapse-level/clusters/subtype-clusters/groups argument alongside
    the diagram; omitting it keeps today's per-store, ungrouped output
  buildPerProcessStacks — the default view: per process, per direction, a stack of every
    store it touches when the set has 2+ members; two processes with the identical member
    set converge on the same stack id; a store in more than one stack in a band is duplicate-marked
  buildConnectedViewGrouping — the day-one node model (one node per store, read/write split),
    grouped in order by explicit cluster: tag, then author clusters, then subtype families,
    then groups (only when collapseLevel is "groups"), then adjacency (when flow_view.adjacency_stacks
    is not disabled); each step consumes the stores the previous step left ungrouped
  buildStackRows — given a stack's members and the current collapse level, returns its dialog
    rows: table rows only at "stores", cluster/subtype rows plus loose tables at "clusters",
    group rows (containing their clusters and tables) plus cross-group clusters at "groups"
  edge label resolution — an edge's chip lines are its label when present (one line per ", "-separated
    item, never truncated), else today's gated column preview; a stack edge shows its members'
    authored labels one per line followed by one gated preview line for all unlabelled members,
    and one preview line when none is labelled; lines travel as an array so nothing re-splits them

src/flow-view/elk-flow-layout.ts
  nodeSize — sizes a stack node from its member count
  bandOf — a stack node takes its members' existing band (1 read / 3 write)
  computeElkLayout
    threads view/collapseLevel/clusters/subtypeClusters/groups opts into buildFlowData

src/flow-view/FlowDiagramSvg.tsx
  StoreNode
    stacked variant — visible rows; a cluster or subtype row caps `C`, a group row caps `G`, store
    rows cap `D#`; a C or G row draws the stacked-paper marker (two filled sheets behind it offset
    3px and 6px down-right showing bottom edges, left stair segments, and the top-right mark, no
    cap divider on the sheets, the stack's left border and cap divider drawn per row, a reserve
    of offset plus stroke plus two pixels after the row, none after the last row, whose box ends
    on the back sheet with no closing line); the duplicate marker is drawn in the connected view
    only
  StackDialog trigger — click on a stack node opens the row-list dialog
  EdgeContractDialog trigger — click on any data-carrying edge chip opens the contract dialog
  chip rendering — label only; no member or column count suffix
  baseToken / search dimming — a stack node matches search when any member matches

src/app/components/flow-node/StackDialog.tsx
  StackDialog — titled by source (cluster label, basetype, group label, "N stores", or
    "Read stack" / "Write stack"), with the feeding processes as dotted-number links in the
    header; rows at the current collapse level; opening a cluster/subtype/group row shows
    its members with D#s; a member opens its entity dialog; an author-cluster row also renders
    the file's markdown body, a subtype row links the basetype (or reads "<Basetype> subtypes"
    when the basetype itself isn't a member), a group row shows the group's description, and
    an adjacency row lists the shared reader and writer processes instead of any body

src/app/components/flow-node/EdgeContractDialog.tsx
  EdgeContractDialog — takes the edge's member edges; one flat table: group (as the entity's group
    badge), store, column, type, sorted by store then entity column order; titled by the shared
    label or the store-side name; ext: edges show a one-column Item table of label lines

src/app/components/process/IoTable.tsx
  renderRow — shows edge.label when present, else the existing column-list rendering

src/app/views/flow/FlowsView.tsx
  renderDiagram — passes clusters (from FlowModel), entityModel.subtypeClusters, entityModel.groups,
    the active view, and the collapse level into computeElkLayout and FlowDiagramSvg
  layoutKeyFor — appends the active view name to the fingerprint-derived key so per-process and
    connected-view drag positions never collide
  stack/contract dialog open state — reuses the existing dialog-close-before-entity-open rule in
    FlowSurface's open handler

src/app/App.tsx
  view toggle (per-process default / connected) and collapse-level setting (stores/clusters/groups)
    — both global, persisted under ignatius-flow-view and ignatius-flow-collapse, same pattern as
    the existing minimap toggle; written to the hash as flowview= and collapse= (replaceState),
    the hash winning on load and Back/Forward restoring them live like dfd=; the FAB items read
    "Connected view" / "Per-process view" and "Collapse to clusters" / "Collapse to groups" /
    "Expand to stores"

src/app/hooks/useModelData.ts
  FlowApiPayload / static payload — clusters field added, threaded to FlowsView

src/server/server.ts
  /api/flow — response gains clusters: flowModel.clusters (cleaned)

src/generators/app.ts
  static export — window.__FLOW_CLUSTERS__ alongside window.__FLOW_MODEL__
```


## Flows

**Flow: any entry's label replaces the column-list chip**

1. A process file's `outputs:` entry carries `label: new auth event` alongside its existing `data:` column list
2. `buildFlowData` resolves the edge's chip text to the label; the `data:` contract is unchanged and still backs the contract dialog
3. `FlowDiagramSvg` renders the chip as `new auth event`, not a truncated column preview
4. Clicking the chip opens `EdgeContractDialog`: one row per column, with its store and type
5. The dictionary's `IoTable` shows the same label in place of the column list for that entry

**Flow: default per-process view stacks a process's reads and writes**

1. A process reads three stores, including a hub store also read by seven other processes
2. `buildPerProcessStacks` groups the process's three-store read set into one stack, id `stack:<sorted member ids>--read`
3. Another process with the identical three-store read set converges on the same stack id and shares the node
4. A third process reads only the hub store plus a different second store, so it gets its own distinct stack; the hub store is duplicate-marked in every stack it appears in
5. Externals are unaffected — `buildExternalRouting` still caps each at one source copy and one sink copy

**Flow: connected view groups by cluster tag, author cluster, subtype family, group, then adjacency**

1. User toggles to the connected view; the collapse level is "groups"
2. `buildConnectedViewGrouping` first pulls out any edges tagged by an explicit `cluster:` entry, then groups remaining stores by author `clusters/` file membership, then by subtype family, then — because the collapse level is "groups" — by shared entity `group:`, then (since `flow_view.adjacency_stacks` is not disabled) collapses any remaining same-adjacency stores
3. `buildStackRows` renders each stack's dialog rows nested per the "groups" breakdown: group rows containing their clusters and tables, then clusters spanning two groups, then loose tables
4. An adjacency-only stack's row reads `2 stores`; opening it lists the shared reader and writer processes instead of a body

**Flow: author cluster expands, groups, and opens its contract**

1. `parseFlows` reads `clusters/tag-junctions.md` into `FlowModel.clusters`
2. Merge Tag's `cluster:tag-junctions` output entry expands into four `db:` edges (Project_Tag, Artifact_Tag, Milestone_Tag, Task_Tag), each tagged `edge.cluster = { slug: 'tag-junctions', label: 'Tag junctions' }`
3. `validateFlows` checks every mapped member against the cluster's `entities:` and every column against its entity, same as an unqualified `db:` edge; an empty `data:` map fires `flow.cluster_no_members` instead
4. In the connected view, the four expanded edges group under one stack node `cluster:tag-junctions--write`, because they carry the cluster tag
5. The edge chip reads `Tag junctions`; clicking it opens `EdgeContractDialog` with one row per store/column/type across the four members
6. Clicking the stack node opens `StackDialog`, which renders the cluster file's markdown body and lists the four members with D#s; clicking a member opens its entity dialog, closing `StackDialog` first

**Flow: subtype family groups without authoring**

1. A process reads `db:Party`, `db:Person`, `db:Business`
2. `buildConnectedViewGrouping` receives `entityModel.subtypeClusters` (already parsed from `Party.md`'s `subtypes:` frontmatter — no new file) and groups the three stores under `subtype:Party--read`
3. Since the basetype `Party` is itself one of the touched stores, the row reads `Party`; on a diagram where only `Person`/`Business` are touched with no `Party` read, the row instead reads `Party subtypes`


## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Labels on every entry + contract dialog for every data edge + dictionary IO table | `src/flows/flow-parse.ts`, `src/flow-view/flow-layout.ts`, `src/flow-view/FlowDiagramSvg.tsx`, `src/app/components/flow-node/EdgeContractDialog.tsx`, `src/app/components/process/IoTable.tsx`, `test/checks/test-flow-edge-labels.ts` | atomic-implementer (mode: feature) | ~6 | a plain `db:` entry's `label:` renders on the chip in place of the column preview; an entry with no `label:` keeps today's column-preview chip; every data-carrying edge opens `EdgeContractDialog`; `IoTable` shows the label; adding a `label:` does not change `layoutFlowFingerprint` |
| 2 | Clusters registry parse + `cluster:` interception + `FlowModel`/payload plumbing | `src/flows/flow-clusters.ts`, `src/flows/flow-parse.ts`, `src/server/server.ts`, `src/generators/app.ts`, `test/checks/test-flow-clusters-parse.ts`, `test/fixtures/broken-flows-model/clusters/role-grants.md` | atomic-implementer (mode: feature) | ~6 | `parseClusters` returns the fixture's cluster map; a `cluster:` process entry expands into per-member `db:` edges tagged with the cluster slug and label before `parseEndpoint` ever sees the `cluster:` prefix; `FlowModel.clusters` and the `/api/flow` payload carry the registry |
| 3 | Validation: five `flow.cluster_*` rules, two fixtures | `src/flows/flow-validate.ts`, `src/model/validate.ts`, `test/checks/test-flow-clusters-validate.ts`, `test/fixtures/broken-flows-model/flows/checkout/Bad-Cluster-Ref.md`, `test/fixtures/broken-flows-model/clusters/role-grants-invalid.md` | atomic-implementer (mode: feature) | 5 | the process fixture's bad slug, unmapped `data:` member, and empty `data:` map fire `flow.unknown_cluster`/`flow.cluster_member_unknown`/`flow.cluster_no_members`; the second cluster file fires `flow.cluster_entity_unknown` and `flow.cluster_overlap` against `role-grants.md`; `ignatius validate models/llm-memory-db-mssql` and `models/key-inherited` stay clean |
| 4 | Per-process stacks (default view) + connected-view grouping + collapse level + hub fixture | `src/flow-view/flow-layout.ts`, `src/flow-view/elk-flow-layout.ts`, `src/model/parse.ts`, `test/checks/test-flow-view-grouping.ts`, `test/fixtures/hub-dfd/`, `models/llm-memory-db-mssql/clusters/tag-junctions.md`, `models/key-inherited/flows/order-to-cash/Create-Sales-Order/Validate-Customer.md` | atomic-implementer (mode: feature) | ~8 | on `hub-diagram`, the default per-process view produces one distinct read-stack per process (converging where read sets are identical) with the duplicate marker on shared hub stores; the connected view groups by cluster tag, author cluster, subtype family, group (at the groups level), and adjacency in that order; `flow_view.adjacency_stacks: false` in `hub-dfd/ignatius.yml` leaves the adjacency pair unstacked (id `stack:<sorted member ids>--write` when enabled); on `Validate-Customer`, Party/Person/Business group into one `subtype:Party--read` row |
| 5 | SVG stack node + `StackDialog` + search dimming + drag ids | `src/flow-view/FlowDiagramSvg.tsx`, `src/app/components/flow-node/StackDialog.tsx`, `src/app/views/flow/FlowsView.tsx`, `test/checks/test-dfd-stack-dialogs.ts` (StackDialog open/close + search-dimming cases), `test/visual/screenshot-store-clusters.ts` (per-process + connected-view stacked-node screenshot) | atomic-implementer (mode: feature) | ~6 | screenshot of `hub-diagram` shows a stacked-outline node per process (per-process view) and per grouping source (connected view); clicking a stack opens `StackDialog` with rows at the current collapse level; a subtype row with no basetype member reads `<Basetype> subtypes`; an adjacency row reads `2 stores` and lists shared processes; opening an entity from `StackDialog` closes it first; search for a member's name highlights its stack |
| 6 | Contract dialog upgrade + chip is label-only | `src/flow-view/FlowDiagramSvg.tsx`, `src/app/components/flow-node/EdgeContractDialog.tsx` | atomic-implementer (mode: feature) | 2-3 | on `tag-administration`, the edge into the Merge Tag cluster shows the `Tag junctions` chip with no member/column-count suffix; clicking it opens `EdgeContractDialog` with a group/store/column/type row per member; an `ext:` edge's dialog shows label lines with no group/store/type columns |
| 7 | View + collapse-level toggles, per-view position persistence | `src/app/App.tsx`, `src/app/views/flow/FlowsView.tsx`, `test/checks/test-dfd-stack-dialogs.ts` (view/collapse-level toggle cases), `test/visual/screenshot-store-clusters.ts` (both views at each collapse level) | atomic-implementer (mode: feature) | ~5 | toggling the view on `hub-diagram` switches between per-process stacks and connected-view grouping; toggling the collapse level changes `StackDialog`'s row breakdown; both settings persist across reload; a drag saved in one view does not apply in the other (fingerprint + view name key); screenshots of both views at each collapse level |
| 8 | Docs: guide, folder format, validation, glossary, skill, feature map | `docs/guides/flows.md`, `docs/guides/folder-format.md`, `docs/guides/validation.md`, `docs/glossary.md`, `skills/ignatius-modeling/references/dfd-authoring.md`, `skills/ignatius-modeling/references/flow-templates.md`, `skills/ignatius-modeling/references/discover-flow.md`, `skills/ignatius-modeling/references/verification.md`, `docs/wiki/feature-map.md` | atomic-implementer (mode: feature) | 9 | every listed surface documents labels, the two views, the collapse level, clusters, groups, and adjacency (with its `ignatius.yml` switch); the flow rule reference table lists all five new rules; the closed endpoint-prefix passages in `flows.md`/`dfd-authoring.md`/`flow-templates.md` each name the `cluster:` interception as the one exception |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `buildFlowData`'s 9 existing call sites (the renderer, the ELK module, 7 test files) all assume the old single-argument signature | high | Add `{ view, collapseLevel, clusters, subtypeClusters, groups }` as an optional second argument with today's per-store output as the default — every untouched call site is unaffected; only `elk-flow-layout.ts`'s `computeElkLayout` (CP4) and `FlowDiagramSvg.tsx`'s banded-fallback call (CP5) are updated to pass real data |
| `/api/flow` and the static export today ship only `flowModel.diagrams`, not `flowModel.externals` — there is no existing top-level-registry precedent to copy for `clusters` | medium | CP2 adds a first-class `clusters` field to both payloads and a matching `window.__FLOW_CLUSTERS__` global, following the same shape `flowLayoutKeys` already uses (a sibling top-level key, not nested in `diagrams`) |
| `layoutFlowFingerprint` (`flow-fingerprint.ts`) hashes structural topology only; per-process and connected views would collide on one saved-position bucket if the key were fingerprint alone | medium | Per the success-criteria entry on per-view persistence, `FlowsView.tsx`'s `layoutKeyFor` appends the active view name to the fingerprint-derived key (CP7), so the two views never share a drag-position bucket |
| Adjacency stacking groups by identical (readers, writers, kind) alone, which lands on real families and on coincidental pairs equally — the AutomaStructure probe found unrelated pairs sharing adjacency | low | `flow_view: { adjacency_stacks: false }` (CP4) is a model-level kill switch; the adjacency row is labelled `2 stores`, never a member's name, and its dialog names the shared processes so a reader can judge relatedness themselves |
| `key-inherited`'s only `db:Party` flow reference (`Validate-Customer.md`) never previously touched `Person`/`Business`, so subtype-family grouping had no existing case to verify against | low | CP4 adds `db:Person`/`db:Business` reads to `Validate-Customer.md` — additive flow authoring, not a change to `Party.md`'s `subtypes:` frontmatter or to subtype derivation itself |
| The AutomaStructure model itself is outside this repo, so no in-repo check can run against its real Compute Loads / design-building diagrams | low | `test/fixtures/hub-dfd` is shaped like Compute Loads (8+ processes, two hub stores, one subtype family, one author cluster, two same-adjacency stores) for every automated check; a manual screenshot against the real AutomaStructure model is the acceptance check outside CI |


## Change log

### 2026-09-06 — explicit `cluster:` entries always group; externals untouched by per-process mode

**What changed:** A `cluster:<slug>` entry renders its cluster node regardless of how many members its `data:` map names, marked `1 of N` for a single member. The two-member threshold applies only to implicit grouping through plain `db:` entries. Per-process mode leaves externals at one source copy and one sink copy per diagram. Success criteria, the `buildClusterGrouping` outline line, the author-cluster and per-process flows, CP3's Verifies cell, and the risks table were rewritten to this truth.

**Why:** The user asked whether writing `cluster:` with one member would draw a plain store; the body applied the threshold after expansion to every edge, which would have discarded an explicit authoring choice. The externals question was the design's second open item; the user chose to keep externals aggregated.

**Superseded:** author clusters applied only where two or more members were touched, with no distinction between explicit and implicit references; per-process mode said nothing about externals.

### 2026-09-07 — labels on every entry, per-process default view, collapse levels, adjacency switch

**What changed:** Rewrote the body to the post-challenge-swarm design. A prose `label:` is legal on any input/output entry (not only `cluster:` ones) and drives the edge chip everywhere, with a contract dialog on every data-carrying edge — this is now the first checkpoint, independent of the cluster pipeline. The default rendering is a per-process view (one read-stack and one write-stack per process, id `stack:<sorted member ids>--read|--write`, identical sets sharing a stack, duplicate marker on shared members); the prior single "connected + optional per-process-mode toggle" model is now the "connected view", itself the toggle. A collapse-level setting (stores/clusters/groups) decides what a stack's rows represent; groups come from the entity's existing `group:` and `groups/<name>.md`. Connected-view grouping order is now: explicit `cluster:` tag, author clusters, subtype families, groups (groups level only), adjacency (switchable off via `flow_view: { adjacency_stacks: false }` in `ignatius.yml`); adjacency's label is always `N stores`, never a member's name. Every grouped node id now carries `--read`/`--write`; a subtype row reads `<Basetype> subtypes` when the basetype is absent from the touched stores; a cluster row's cap shows the lowest member D#. The edge chip is label-only — no member/column-count suffix. Positions are keyed by fingerprint plus view name. Added `flow.cluster_no_members` as a fifth validation rule. The `cluster:` prefix is now explicitly intercepted before `parseEndpoint`, and the closed-prefix guide/skill passages must name this one exception. `deriveLevels`/`flow-derive-levels.ts` needs no change — synthetic diagrams carry no edge data, so they run the same render-time pipeline with nothing for an explicit tag to survive on. Renamed the rendered node's dialog from `ClusterDialog` to `StackDialog` — "cluster" now names only the `clusters/` file source and the subtype family, never the rendered box. Cited the existing `FlowSurface` dialog-close-before-entity-open rule instead of re-specifying it. Replaced the motivating Problem/Goal example with the AutomaStructure model's Compute Loads (9 processes, 22 stores, 64 edges) and design-building (10 processes, 79 stores, 230 edges) diagrams; added an in-repo `test/fixtures/hub-dfd` shaped like Compute Loads for every automated success criterion, since AutomaStructure itself is outside this repo. The `tag-administration` success criterion now asserts the `Tag junctions` label only, not an edge-count drop (adjacency stacking already collapses that case on its own). Split the cluster-rule negative fixture in two: a process file for the two rules only a `cluster:` entry can fire (`flow.unknown_cluster`, `flow.cluster_member_unknown`, `flow.cluster_no_members`) and a cluster file for the two rules only a cluster file can fire (`flow.cluster_entity_unknown`, `flow.cluster_overlap`). Added `IoTable.tsx` (dictionary process IO table) to the change tree and to CP1, so it shows labels too. The hub-diagram success criteria and the `hub-dfd/` fixture carry concrete counts: 8 processes, 17 stores, 31 authored edges, collapsing to 13 rendered edges across 12 distinct store-side nodes under the default per-process view.

**Why:** A challenge swarm and a strategist critique (`.claude/.scratchpad/dfd-store-clusters/critique.md`, evidenced by an adjacency probe against a fixture shaped like the AutomaStructure model) found that the prior design's success criteria measured an already-legible diagram, gated the highest-value fix (labels) behind the cluster pipeline, used a cluster-node id that cannot exist once a store is both read and written, and left per-process mode, adjacency precision, and the AutomaStructure motivating example unaddressed.

**Superseded:** the three-source connected-only render (author clusters, subtype families, adjacency) with an opt-in per-process *mode* and an unsuffixed `cluster:<slug>` node id; a `label:` restricted to `cluster:` entries; an edge chip suffixed with member/column counts; a single global position key per diagram; four validation rules; `ClusterDialog` as the rendered node's dialog name; success criteria scoped to `tag-administration`'s edge-count drop and to `models/llm-memory-db-mssql`/`models/key-inherited` alone, with no in-repo hub-shaped fixture.

### 2026-09-07 — implementation deviations folded into the contract

**What changed:** The body now states the rules the implementation settled where the earlier text left them open or named them differently. Hash parameters are `flowview=` and `collapse=` because `view=` already routes the graph, dictionary, and flow surfaces; the settings persist under `ignatius-flow-view` and `ignatius-flow-collapse` and are restored on Back/Forward like `dfd=`. A stack edge's chip carries lines as an array: authored labels one per line, then one preview line for all unlabelled members. The contract dialog takes the edge's member edges, shows the group as the entity's badge, sorts by store then entity column order, and shows an `ext:` edge as a one-column Item table. The stack dialog is titled by source and lists feeding processes as dotted-number links. The parser leaves a `clusterIssue` marker on unresolved `cluster:` edges for the validator to strip; `flow-markdown.ts` holds the shared frontmatter and markdown helpers; `FlowElementData`'s node variant is a discriminated union on `nodeType`; `buildFlowData` no longer returns a store-number map since nodes carry their own D#. `selectDiagramById` threads the leaf diagram into `onDiagramChange`, which the popstate reconcile exposed as a latent drill-depth bug. The hub fixture carries a `label:` on every entry plus three `ext:` edges so read-only processes validate; `subtype-no-basetype` is a second fixture for the `<Basetype> subtypes` label.

**Why:** Each item surfaced in a builder or reviewer round of `/subagent-implementation` and was decided there; the body must match what a fresh reader can verify in the code.

**Superseded:** an unnamed hash and storage key scheme; a chip rule that only covered fully labelled or fully unlabelled stack edges; a contract dialog described without its group badge, sort order, or member-edge input.

### 2026-09-07 — C and G caps, stacked-paper marker, duplicate marker per view

**What changed:** Cluster and subtype rows cap `C` and group rows cap `G` instead of a member's D number. The "more inside" marker is the hand-drawn stacked-paper construction: three sheets, the front one drawn last, the two behind offset 3px and 6px down-right and showing their bottom edges, left stair segments, and the top-right mark with no cap divider, the stack reserving the offset plus a stroke width and two pixels after such a row. The duplicate-store marker is drawn only in the connected view; the per-process view flags duplicates in the data but draws every row alike.

**Why:** The user reviewed the rendered stacks: a D number on a row that is not a data store misreads the notation; the first marker attempt drew slivers beside the row and the second showed the copies' cap stubs as a small square; in the per-process view every shared store repeats by design, so the thick left border marked nearly every hub row and carried no information.

**Superseded:** the cap showing the lowest member D number; two offset outlines as the marker; the duplicate marker drawn in both views.

### 2026-09-08 — filled sheets on the stacked-paper marker

**What changed:** The two sheets behind a C or G row are filled with the box colour, drawn back to front under the row's own fill, so the marker reads as solid stacked paper. A stack whose last row is grouped ends on the back sheet's bottom edge: no clearance is reserved after it and the box draws no separate closing line, so an edge docking at the bottom meets the sheet.

**Why:** With outline-only sheets the page background showed through them, and in the dark theme the marker looked hollow; the user asked for the fill. Once filled, the full-width closing line under a trailing grouped row floated below the sheets as a detached stroke.

**Superseded:** outline-only sheets; the closing line and trailing clearance under a stack that ends in a grouped row.

### 2026-09-09 — label-aware band spacing and working stack disclosures

**What changed:** ELK's inter-band spacing now grows from the tallest rendered edge chip: chip height plus 20px clearance on each side, with the former 60px spacing retained as the minimum. Stack-dialog C/G rows now mount their member rows only while the disclosure is open, so the chevron controls visible content instead of acting decoratively.

**Why:** Multi-line labels could cover the process box or adjacent store grouping, and the stack dialog rendered member rows outside its `<details>` element regardless of whether the disclosure was open.

### 2026-09-09 — stable label dragging

**What changed:** Edge-chip dragging now applies the pointer's world-space delta to the chip's starting centre before projecting that candidate point onto the routed edge.

**Why:** Projecting the pointer itself discarded the offset between the pointer and chip centre, so the label jumped as soon as a drag began unless it happened to be grabbed exactly at its centre.


## Implementation log

### shipped on branch worktree-dfd-store-stacks — 2026-09-08

Built across 9 iterations of /subagent-implementation (eight checkpoints plus one polish iteration of five rounds), then squashed into one commit on the branch; the per-iteration history lives in the scratchpad's `STATE.md`. Checkpoints in order:

- CP-1 labels on every entry, contract dialog, dictionary IO table labels
- CP-2 clusters registry, `cluster:` token expansion, payload plumbing
- CP-3 five `flow.cluster_*` validation rules with disk fixtures
- CP-4a stack node model, per-process stacks, hub fixture, `flow_view` config
- CP-4b connected-view grouping, collapse levels, per-process qualification
- CP-5 stack rendering, StackDialog, search dimming, per-process default view
- CP-6 contract dialog for stack edges, mixed-chip rule, D# fix on plain per-process nodes
- CP-7 view and collapse toggles, hash deep-links, per-view position keys
- CP-8 guides, glossary, skill references, feature map
- polish: chip dedup at stack outlets, deferred SVG unmount, bounded search check, repaired navigability script, stack top alignment, dedup scope, C/G caps, stacked-paper marker with filled sheets, duplicate mark per view, stack width from the widest row label
- skill: the modeling skill authors labels and clusters by default so diagrams stay legible; the demo `models/key-inherited` Collect Payment writes `cluster:settlement` with a label on every entry, and the flows guide and the skill quote that file

**Out-of-scope work performed during this build:**

- `src/flows/flow-markdown.ts` extracted so the cluster parser and the flow parser share frontmatter and markdown helpers instead of duplicating them.
- `FlowElementData`'s node variant became a discriminated union on `nodeType`; a merged optional-field type made `Extract` resolve to `never` in tests.
- `selectDiagramById` now threads the leaf diagram into `onDiagramChange`; the popstate reconcile exposed a drill-depth loss on rebuild.
- Two pre-existing checks were updated for the new default view; `test-cp3-dfd-url-navigability.ts` was repaired after leveling had removed the nav card it clicked.

**Unforeseens — surprises that emerged during implementation:**

- The hub fixture needed three `ext:` output edges so read-only processes pass `flow.process_no_output`; the 31 store-touching edges stayed exact.
- The `view=` hash key already routes surfaces, so the flow view uses `flowview=` and `collapse=`.
- The stacked-paper marker took four constructions; the final one came from a session-model implementer working from the hand-drawn reference.
- A React warning about unmounting a nested root during render predated the feature and was fixed by deferring the unmount.

**Deferred items still open:**

- `.claude/project/followups/dfd-store-clusters-f-15.md` — the intermittent stall in `test-graph-search.ts`; bounded with a watchdog, root cause not found.

**Merged into main as `dd2c24a` (2026-09-08); released in v0.19.0.**
