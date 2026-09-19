---
type: Domain
description: ELK/banded layout, stack-node grouping, SVG rendering, and breadcrumb/index navigation for DFD diagrams.
tags: [flow-view, flows, frontend]
---

# flow-view

## What it does

[`src/flow-view/`](../../src/flow-view) turns a parsed `FlowDiagram` into on-screen positions, routed edges, a rendered SVG, and the chrome a user drills through it with. Without this domain the app has no DFD canvas: `flows` has parsed data with nowhere to draw, and the frontend's Flows tab is empty. Layout runs two ways — an async elkjs pass with 5-band partitioning and orthogonal edge routing, or a synchronous hand-rolled banded fallback used while ELK resolves or after it fails — and both feed the same custom SVG renderer, which also owns pan/zoom/drag, the minimap, breadcrumbs, edge-hover tooltips, and search-driven dimming.

On a model with dozens of flows, drilling down one level at a time is the only way in unless the diagram exposes shortcuts: `flow-nav.ts` turns the leveled DFD tree into breadcrumb sibling menus and a searchable process-hierarchy index, so a user can jump sideways or straight to any process without re-walking the whole path. It also resolves `dfd=` deep links, which carry a path reference rather than a bare id, so a reload or a link lands on the exact sub-DFD even when two unrelated flows share a process file name. The same large-model concern drives the hover behavior: `FlowDiagramSvg` now settles a hover through a shared intent delay before dimming anything, and drops fade transitions entirely once a diagram's element count passes the shared animation cutoff, so a pointer crossing a big diagram no longer repaints once per element it passes over.

A store is not always drawn one-to-one with an entity. When a process touches two or more stores in one direction, or (in the connected view) two or more stores share a cluster tag, author cluster, subtype family, group, or read/write/kind signature, they collapse into one **stack node** — a single box whose rows can represent individual stores or nested groupings, at a collapse level the caller controls. Two view modes decide how this grouping runs: **per-process** (the default) stacks each process's own reads and writes; **connected** keeps one node per store and only groups where clusters/subtypes/groups/adjacency say to. Both are global settings owned by the frontend shell, not this domain.

## How it works

### Position priority

A node's on-screen position resolves from whichever source is authoritative for it, checked in order — a user's own drag always wins.

```mermaid
flowchart TD
    A[node position requested] --> B{"savedPositions has this id?"}
    B -->|yes| C["use the saved (dragged) position"]
    B -->|no| D{"elkPositions has this id?"}
    D -->|yes| E[use the ELK position]
    D -->|no| F["use computeFlowLayout's banded position"]
```

`FlowDiagramSvg`'s `nodeBounds` and `elk-flow-layout.ts`'s `nodeSize` share their process and stack sizing (`processNodeSize`, `stackNodeSize`), so those two node types never disagree about where a box's edges are. External sizing is not shared: `nodeSize` computes an external's width as `estW(n.label, 6.6, 28, 110)` (label-length-dependent, 110px floor) with a fixed 52px height, while `nodeBounds` draws the renderer's own fixed `EXT_W = 120`, `EXT_H = 50` — ELK lays out an external against a box the SVG does not actually draw. For a stack node, `nodeBounds` centers the box on `stackNodeSize`'s official height (the same top ELK/`StackNode` use) but reports `stackRowLayout`'s full drawn height for `h` — the box's own peek-reserve padding is included in what chip placement and the viewBox treat as occupied space, even though ELK never sees it.

### Edge routing fallback

An edge draws ELK's routed polyline only when neither endpoint has moved off the position ELK computed for it; a dragged node reverts its edges to the live hand-router.

```mermaid
flowchart TD
    A["edge has an elkEdgeRoutes entry?"] -->|no| D["orthogonalPath (hand-routed)"]
    A -->|yes| B{"source and target both at their ELK base position?"}
    B -->|yes| C[draw the ELK polyline]
    B -->|no| D
```

### View routing in buildFlowData

`buildFlowData(diagram, opts)` is the single entry point for node/edge construction; `opts.view` picks one of three independent builders.

```mermaid
flowchart TD
    A["buildFlowData(diagram, opts)"] --> B{"opts.view"}
    B -->|"undefined"| C["one node per store; a store both read and written splits into --read/--write copies"]
    B -->|"'per-process'"| D["buildPerProcessStores: 2+ stores touched by one process in one direction collapse into a stack node"]
    B -->|"'connected'"| E["buildConnectedViewGrouping: cluster/subtype/group/adjacency passes, per-store otherwise"]
```

`computeElkLayout` takes the same `opts` (`ComputeElkLayoutOpts extends BuildFlowDataOpts`) so ELK's node/edge id set always matches what `FlowDiagramSvg` builds against. `FlowDiagramSvg` now calls `buildFlowData` inside a `useMemo` keyed on `[diagram, flowDataOpts]`, since every hover and drag re-renders the component and rebuilding the whole node/edge model on each of those made hovering a large DFD stall.

### Connected-view grouping order

Within the connected view, five passes run in a fixed order; each pass claims members from what the previous pass left, per process.

```mermaid
flowchart TD
    A["explicit `cluster:` tag on an edge (no threshold, claims for every touching process)"] --> B["author clusters (opts.clusters, 2+ per process)"]
    B --> C["subtype families (opts.subtypeClusters, 2+ per process)"]
    C --> D{"collapseLevel === 'groups'?"}
    D -->|yes| E["entity groups (opts.entityGroups, 2+ per process)"]
    D -->|no| F{"adjacencyStacks !== false?"}
    E --> F
    F -->|yes| G["adjacency: same kind + same readers + same writers, diagram-wide, 2+"]
    F -->|no| H[remaining touches stay plain per-store nodes]
    G --> H
```

An author cluster's 2-per-process qualification (`qualifyPerProcess`, `STACK_THRESHOLD`) runs before the explicit-tag `existing` check, whether or not a `cluster:<slug>--<direction>` group already exists from step one — a process touching fewer than two of the cluster's members contributes nothing and is skipped, even when an explicit-tag group with the same id is already forming. Only a process that clears the threshold merges its members into that existing group, or starts a new one when no explicit-tag group exists. A process that touches only one member of a group another process qualified for still renders that member as its own plain node, flagged `duplicated`.

### Collapse level and a stack's dialog rows

`buildStackRows` (internal to `flow-layout.ts`) decides what each row inside a stack node represents, independent of which view produced the stack.

| Collapse level | Row content |
|---|---|
| `stores` | One row per member store; no grouping. |
| `clusters` | One row per explicit `cluster:`-tagged group and per subtype family with 2+ members in this stack, then one row per remaining loose store. |
| `groups` | One row per entity group with 2+ members in this stack (nesting its cluster/subtype and table rows as `children`), then a cluster/subtype spanning 2+ groups as its own row, then loose tables. |

A concrete `store` row keeps its endpoint kind, resolves that kind's theme color independently, and caps with a kind-local number (`D#` db, `C#` cache, `Q#` queue, `F#` file, `Do#` document, `M#` manual, `O#` other). A `cluster`/`subtype` row caps with unnumbered `C`; a `group` row with unnumbered `G`; these collapsed entity rows use db colors. `stackRowBodyText(row)` returns the text a row renders (a store row's `displayName`, a grouped row's `<label> (<count>)`) and is what `stackNodeSize` measures to size the box; `StackNode` computes the same text inline rather than calling it.

### Chip content and the mixed-label rule

`resolveChipLines(label, hasAuthoredLabel)` turns a resolved edge label into the chip's rendered lines: an authored `label:` renders in full, split one item per line, never truncated; a column-preview fallback renders in full when short (`CHIP_TRUNCATE_MAX = 22` chars) or collapses to one line ending in `…` when long. For a stack edge whose members mix labelled and unlabelled entries, `resolveStackEdgeLabel` precomputes `chipLines` directly — the authored labels one per line, followed by exactly one gated column-preview line covering every unlabelled member — because re-splitting that combined string on `", "` would fragment the preview's own internal commas.

### Chip dedup

A stack read fanning out to every process that shares it repeats the identical label at the identical outlet once per process; `suppressDuplicateChips` collapses those to one visible chip.

```mermaid
flowchart TD
    A["stack-sourced chips with byte-identical rendered lines"] --> B["group by y-position into channels (gap <= CHIP_CHANNEL_TOLERANCE, 24 world px)"]
    B --> C{"channel has 2+ chips?"}
    C -->|no| D[chip stays visible]
    C -->|yes| E{"any chip in the channel is drag-overridden?"}
    E -->|yes| F["the overridden chip stays visible; every auto sibling hides"]
    E -->|no| G["the chip nearest the channel's mean x stays visible; the rest hide"]
```

Suppression is scoped to edges whose source resolves to a `'stack'` node — a plain process or store sending an identical label to two genuinely different destinations keeps both chips visible.

### Stacked-paper marker

A grouped row (`cluster`/`subtype`/`group`, never a plain `store` row) draws a "more inside" affordance in `StackNode`: the row's own bottom edge closes fully, then two sheets filled with the box colour are drawn behind it at `STACK_ROW_PEEK_GAP`-scaled offsets, each showing only a stair-stepped slice of its left edge, its own bottom edge, and a short mark where its top edge pokes out past the front box — never a full left edge or cap divider, so only the front row reads as a complete box. When the last row is grouped the drawn box ends on the back sheet's bottom edge (`stackRowLayout` drops the trailing clearance) and no separate closing line is drawn.

### Selecting a diagram from a known path

A breadcrumb crumb's ▾ menu, a level-menu pick, and a flow-index row all already know a full id path (they were built by walking the tree), so each calls `onSelectPath(ids)`, which resolves it with `resolveDiagramPath(roots, ids)`: an exact walk down from the roots, matched id by id against each level's `subDfds`. A miss at any step returns `null` and the caller keeps the current diagram — this path never falls back to a bare-id lookup, because a sub-DFD's id is its process file's name and two unrelated flows can share one ([`docs/spec/large-model-nav.md`](../spec/large-model-nav.md)).

```mermaid
flowchart TD
    A["breadcrumb pick, level-menu pick, or flow-index row click"] --> B["onSelectPath(ids: string[])"]
    B --> C["resolveDiagramPath(roots, ids)"]
    C --> D{"each id found in the current level's subDfds?"}
    D -->|"yes, every step"| E["FlowDiagram[] path, root first"]
    D -->|"no, or path is empty"| F["null — caller keeps the current diagram"]
```

`levelEntries(parent, roots, modelDescription)` produces the sibling list a breadcrumb's ▾ or the flow index's side pane shows for one level: the roots when `parent` is `null`, otherwise `parent.processes` in dotted-number order paired with their `subDfds` entries. `buildFlowIndex(roots, modelDescription)` builds the whole tree at once, then drops the derived Context and System rows (`withoutDerivedLevels`) so the flows are the top level: one `FlowIndexNode` per root diagram, its processes nested beneath, each node's `key` the full id path joined with `/` (unique even where process ids repeat) and its `path`/`opensOwnDiagram` set to the process's own sub-DFD when it has one, else the diagram that contains it. Both `levelEntries` and `buildFlowIndex` read a process's description in the same fallback order: its own `description:`, else its sub-DFD folder's `index.md` description, else — only for the synthetic whole-system process (`SYSTEM_PROCESS_ID`) — the model's own description. `FlowIndex`'s side pane shows the hovered row's description, else the focused row's, else the current diagram's, else — when nothing is hovered, focused, or open on the current diagram — the model's own name and description.

### Resolving a dfd= reference

A `dfd=` value is a path reference (`diagramRef`), not a bare id: `diagramRef(path)` drops the path's derived Context/System ids and joins what's left with `/` (`invoicing/Submit-PCI`), falling back to the path's own last id when every id in it is derived (a Context or System deep link). Reading it back — on load, on reload, on popstate, and after a `flowview=`/`collapse=` toggle rebuild — goes through `findDiagramByRef`, which walks the tree in order and returns the first path whose trailing ids match the reference's segments; a one-segment reference is a bare id, so links written before references carried paths still resolve.

```mermaid
flowchart TD
    A["dfd= value on load, reload, popstate, or view/collapse toggle"] --> B["findDiagramByRef(roots, ref)"]
    B --> C{"a path's trailing ids match ref's segments?"}
    C -->|yes| D["first such path, in tree order"]
    C -->|no dfd=, or no match| E["defaultDiagramPath(roots): the System overview, or the first root when unleveled"]
```

`window.__IGNATIUS_ACTIVE_FLOW_DFD__` is set to the rendered diagram's own bare id, never the path reference — it stays a stable test hook independent of how deep the diagram sits in the tree.

### Hover settle path

Dimming and the edge tooltip apply only after the pointer rests on one target; a pass across many elements repaints once instead of once per element crossed.

```mermaid
sequenceDiagram
    participant Pointer
    participant Svg as FlowDiagramSvg
    participant Intent as "createHoverIntent (motion.ts)"

    Pointer->>Svg: pointerEnter node/edge
    Svg->>Intent: set("node:<id>" / "edge:<id>")
    Note over Intent: pending until the pointer rests HOVER_INTENT_MS
    Intent-->>Svg: apply(key)
    Svg->>Svg: setHover({kind, id}), position edgeTooltip
    Svg->>Svg: recompute nodeOpacity/edgeOpacity, dim non-connected elements
```

`FlowDiagramSvg` never times the delay itself: `hoverIntent.set(key)` on pointer-enter/leave and `hoverIntent.applyNow(null)` on opening the contract dialog are the only calls it makes; `createHoverIntent` and `HOVER_INTENT_MS` live in the frontend domain's [`src/app/logic/motion.ts`](../../src/app/logic/motion.ts) and are shared verbatim with the Graph and Dictionary views. The same module's `animationsAllowed(nodes.length + edges.length)` gates the `animate` flag threaded into `EdgePath`/`EdgeChip` and every node's hover style: past the shared element-count cutoff, opacity changes apply with no `transition`, matching the other two views' large-model behavior.

## Where it lives

| Path | Exports | Role |
|---|---|---|
| [`src/flow-view/elk-flow-layout.ts`](../../src/flow-view/elk-flow-layout.ts) (382L) | `computeElkLayout`, `buildElkGraph`, `nodeSize`, `bandOf`, `isDbEdge`, `SHORT_LABEL_MAX`, `isInlineLabel`, `terminateQuietly`, `ElkLayoutResult`, `ComputeElkLayoutOpts` | Async ELK layout: 5-band partitioning (source-ext=0, input-store=1, process-row=2, output-store=3, sink-ext=4), `ORTHOGONAL` edge routing. Per-process view sets `elk.separateConnectedComponents: 'false'` so disconnected stacks still obey band ordering. No Bun/Node-only APIs at module top level — browser-safe. Reads no `FlowDiagram.description`; layout is unaffected by it. |
| [`src/flow-view/flow-layout.ts`](../../src/flow-view/flow-layout.ts) (1800L) | `buildFlowData`, `computeFlowLayout`, `assignStoreNumbers`, `normalizeEdgeData`, `resolveChipLines`, `estProcessLineWidth`, `processNodeSize`, `stackNodeSize`, `stackRowLayout`, `stackRowBodyText`, `storeBodyWidth`, `measureText`, `layoutKeyForView`, `PROC_MIN_W`, `PROC_MIN_H`, `PROC_TEXT_LEFT`, `PROC_TEXT_RIGHT_PAD`, `PROC_LINE_H`, `PROC_TEXT_PAD_Y`, `STORE_ROW_H`, `STORE_CAP_W`, `STORE_STROKE_W`, `CHIP_TRUNCATE_MAX`, `STACK_ROW_PEEK_GAP`, `STACK_ROW_PEEK_RESERVE`, plus the `NodePos`/`StackMember`/`StackRow`/`ProcessNodeData`/`ExternalNodeData`/`StoreNodeData`/`StackNodeData`/`FlowNodeData`/`FlowElementData`/`BuildFlowDataOpts`/`FlowRenderData`/`StoreSplitMap` types | Renderer-agnostic layout: node/edge construction for all three views, the store split (read/write) map, external routing (max two aggregated copies per external), and the synchronous banded fallback (`computeFlowLayout`). `buildPerProcessStores`, `buildConnectedViewGrouping`, `buildStackRows`, and `resolveStackEdgeLabel` are internal, not exported. Reads no `FlowDiagram.description`. |
| [`src/flow-view/flow-nav.ts`](../../src/flow-view/flow-nav.ts) (185L) | `resolveDiagramPath`, `defaultDiagramPath`, `diagramRef`, `findDiagramByRef`, `levelEntries`, `buildFlowIndex`, `FlowLevelEntry`, `FlowIndexNode` | Pure, browser-safe: `resolveDiagramPath` walks an exact id path from the roots for breadcrumb/level-menu/index selection; `diagramRef`/`findDiagramByRef` build and resolve a `dfd=` path reference by trailing-id match; `defaultDiagramPath` picks the System overview (or the first root when unleveled) for a diagram-less load; `levelEntries`/`buildFlowIndex` turn the leveled `FlowDiagram` tree into breadcrumb sibling lists and the full process-hierarchy index, the latter dropping the derived Context/System rows. Sole consumer of `FlowDiagram.description`/`FlowProcess.description` in this domain. Imports `CONTEXT_DIAGRAM_ID`/`SYNTHETIC_DIAGRAM_IDS`/`SYSTEM_PROCESS_ID` from `src/flows/flow-derive-levels` and `compareDottedProcesses` from `src/app/logic/search` for process ordering. |
| [`src/flow-view/FlowIndex.tsx`](../../src/flow-view/FlowIndex.tsx) (120L) | `FlowIndex` | The process-hierarchy tree overlay opened from the breadcrumb's index chip or the `i` key: a scrollable tree (`buildFlowIndex` output) beside a preview pane that shows the hovered row's number/description/diagram-opens hint, else the focused row's, else the current diagram's, else the model's own name and description. |
| [`src/flow-view/LevelMenu.tsx`](../../src/flow-view/LevelMenu.tsx) (123L) | `LevelMenu` | The dropdown a breadcrumb's ▾ opens: `levelEntries` rendered as a listbox with number/label/process-count/description per row, a filter input above `FILTER_MIN_ENTRIES` (8) entries, arrow-key/Enter selection, and outside-pointerdown/Escape close. |
| [`src/flow-view/FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx) (2234L) | `FlowDiagramSvg`, `DARK_PALETTE`/`LIGHT_PALETTE` (`FlowPalette`), `ElkPositionMap`, `MinimapData`, `FlowDiagramSvgProps`, `nodeBounds`, `sizingInfo`, `suppressDuplicateChips`, `deoverlapChips`, `chipAnchor`, `elkChannelChip`, `computeEdgeAnchors`, `chipDims`, `boxesOverlap`, `FlowNode`, `FlowEdge`, `StackSizeInfo`, `EdgeAnchors`, `Box`, `Pt` | The SVG renderer: process/external/store/stack node drawing, pan/zoom/drag, edge-hover tooltip, chip placement and dedup, search-driven dimming (`searchTokens`, `baseToken`). Consumes `elkPositions`/`elkEdgeRoutes` from `computeElkLayout` and `flowDataOpts` passed straight through to `buildFlowData` (now memoized) — the two must agree on `opts` or their node/edge id sets diverge. Routes every hover through `createHoverIntent` and gates transitions through `animationsAllowed`, both from [`src/app/logic/motion.ts`](../../src/app/logic/motion.ts). |
| [`src/flow-view/FlowChrome.tsx`](../../src/flow-view/FlowChrome.tsx) (452L) | `FlowChrome`, `FlowChromeHandle`, `FlowChromeProps`, `BreadcrumbEntry` | Floating chrome around the SVG: breadcrumb chips, each non-leaf crumb's ▾ opening a `LevelMenu` of that level's diagrams (`levelEntries`), the "Process Flows" chip opening a `FlowIndex` overlay, and the bottom-left minimap (`FlowMinimap`, driven by an imperative `FlowChromeHandle` ref: `setStack`, `setDiagrams`, `setMinimap`, `setMinimapPanTo`, `toggleIndex`). A house (Home) button between the "Process Flows" chip and the first crumb opens the System overview (`defaultDiagramPath`) from any depth and is marked current (`aria-current="page"`) while the overview is on screen; on a derived diagram the "← Back" button is hidden. A `breadcrumbRef` + `ResizeObserver` writes the breadcrumb row's measured bottom edge into `--flow-search-bar-top` on `document.documentElement`. |
| [`src/flow-view/zoom-scale.ts`](../../src/flow-view/zoom-scale.ts) (74L) | `computeFitScale`, `screenScaleToPercent`, `percentToScreenScale`, `Size`, `Box` | Pure zoom/fit math, no DOM/React/Bun imports. Implements the native-1:1 zoom model: 100% means one diagram world-unit renders as one CSS pixel, not "fits the container." |

## Constraints

- `processNodeSize` and `stackNodeSize` are the single sizing source for both ELK and the SVG box for process and stack nodes — `elk-flow-layout.ts`'s `nodeSize` and `FlowDiagramSvg`'s `nodeBounds` both call them, so ELK never lays out a process or stack against a box different from what's drawn. Store width is not unified: `nodeSize`'s store branch estimates the kind-specific cap plus label independently of `FlowDiagramSvg`'s `storeWidth(name) = STORE_CAP_W + storeBodyWidth(name)`, so the two can differ slightly.
- `SHORT_LABEL_MAX` (`elk-flow-layout.ts`) derives from `CHIP_TRUNCATE_MAX` (`flow-layout.ts` = 22) rather than redeclaring it — one numeric source gates both ELK-side inline-chip eligibility and the on-canvas chip truncation, so forking the two constants apart could let ELK label a chip inline that the renderer then truncates, or vice versa.
- `STORE_STROKE_W = 1.4` is the single canonical stroke width for a store/stack box's outline and dividers; `STACK_ROW_PEEK_RESERVE` derives its clearance from it, so a future stroke-width change can't silently reopen the visual fusion between a grouped row's peek marks and the next row's own divider.
- Node positions are always centers (ELK top-left + half size), never top-left — `computeElkLayout` converts explicitly so ELK routes line up with the renderer's center-based `nodeBounds`.
- ELK receives node + edge geometry only, never label dummy nodes — the renderer places all label placement itself (inline chip or truncated preview) in the inter-band channel, so ELK's own layout never routes around label boxes the renderer doesn't draw, which would otherwise force a band to split across sub-layers and break the single-row-per-band guarantee (C16, [`docs/spec/dfd-overhaul.md`](../spec/dfd-overhaul.md)).
- A stack node's official size (`stackNodeSize`) counts only `STORE_ROW_H` per row; a grouped row's stacked-paper peek reserve is bottom padding on the *drawn* box only (`stackRowLayout`), so two stacks with the same row count always share the same official height regardless of whether one has a grouped row.
- The per-process view suppresses the duplicate-store marker on every stack row (`suppressDuplicateMarker`) — a shared store repeats in every process's own stack by design there, so the marker would cover nearly every row. The underlying `duplicated` flag is untouched and still drawn in the connected view.
- `layoutKeyForView(baseKey, view)` appends the active view name to a diagram's fingerprint-derived layout key, so a drag saved in the per-process view never applies to the connected view or vice versa; collapse level is excluded because it changes row content, not node ids.
- Chip dedup (`suppressDuplicateChips`) only ever hides chips whose edge source resolves to a `'stack'` node — a plain process or store can legitimately send an identical label to two different destinations, and both must stay visible.
- `buildFlowData`'s per-store branch (`opts.view` omitted) is byte-for-byte identical to its pre-stack behavior, so breaking that compatibility guarantee would change the default view's rendered store layout for every existing diagram, not just ones using the new per-process/connected stacking.
- `resolveDiagramPath` addresses a diagram strictly by exact id path from a root — used only where the caller already knows the full path (breadcrumb picks, level-menu picks, flow-index rows) — because sub-DFD ids are process file names and two unrelated flows can share one. A `dfd=` reference is different: it names a diagram by its trailing ids only, so `findDiagramByRef` can match it against any path in the tree, oldest bare-id links included.
- A breadcrumb crumb gets a ▾ only when `levelEntries` for its level returns more than one entry (`hasMenu = siblings.length > 1`); since `FlowChrome`'s `stack.map` never renders a crumb for a derived (Context/System) entry at all, this single-entry case only ever applies to a non-derived crumb, e.g. a single-root unleveled tree or any level with exactly one sibling diagram.
- `animationsAllowed`/`ANIMATION_ELEMENT_LIMIT` and `createHoverIntent`/`HOVER_INTENT_MS` are owned by [`src/app/logic/motion.ts`](../../src/app/logic/motion.ts) (frontend domain), not redeclared here — `FlowDiagramSvg` only calls them, so the cutoff and delay stay identical across Graph, Dictionary, and Flows.
- The `data-ignatius` attributes emitted by `FlowChrome`/`FlowIndex`/`LevelMenu` (`flow-crumb`, `flow-crumb-menu-button`, `flow-index`, `flow-index-row`, `flow-index-pane`, `flow-level-menu`, `flow-level-menu-item`) are the selectors [`test/checks/test-large-model-nav.ts`](../../test/checks/test-large-model-nav.ts) drives via Playwright; renaming one without updating that test breaks it silently at the DOM level, not at compile time.

## Coupling

- **flows** ([`src/flows/`](../../src/flows)): every layout/render entry point takes a parsed `FlowDiagram` as input (`import type { FlowDiagram, FlowEdge, FlowStoreRef } from '../flows/flow-parse'` in `flow-layout.ts` and `elk-flow-layout.ts`) — type-only, no runtime dependency. `flow-nav.ts` additionally imports `CONTEXT_DIAGRAM_ID`/`SYNTHETIC_DIAGRAM_IDS`/`SYSTEM_PROCESS_ID` from `src/flows/flow-derive-levels` and reads `FlowDiagram.description`/`FlowProcess.description`, which [`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts) populates from a DFD folder's `index.md` frontmatter (`readDiagramDescription`) and a process file's own `description:`. `FlowChrome.tsx` also imports `SYNTHETIC_DIAGRAM_IDS` directly, to tell whether the on-screen diagram is a derived level. flow-view never parses, validates, or levels diagrams itself; a shape change to `FlowDiagram`/`FlowStoreRef`/edge endpoint kinds or to the description/id fields forces a review of every flow-view file that imports them.
- **frontend** ([`src/app/`](../../src/app)): [`src/app/views/flow/FlowsView.tsx`](../../src/app/views/flow/FlowsView.tsx) is the sole orchestrator — it owns `flowViewParams` (`{ view, collapseLevel }`, default `{ view: 'per-process', collapseLevel: 'clusters' }`), calls `computeElkLayout(diagram, flowDataOpts)`, catches ELK failures so the renderer falls back to the banded layout, calls `layoutKeyForView`, and passes `modelName`/`modelDescription` into `FlowChrome` for the flow index's title and root/whole-system descriptions. It also owns diagram selection: `selectDiagramById` (popstate and flow search, via `findDiagramByRef`) and `selectDiagramPath` (breadcrumb/level-menu/index picks, via `resolveDiagramPath`) both call a shared `showPath`, which rebuilds the breadcrumb stack with `stackFor` and writes the new `diagramRef` out through `onDiagramChange`; the initial stack seeds from `findDiagramByRef(allDiagrams, startDiagramId)` falling back to `defaultDiagramPath`. [`src/app/hash-router.ts`](../../src/app/hash-router.ts) owns the `FlowViewMode`/`FlowCollapseLevel` types, the `flowview=`/`collapse=` URL params, and the `dfd=` param, whose value it keeps as a path reference with `/` left unencoded (`serializeHash` special-cases it rather than letting `URLSearchParams` percent-encode the separator). [`src/app/logic/motion.ts`](../../src/app/logic/motion.ts) is the source of `createHoverIntent`/`HOVER_INTENT_MS` and `animationsAllowed`/`ANIMATION_ELEMENT_LIMIT` that `FlowDiagramSvg` consumes for hover settle and the animation cutoff — shared verbatim with the Graph and Dictionary views; its internals belong to the frontend domain page, not here. [`src/app/logic/search.ts`](../../src/app/logic/search.ts) supplies `compareDottedProcesses` (used by `flow-nav.ts` for level ordering) and `searchFlowDiagrams`, whose base tokens `FlowDiagramSvg.tsx`'s `baseToken` strips to match against. [`src/app/views/flow/LegendModal.tsx`](../../src/app/views/flow/LegendModal.tsx) imports `DARK_PALETTE`/`LIGHT_PALETTE` from `FlowDiagramSvg.tsx` directly. `FlowDiagramSvg.tsx` imports `PositionMap` from [`src/app/views/graph/layout-store`](../../src/app/views/graph/layout-store.ts) for drag persistence. `StackDialog` and the edge contract dialog live in [`src/app/components/flow-node/`](../../src/app/components/flow-node), outside this domain — `FlowDiagramSvg`'s `onOpenStack`/`onOpenContract` callbacks are the only link, and opening the contract dialog calls `hoverIntent.applyNow(null)` to drop a stale tooltip; opening a stack does not.
- **theme** ([`src/theme/`](../../src/theme)): `flow-layout.ts` and `FlowDiagramSvg.tsx` import `FlowKindKey`/`FlowKindEntry` from `src/theme/theme-defaults` for kind-colored store/external fills.
- **docs**: [`docs/spec/large-model-nav.md`](../spec/large-model-nav.md) / [`docs/design/large-model-nav.md`](../design/large-model-nav.md) is the source of the breadcrumb level menus, the flow index, the `dfd=` path-reference format, the hover-intent delay, and the animation cutoff. [`docs/spec/dfd-store-clusters.md`](../spec/dfd-store-clusters.md) / [`docs/design/dfd-store-clusters.md`](../design/dfd-store-clusters.md) is the source of the stack-node model, the per-process/connected views, the collapse level, and the mixed-label chip rule. [`docs/spec/dfd-overhaul.md`](../spec/dfd-overhaul.md) / [`docs/design/dfd-overhaul.md`](../design/dfd-overhaul.md) is the source of the 5-band ELK layout contract (cited by name in `elk-flow-layout.ts`'s `bandOf`). [`docs/research/dfd-layout-and-leveling.md`](../research/dfd-layout-and-leveling.md) is the evidence base behind the ELK pipeline. [`docs/design/dfd-edge-hover-data.md`](../design/dfd-edge-hover-data.md) / [`docs/spec/dfd-edge-hover-data.md`](../spec/dfd-edge-hover-data.md) is the source of the edge-hover tooltip (`dataLines`, `tooltipLines`). [`docs/spec/viewer-ux-polish.md`](../spec/viewer-ux-polish.md) is the source of the native-1:1 zoom model in `zoom-scale.ts`. [`docs/design/graph-flow-search.md`](../design/graph-flow-search.md) / [`docs/spec/graph-flow-search.md`](../spec/graph-flow-search.md) is the source of the `searchTokens` dimming feature.
- **Tests**: [`test/checks/test-flow-nav.ts`](../../test/checks/test-flow-nav.ts) exercises `flow-nav.ts` directly (path resolution, `diagramRef`/`findDiagramByRef`, level entries, index construction, id-collision handling). [`test/checks/test-large-model-nav.ts`](../../test/checks/test-large-model-nav.ts) drives a served fixture through Playwright to check the breadcrumb menus, the flow index, the hover-intent delay, and the animation cutoff end to end. [`test/checks/test-hash-router.ts`](../../test/checks/test-hash-router.ts) covers the `dfd=` path round-trip through `hash-router.ts`. [`test/checks/test-flow-diagram-description.ts`](../../test/checks/test-flow-diagram-description.ts) covers `FlowDiagram.description` at its source in the flows domain ([`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts)), not in this domain.
