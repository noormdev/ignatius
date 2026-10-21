# Graph tree layout


## Goal


The Graph view gains a third layout mode, Tree: an indented outline where each table sits below and to the right of the table whose key it inherits, a tree or lookup parent is always above and left of its child, and every line leaves its parent's bottom edge and enters its child's left side.


## Non-goals


- Column lists or icons inside the boxes.
- Free-floating notes on the canvas.
- Changing the Organic or Hierarchical layouts.


## Success criteria


- [x] `LayoutMode` is `'organic' | 'hierarchical' | 'tree'`. `L` and the FAB item step organic → hierarchical → tree → organic (`nextLayoutMode`); the FAB item names the next mode. A stored `ignatius-layout-mode` that is not one of the three reads as organic (`parseLayoutMode`).
- [x] `buildForest(nodes, edges)` in `tree-layout.ts`: a node's parent is its deepest key-inheritance parent (ties by id); without one, a plain FK parent that is neither a classifier nor a hub (referenced without key inheritance by at least max(8, 10% of the nodes) tables). A cycle is cut at a non-key link, smallest id first. A childless, non-hub root referenced by some table is a lookup (`Forest.lookups`): it gets no tree parent and is assigned to one consumer that is not itself a lookup, same colour group first, then id; a lookup used only by other lookups stays a root.
- [x] `layoutTree(nodes, edges)` returns positions and a route per edge. Depth first; children smallest subtree first; a child's indent = lane fan + widest sibling label (6 px per character + 28 px), at least 28 px. Tree lanes fan across the left half of the parent's bottom edge from 10 px in, at most 6 px apart (every lane fan uses this gap) and squeezed to fit the half; a node whose half is 10 px or narrower sends them all down one trunk from its centre. The first child's lane is rightmost.
- [x] A tree's lookups form a staircase above it: each lookup's lanes drop from its bottom-left, fanned like tree lanes (at most 6 px apart, squeezed to fit the left half), and the next lookup starts right of them. The lookup feeding the deepest table is top-left, so a lookup's run into its deepest table crosses no other lookup's lane (a run into a shallower table may). The tree starts right of the last lane plus the widest lookup label run, below the staircase. A lookup joins only its assigned consumer's tree; its links into other trees, and into tables placed in a wrapped column (a run there would pass behind the boxes on that row), are cross links.
- [x] `routeTree(nodes, positions, lines)` routes `lines` (`TreeLine`: which lines are tree lines) at the given positions; `layoutTree` calls it on its own result. A tree line stays `down` only while its child sits below its parent and right of its lane (otherwise `cross`). `down` lanes (`laneDx` from the parent's left edge) fan across the left half, the topmost child on the rightmost lane, at most 6 px apart. Every `cross` route has a `slot` (lane from the parent's right edge, street below its bottom, approach column left of the child): per parent, the farthest child takes the outer lane and top street (so lines to children right of and below the parent nest; lines to children left or above can cross inside the street band), each line its own lane fanned across the right half and its own street spread 10–16 px below the bottom (at most 2 px apart). Rows are 20 px apart. Lanes on both halves stop 2 px short of the centre. Ties break by edge id.
- [x] Into each child: cross links from above enter highest, then `down` lines from the rightmost lane to the leftmost, then cross links from below; `entryDy` at most 6 px apart and within the child's height. Approach columns follow that order (12 px left of the child, 6 px apart): from above, the further-left column enters lower; from below (numbered after those from above), higher. No two last turns into one child cross.
- [x] Trees are stacked into columns of height √(area / 1.6), counting lookup staircases. Order: `orderRegions` over colour groups by cross-tree links, then over the trees in each group, so a referenced tree comes first.
- [x] Wrapping measures from the top of the tree, below its lookup staircase, with the column height as the limit; a child "fits" when its unwrapped subtree height (`stackHeight`) does. A parent whose subtree would run past the limit keeps its first child and those that fit under it; the rest wrap into columns to its right (80 px apart), each starting at the parent's first child row, 20 px below its bottom edge, and their lines are cross links. Children wrap only when a fresh column has room below that row for two of the parent's child rows (tallest child box + 20 px each); otherwise they stay under it and the tree runs past the column. A subtype joiner (`joiner`) never wraps: it stays under its basetype and goes first among its siblings when they wrap, and its members wrap instead.
- [x] `routeGeometry(route, parentBox, childBox)` gives the line drawn now: its parent end on the parent's bottom edge, its child end on the child's left edge, and the bends between. `down`: one bend at (lane, entry row). While a drag moves a `down` route's child out of place, the line is drawn with cross geometry; when the drag ends the graph re-routes. `cross`: bends at (lane, street) twice, (approach, street), (approach, entry row).
- [x] In Tree mode every routed edge is a `segments` edge (`edge-distances: node-position`) with its ends pinned through `source-endpoint`/`target-endpoint` offsets. A line drawn `down` carries its label as the `target-label` (`source-label` when the edge runs child→parent), horizontal, 9 px above the run, halfway along it. A line drawn `cross` carries its mid label centred on the street. Bends are recomputed whenever a node moves. After a hide, a reveal, an undo or a drag the graph calls `routeTree` on the boxes as they stand, keeping which lines the last Tree layout drew as tree lines, so no line reorders.
- [x] Leaving Tree mode removes the routing classes (`tree-edge`, `tree-label-source`, `tree-cross`) and only the routing style bypasses (`segment-weights`, `segment-distances`, `source-endpoint`, `target-endpoint`, `source-text-offset`, `target-text-offset`). Bypasses survive a stylesheet swap, so a retheme does not re-route. Undoing a pending switch restores the mode before the routing is re-applied. Routing follows the mode the on-screen positions belong to, so a switch still computing keeps the old routing.
- [x] Crow's-foot markers take each end's angle from the adjacent bend point on segmented edges; with pinned ends that is vertical at the parent and horizontal at the child.
- [x] Checks: `test-tree-layout.ts` (including chained lookups, wrapped children starting a row below their parent and overlapping no box, lookup lines into wrapped tables as cross links, a lookup feeding only wrapped tables, a deep chain under 3:1, a parent with room for under two rows keeping its children and one with room for two wrapping, a joiner going first under a wrapping basetype and keeping its place when nothing wraps, two clusters on one basetype, `routeGeometry` fallback, no crossing last turns, distinct lanes and streets), `test-graph-edits.ts` case 6; Playwright `test/visual/test-graph-edits.ts` steps 6a (right-angled within 0.5 px before and after a drag) and 6a2 (undo during a pending switch keeps the routing).


## Approach


Depth-first outline; lookups in a staircase above each tree; every line routed bottom-to-left as `segments`. See [`docs/design/graph-tree-layout.md`](../design/graph-tree-layout.md).


## Change tree


```
src/app/
├── App.tsx ................................ M  (parseLayoutMode, nextLayoutMode)
├── components/ui/
│   ├── FabMenu.tsx ........................ M  (next mode label)
│   └── HelpModal.tsx ...................... M  (Tree in Layouts and L rows)
└── views/graph/
    ├── GraphView.tsx ...................... M  (tree branch in runLayout, edge routing)
    ├── graph-edits.ts ..................... M  (tree mode, nextLayoutMode, parseLayoutMode)
    ├── markers.ts ......................... M  (angle from adjacent bend)
    ├── styles.ts .......................... M  (tree-edge, tree-cross classes)
    └── tree-layout.ts ..................... A
scripts/perf-harness.ts .................... M  (--mode tree)
test/checks/
├── test-graph-edits.ts .................... M
├── test-keyboard-shortcuts.ts ............. M  (L steps with nextLayoutMode)
└── test-tree-layout.ts .................... A
test/visual/test-graph-edits.ts ............ M
docs/
├── design/graph-tree-layout.md ............ A
├── guides/commands.md ..................... M
├── spec/
│   ├── graph-arrangement.md ............... M  (LayoutMode includes tree)
│   ├── graph-tree-layout.md ............... A
│   ├── help-overlay.md .................... M
│   └── keyboard-nav-shortcuts.md .......... M
└── wiki/
    ├── feature-map.md ..................... M
    ├── frontend.md ........................ M
    ├── index.md ........................... M  (Tree engine in the stack line)
    └── scripts.md ......................... M  (--mode tree)
```


## Outline


```
tree-layout.ts
  TreeNodeInput / TreeEdgeInput — size, group, classifier, joiner; parent→child edges
  CrossSlot — lane, street and approach of the cross geometry
  TreeRoute — down or cross; lane, street, approach and entry offsets
  Box / RouteGeometry — a node's box; the ends, bends and label of a line drawn now
  routeGeometry — a route's line between two boxes, falling back to cross geometry
  buildForest — tree parents, hubs, cycle cuts, lookups and their consumers
  layoutTree — depth-first rows, lanes, wrapping wide parents, lookup staircases, ordering, column packing
  TreeLine — an edge to route and whether the last layout drew it as a tree line
  routeTree — lanes, slots, entries and approach columns at given positions
  crossSlots — a lane and street per cross link from each parent
  assignEntries — entry rows and approach columns on each child's left side
graph-edits.ts
  LayoutMode — organic, hierarchical, tree
  nextLayoutMode / parseLayoutMode / LAYOUT_MODE_NAME — L cycle and stored mode
GraphView.tsx
  treeInput — visible nodes and edges for the layout
  applyEdgeRouting — tree-edge / tree-label-source / tree-cross classes for the positions' mode
  routeTreeEdge — down and cross bends as segment weights and distances
markers.ts
  updateMarkers — angle from the adjacent bend
```


## Flows


**Switch to Tree**

1. User presses `L` on Hierarchical; the mode is stored as `tree`.
2. `runLayout('tree')` builds the forest from the visible graph and applies `layoutTree` positions.
3. The layout settles; `applyEdgeRouting` marks tree, lookup and cross lines and sets every routed edge's bends.

**Drag in Tree**

1. User drags a table.
2. Each `position` event re-routes the dragged node's connected edges from their stored offsets.


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Cross-link labels pile up where several streets pass the same area | med | They are de-emphasised by span grading and hidden at overview zoom like every label |
| Cross links run behind unrelated boxes (no obstacle avoidance; most cross links on a real model pass at least one) | high | Lines are drawn under boxes, so a line never covers a table; the crow's feet mark the true ends |
| Cross links into stacked siblings can share an approach column, and long streets can run along other lines | med | Lanes, streets and columns are distinct per parent and per child; across them there is no global channel routing |
| A busy parent's lines (a hub such as `users`) fan into lanes and streets under 4 px apart, which the 3 px edge casing draws as one band | med | Lanes and streets stay distinct in position; hiding the hub removes the band |
| The hub threshold misses a hub or catches a real parent | low | Key-inheritance parents are never excluded; the user can hide a hub |
| A deep chain whose last child wraps at every level steps right one column per level, wider than 16:10 (the 120-entity synthetic model lays out at w/h 2.25) | med | Every line still runs down and right; check 6i pins a 9-level chain under 3:1 |
| A second subtype cluster on the same basetype, or a cluster under a basetype without room for two rows below it, runs past the column | med | Under a basetype whose children wrap, the joiner goes first, so one cluster gets the column's room and its members wrap; check 7g pins that case above 0.8 w/h |


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Forest and placement: tree parents, hubs, cycle cuts, lookups and their staircase, depth-first rows and lanes, column packing | `src/app/views/graph/tree-layout.ts`, `test/checks/test-tree-layout.ts` | main | 2 | `test-tree-layout.ts` cases 1–5 |
| 2 | Wrapping wide parents into columns one row below them, the two-row room rule, joiners first, lookup lines into wrapped tables as cross links | `src/app/views/graph/tree-layout.ts`, `test/checks/test-tree-layout.ts` | main | 2 | `test-tree-layout.ts` cases 6a–7j |
| 3 | Routing: tree and cross lines, lanes, streets, entry rows and approach columns, re-routing on the boxes as they stand | `src/app/views/graph/tree-layout.ts`, `test/checks/test-tree-layout.ts` | main | 2 | `test-tree-layout.ts` cases 8–10 |
| 4 | Tree mode in the Graph view: `L` cycle, segments edges with pinned ends, re-route after hide, reveal, undo and drag, marker angles | `GraphView.tsx`, `graph-edits.ts`, `styles.ts`, `markers.ts`, `App.tsx`, `FabMenu.tsx`, `HelpModal.tsx`, `scripts/perf-harness.ts` | main | 8 | `test-graph-edits.ts` case 6, `test-keyboard-shortcuts.ts`, Playwright `test/visual/test-graph-edits.ts` steps 6a, 6a2, 6b |
| 5 | Surfaces: design, spec, guide, help overlay, keymap, wiki | `docs/design/graph-tree-layout.md`, `docs/spec/*.md`, `docs/guides/commands.md`, `docs/wiki/*.md` | main | 10 | Feature-map row and every surface describe the same behaviour |


## Change log


### 2026-10-20 — Correction: checkpoints table

**What changed:** added the `## Checkpoints` table; the contract it lists was already in the success criteria.

**Why:** `atomic validate spec` failed S5 (missing `## Checkpoints`).

### 2026-10-20 — Wide parents wrap into columns

**What changed:** a parent whose children would run past the column keeps those that fit and wraps the rest into columns to its right, each starting one row below it, with cross links. Children wrap only when a fresh column has room for two of the parent's child rows. A subtype joiner goes first among its siblings when they wrap. A lookup's line into a table in a wrapped column is a cross link.

**Why:** split-off subtrees were ordered as trees of their own and could land above or left of their parent, so the line between them ran up (on orm-pure, `Identity` sat 316 px above `Party`).

**Superseded:** a tree taller than a column became trees of their own, and a joiner shed the members that did not fit.
