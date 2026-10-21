# Graph tree layout


## Goal


The Graph view gains a third layout mode, Tree: an indented outline where each table sits below and to the right of the table whose key it inherits, a tree or lookup parent is always above and left of its child, and every line leaves its parent's bottom edge and enters its child's left side.


## Non-goals


- Column lists or icons inside the boxes.
- Free-floating notes on the canvas.
- Changing the Organic or Hierarchical layouts.


## Success criteria


- [x] `LayoutMode` is `'organic' | 'hierarchical' | 'tree'`. `L` and the FAB item step organic → hierarchical → tree → organic (`nextLayoutMode`); the FAB item names the next mode. A stored `ignatius-layout-mode` that is not one of the three reads as tree (`parseLayoutMode`). On load the mode is the stored one; with none stored it is Organic when `ignatius-layout-positions` already holds an arrangement (`LayoutStoreHandle.hasEntries`; laid out in Organic, the default before the mode was always stored) and Tree otherwise (`loadLayoutMode`); the result is stored at once.
- [x] `buildForest(nodes, edges)` in `tree-layout.ts`: a node's parent is its deepest key-inheritance parent (ties by id); without one, a plain FK parent that is neither a classifier nor a hub (referenced without key inheritance by at least max(8, 10% of the nodes) tables). A cycle is cut at a non-key link, smallest id first. A childless, non-hub root referenced by some table is a lookup (`Forest.lookups`): it gets no tree parent and is assigned to one consumer that is not itself a lookup, same colour group first, then id; a lookup used only by other lookups stays a root.
- [x] `layoutTree(nodes, edges)` returns positions and a route per edge. Depth first; children smallest subtree first; a child's indent = trunk + widest sibling label (6 px per character + 28 px), at least 28 px. A line's label (`TreeEdgeInput.label`) is the longer of its forward and reverse predicates, because hovering the child swaps the reverse one onto the same run. A parent's tree lines share one trunk (`trunkOffset`) a quarter of its width in from its left edge (at least 10 px, at most 2 px short of the centre): each drops down the trunk and branches right into its child.
- [x] A tree's lookups form a staircase above it: each lookup's lines share one trunk placed like a tree trunk, and the next lookup starts 10 px right of it. The lookup feeding the deepest table is top-left, so a lookup's run into its deepest table crosses no other lookup's trunk (a run into a shallower table may). The tree starts right of the last trunk plus the widest lookup label run, below the staircase. A lookup joins only its assigned consumer's tree; its links into other trees, and into tables placed in a wrapped column (a run there would pass behind the boxes on that row), are cross links.
- [x] `routeTree(nodes, positions, lines)` routes `lines` (`TreeLine`: which lines are tree lines) at the given positions; `layoutTree` calls it on its own result. A tree line stays `down` (`trunkDx`: its trunk) only while its child sits below its parent and right of its trunk by more than 2 px plus room for the child's other lines from above, of either kind (12 px for the first, 6 px for each further one), so none of their columns crosses the trunk; otherwise it is `cross`. Every `cross` route has a `slot` (lane from the parent's right edge, street below its bottom, approach column left of the child). Cross links from one parent into children sharing a left edge, below its street, right of it and with no tree line into them, share one lane, one street and one drop, and carry `runLabel`. The drop starts left of the column by the wider of a label run (the widest of their labels) and room for the other parents' columns into its children (12 px plus 6 px per line). When that start is not right of the parent's right edge, the column is not shared and its lines take their own lanes and streets. Otherwise the drop sits at the nearest x from that start leftwards, right of the parent, where the drop, its street and its runs miss every box. With no such x, several lines keep the drop at its start, since on separate streets their labels would print over each other; a single line takes its own lane and street. A single line's drop also gives way to its own lane and street when another parent's street into the same child would cross it. One parent's lines share a column's drop: the parent with the most lines into it, the farthest reaching on a tie, then by id. Every other cross link gets its own lane and street. Per parent, the farthest unit takes the outer lane and top street (so lines to children right of and below the parent nest; lines to children left or above can cross inside the street band); lanes fan across the right half at most 6 px apart, stopping 2 px short of the centre, and streets spread 10–16 px below the bottom (at most 2 px apart). Rows are 20 px apart. Ties break by edge id.
- [x] Into each child: cross links from above enter highest, then `down` lines from the rightmost trunk to the leftmost, then cross links from below; `entryDy` at most 6 px apart and within the child's height. Approach columns follow that order (12 px left of the child, 6 px apart): from above, the further-left column enters lower, with shared drops (`runLabel`) leftmost; from below (numbered after those from above), higher. No two last turns into one child cross. When a child's own approach columns (cross links without `runLabel`) or their runs would pass through a box, those from above move left together, and those from below move left together, to the nearest position clear of boxes (6 px steps up to 360 px, or just right of a box's edge). Columns from above also stay right of the other lines' last verticals into the child (its tree trunks and shared drops), so no last turns cross. If no position is clear for the lines from above, each of them still blocked jogs (`slot.jog`): it drops through the column nearest its approach column that lies right of those verticals and no more than 12 px right of whichever lies further right, the child's right edge or its own lane, at least 6 px from the child's other columns and from any other jog's drop over the same rows, with no other column from above between it and the approach column and no other from-above line's street across its drop, clear down to a row 10 px above the child; it crosses to the approach column and drops into the child. So only the outermost lines from above can jog, to either side; with no clear column a line stays as routed. Lines from below never jog; with no clear position they stay as routed.
- [x] Trees are stacked into columns of height √(area / 1.6), counting lookup staircases. Order: `orderRegions` over colour groups by cross-tree links, then over the trees in each group, so a referenced tree comes first.
- [x] Wrapping measures from the top of the tree, below its lookup staircase, with the column height as the limit; a child "fits" when its unwrapped subtree height (`stackHeight`) does. A parent whose subtree would run past the limit keeps its first child and those that fit under it; the rest wrap into columns to its right, each starting at the parent's first child row, 20 px below its bottom edge, and their lines are cross links. The gap before a wrapped column is 80 px or, if wider, 12 px plus the label run of every line into the wrapped children, so each label fits its run. Children wrap only when a fresh column has room below that row for two of the parent's child rows (tallest child box + 20 px each); otherwise they stay under it and the tree runs past the column. A subtype joiner (`joiner`) never wraps: it stays under its basetype and goes first among its siblings when they wrap, and its members wrap instead.
- [x] `routeGeometry(route, parentBox, childBox)` gives the line drawn now: its parent end on the parent's bottom edge, its child end on the child's left edge, and the bends between. `down`: one bend at (trunk, entry row). While a drag moves a `down` route's child out of place, the line is drawn with cross geometry; when the drag ends the graph re-routes. `cross`: bends at (lane, street) twice, (approach, street), (approach, entry row); with a jog, (lane, street) four times, (drop, street), (drop, jog row), (approach, jog row), (approach, entry row), so the mid label stays on the street.
- [x] In Tree mode every routed edge is a `segments` edge (`edge-distances: node-position`) with its ends pinned through `source-endpoint`/`target-endpoint` offsets. A line drawn `down`, or `cross` with `runLabel`, carries its label as the `target-label` (`source-label` when the edge runs child→parent), horizontal, 9 px above the run into the child, halfway along it. Any other line drawn `cross` carries its mid label centred on the street. Bends are recomputed whenever a node moves. After a hide, a reveal, an undo or a drag the graph calls `routeTree` on the boxes as they stand, keeping which lines the last Tree layout drew as tree lines, so no line reorders.
- [x] Leaving Tree mode removes the routing classes (`tree-edge`, `tree-label-source`, `tree-cross`) and only the routing style bypasses (`segment-weights`, `segment-distances`, `source-endpoint`, `target-endpoint`, `source-text-offset`, `target-text-offset`). Bypasses survive a stylesheet swap, so a retheme does not re-route. Undoing a pending switch restores the mode before the routing is re-applied. Routing follows the mode the on-screen positions belong to, so a switch still computing keeps the old routing.
- [x] Crow's-foot markers take each end's angle from the adjacent bend point on segmented edges; with pinned ends that is vertical at the parent and horizontal at the child.
- [x] Checks: `test-tree-layout.ts` (including chained lookups, wrapped children starting a row below their parent and overlapping no box, lookup lines into wrapped tables as cross links, a lookup feeding only wrapped tables, a deep chain under 3:1, a parent with room for under two rows keeping its children and one with room for two wrapping, a joiner going first under a wrapping basetype and keeping its place when nothing wraps, two clusters on one basetype, one shared trunk per parent, shared lane, street and drop into a wrapped column with labels on the runs, an approach column moving past a box, a jog when no straight drop is clear, a line from below moving past a box, a jog never crossing the child's own trunk nor dropping down another line's column, the drop owned by the parent with the most lines, several lines keeping a blocked drop and one line giving it up, a cross link clear of a trunk into the same child, two blocked lines into one child neither crossing nor overlapping, both outer lines jogging to either side, a jog drop never right of both its child and its lane, a jog from a parent far to the right dropping short of its lane, two jogs never sharing a drop, a several-line drop moving left past a box and sitting left of the other columns, a parent too close to its column giving up the drop, a demoted second tree line counting toward the trunk's room, a line from below taking none of it, a crossed drop of several lines kept, a one-line drop giving way to a street that would cross it, `routeGeometry` fallback, no crossing last turns, distinct lanes and streets), `test-graph-edits.ts` case 6, `test-layout-store.ts` case 9, `test-tree-predicate-hover.ts` (every reverse label shown on hover fits its run), `test-graph-fit-clear.ts` (contract in viewer-ux-polish #3); Playwright `test/visual/test-graph-edits.ts` steps 6a (right-angled within 0.5 px before and after a drag) and 6a2 (undo during a pending switch keeps the routing).


## Approach


Depth-first outline; lookups in a staircase above each tree; every line routed bottom-to-left as `segments`. See [`docs/design/graph-tree-layout.md`](../design/graph-tree-layout.md).


## Change tree


```
src/app/
├── App.tsx ................................ M  (loadLayoutMode, nextLayoutMode)
├── components/ui/
│   ├── FabMenu.tsx ........................ M  (next mode label)
│   └── HelpModal.tsx ...................... M  (Tree in Layouts and L rows)
└── views/graph/
    ├── GraphView.tsx ...................... M  (tree branch in runLayout, edge routing, longer predicate as label, fitGraph)
    ├── graph-edits.ts ..................... M  (tree mode, nextLayoutMode, parseLayoutMode, loadLayoutMode)
    ├── layout-store.ts .................... M  (hasEntries)
    ├── markers.ts ......................... M  (angle from adjacent bend)
    ├── styles.ts .......................... M  (tree-edge, tree-cross classes)
    └── tree-layout.ts ..................... A
scripts/perf-harness.ts .................... M  (--mode tree)
test/checks/
├── test-graph-edits.ts .................... M
├── test-graph-fit-clear.ts ................ A
├── test-keyboard-shortcuts.ts ............. M  (L steps with nextLayoutMode; first visit stores tree)
├── test-graph-search.ts ................... M  (first visit stores tree; hover evaluates return nothing)
├── test-layout-store.ts ................... M  (hasEntries)
├── test-tree-layout.ts .................... A
└── test-tree-predicate-hover.ts ........... A
test/visual/
├── screenshot-lineage-highlight.ts ........ M  (fit evaluate returns nothing)
└── test-graph-edits.ts .................... M
docs/
├── design/graph-tree-layout.md ............ A
├── guides/commands.md ..................... M
├── spec/
│   ├── graph-arrangement.md ............... M  (LayoutMode includes tree)
│   ├── graph-tree-layout.md ............... A
│   ├── help-overlay.md .................... M
│   ├── keyboard-nav-shortcuts.md .......... M
│   └── viewer-ux-polish.md ................ M  (Graph fit clears the header and footer)
└── wiki/
    ├── feature-map.md ..................... M
    ├── frontend.md ........................ M
    ├── index.md ........................... M  (Tree engine in the stack line)
    └── scripts.md ......................... M  (--mode tree)
```


## Outline


```
tree-layout.ts
  TreeNodeInput / TreeEdgeInput — size, group, classifier, joiner; parent→child edges and the label runs fit
  CrossSlot — lane, street and approach of the cross geometry, and a jog's drop and row
  TreeRoute — down or cross; trunk, slot, entry offset, and runLabel for a shared drop
  Box / RouteGeometry — a node's box; the ends, bends and label of a line drawn now
  routeGeometry — a route's line between two boxes, falling back to cross geometry
  buildForest — tree parents, hubs, cycle cuts, lookups and their consumers
  trunkOffset — where a parent's shared trunk drops
  layoutTree — depth-first rows, trunks, wrapping wide parents, lookup staircases, ordering, column packing
  TreeLine — an edge to route, its label, and whether the last layout drew it as a tree line
  routeTree — trunks kept only with room for the child's columns from above; slots, entries and approach columns
  crossSlots — one owner per wrapped column; gives a crossed one-line drop its own slot and spreads again
  parentSlots — one parent's units on lanes and streets, a column's drop kept for several lines
  clearDrop — the nearest drop x whose street, drop and runs miss every box
  crossedDrops — one-line drops another parent's street into the same child crosses
  assignEntries — entry rows and approach columns on each child's left side
  clearApproaches — splits a child's approach columns into from above and from below; jogs blocked lines from above
  shiftClear — moves a group of approach columns left together to the nearest position clear of boxes
  JogDrop / jogAround — a drop through a clear column and across above the child when no straight drop clears; jogs never share a drop
graph-edits.ts
  LayoutMode — organic, hierarchical, tree
  nextLayoutMode / parseLayoutMode / LAYOUT_MODE_NAME — L cycle and stored mode
  loadLayoutMode — the mode on load: stored, else Organic for a saved arrangement, else Tree
layout-store.ts
  hasEntries — whether any arrangement is saved
GraphView.tsx
  treeInput — visible nodes and edges for the layout, each labelled with its longer predicate
  applyEdgeRouting — tree-edge / tree-label-source / tree-cross classes for the positions' mode
  routeTreeEdge — down and cross bends as segment weights and distances
  fitGraph — fits the graph between the header chrome and the footer (contract: viewer-ux-polish #3)
markers.ts
  updateMarkers — angle from the adjacent bend
```


## Flows


**First load**

1. App reads `ignatius-layout-mode`; with a mode stored, that mode opens.
2. With none stored, `loadLayoutMode` picks Organic when `hasEntries` finds a saved arrangement, else Tree.
3. App stores the result, so later loads read it directly.

**Switch to Tree**

1. User presses `L` on Hierarchical; the mode is stored as `tree`.
2. `runLayout('tree')` builds the forest from the visible graph and applies `layoutTree` positions.
3. The layout settles; `applyEdgeRouting` marks tree, lookup and cross lines and sets every routed edge's bends.

**Drag in Tree**

1. User drags a table.
2. Each `position` event re-routes the dragged node's connected edges from their stored offsets.

**Hover in Tree**

1. User rests the pointer on a table.
2. Each line into it swaps its label to the reverse predicate, on the same run; the run was sized for the longer predicate, so the label fits.
3. Leaving the table restores the forward predicates.


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Labels of cross links that keep their own streets pile up where several streets pass the same area | med | Lines into a wrapped column carry their labels on their own runs; the rest are de-emphasised by span grading and hidden at overview zoom like every label |
| Streets and lookup trunks run behind unrelated boxes (only approach columns, shared drops and jogs avoid boxes) | med | Lines are drawn under boxes, so a line never covers a table; the crow's feet mark the true ends |
| Cross links into stacked siblings can share an approach column, and long streets can run along other lines | med | Lanes, streets and columns are distinct per parent and per child, except lines into one wrapped column, which share one; across them there is no global channel routing |
| A busy parent's cross links (a hub such as `users`) fan into lanes and streets under 4 px apart, which the 3 px edge casing draws as one band | med | Lanes and streets stay distinct in position; hiding the hub removes the band |
| The hub threshold misses a hub or catches a real parent | low | Key-inheritance parents are never excluded; the user can hide a hub |
| A deep chain whose last child wraps at every level steps right one column per level, wider than 16:10 (the 120-entity synthetic model lays out at w/h 2.25) | med | Every line still runs down and right; check 6i pins a 9-level chain under 3:1 |
| A second subtype cluster on the same basetype, or a cluster under a basetype without room for two rows below it, runs past the column | med | Under a basetype whose children wrap, the joiner goes first, so one cluster gets the column's room and its members wrap; check 7g pins that case above 0.8 w/h |
| One trunk carries identifying (solid) and non-identifying (dashed) lines; along the shared part the later line's casing hides the other, and their parent-end markers sit on one point | low | Each line's own branch and child-end marker still show its kind; the shared part is the parent's trunk |
| A jog (drop, cross above the child, drop) can cross other parents' trunks, streets and lanes on its way across, and its drop can run along another child's approach column; fresh layouts jog (orm-pure, llm-memory-db-mssql and the synthetic models) | med | Jogs are used only when every straight drop would run behind a box, stay right of the child's own trunks and shared drops, and never share a drop with another jog; a line whose only jog would is left behind its box |
| A parent dragged so close to its wrapped column that the drop's start (a label run, or room for the other parents' columns into its children) is not right of it gives up the shared drop, and its lines' street labels, at most 2 px apart, overlap | low | Only after such a drag; moving the parent back restores the drop |
| A blocked line from above whose column sits between two others into the same child cannot jog (its row would cross one of them) and still runs behind a box | low | The outermost lines jog to either side, and their rows never meet |
| With no clear place for a column's drop (a drag or hide puts a box in the gap), several lines keep the drop and can run behind that box | low | Their labels stay on separate runs; a single line takes its own slot instead |
| Another parent's street into the same child can cross a drop of several lines | low | A one-line drop gives way to its own slot; on the demo models no drop of several lines is crossed |


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Forest and placement: tree parents, hubs, cycle cuts, lookups and their staircase, depth-first rows and trunks, column packing | `src/app/views/graph/tree-layout.ts`, `test/checks/test-tree-layout.ts` | main | 2 | `test-tree-layout.ts` cases 1–5 |
| 2 | Wrapping wide parents into columns one row below them, the two-row room rule, joiners first, lookup lines into wrapped tables as cross links | `src/app/views/graph/tree-layout.ts`, `test/checks/test-tree-layout.ts` | main | 2 | `test-tree-layout.ts` cases 6a–7j |
| 3 | Routing: tree and cross lines, lanes, streets, entry rows and approach columns, re-routing on the boxes as they stand | `src/app/views/graph/tree-layout.ts`, `test/checks/test-tree-layout.ts` | main | 2 | `test-tree-layout.ts` cases 8–10 |
| 4 | Tree mode in the Graph view: `L` cycle, Tree on a first visit, segments edges with pinned ends, re-route after hide, reveal, undo and drag, marker angles, fit between the header and footer | `GraphView.tsx`, `graph-edits.ts`, `layout-store.ts`, `styles.ts`, `markers.ts`, `App.tsx`, `FabMenu.tsx`, `HelpModal.tsx`, `scripts/perf-harness.ts` | main | 9 | `test-graph-edits.ts` case 6, `test-layout-store.ts` case 9, `test-keyboard-shortcuts.ts`, `test-tree-predicate-hover.ts`, `test-graph-fit-clear.ts`, Playwright `test/visual/test-graph-edits.ts` steps 6a, 6a2, 6b |
| 5 | Surfaces: design, spec, guide, help overlay, keymap, wiki | `docs/design/graph-tree-layout.md`, `docs/spec/*.md`, `docs/guides/commands.md`, `docs/wiki/*.md` | main | 10 | Feature-map row and every surface describe the same behaviour |


## Change log


### 2026-10-21 — Correction: runs fit the reverse predicate

**What changed:** a line's label width is the longer of its forward and reverse predicates.

**Why:** hovering a table swaps each line into it to the reverse predicate on the same run; runs sized for the forward one let "← is placed by" run 8 px past its run on key-inherited, into the trunk and the child's box (`test-tree-predicate-hover.ts`).

**Superseded:** the label was the forward predicate only.

### 2026-10-21 — One trunk per parent, shared drops, Tree by default

**What changed:** a parent's tree lines (and a lookup's lines) share one trunk a quarter in from its left edge instead of a lane each. Cross links from one parent into one wrapped column share a lane, a street and a drop placed a label run left of the column, with each label on its run into its child; the parent with the most lines into a column owns its drop, which starts left of the other parents' columns too and moves left past boxes; with no clear place several lines keep it while a single line, or a single line whose drop another street would cross, takes its own slot, and with no room right of the parent the column is not shared. Wrapped columns leave room for those labels. A tree line stays a tree line only with room right of its trunk for the child's columns from above. A child's approach columns from above and from below each move into the nearest gap clear of boxes, those from above staying right of the child's trunks and shared drops; when none is clear, a line from above jogs through a clear column, no further right than 12 px past both the child and its own lane, and across above the child, never down another jog's drop. A first visit opens in Tree; a browser that already saved an arrangement without a stored mode keeps Organic, the layout it was saved in.

**Why:** user feedback on the drawn diagram: labels of lines into a wrapped column printed over each other on adjacent streets, a parent's lanes packed into tight parallel verticals, a dragged child pulled its approach column behind other boxes, and the user wanted the fewer, shared lines of IDEF1X tools and Tree as the first view.

**Superseded:** tree lanes fanned across the left half of the parent's bottom edge, one per line, 6 px apart; every cross link had its own lane, street and approach column 12 px left of its child; a missing stored mode read as Organic.

### 2026-10-20 — Correction: checkpoints table

**What changed:** added the `## Checkpoints` table; the contract it lists was already in the success criteria.

**Why:** `atomic validate spec` failed S5 (missing `## Checkpoints`).

### 2026-10-20 — Wide parents wrap into columns

**What changed:** a parent whose children would run past the column keeps those that fit and wraps the rest into columns to its right, each starting one row below it, with cross links. Children wrap only when a fresh column has room for two of the parent's child rows. A subtype joiner goes first among its siblings when they wrap. A lookup's line into a table in a wrapped column is a cross link.

**Why:** split-off subtrees were ordered as trees of their own and could land above or left of their parent, so the line between them ran up (on orm-pure, `Identity` sat 316 px above `Party`).

**Superseded:** a tree taller than a column became trees of their own, and a joiner shed the members that did not fit.
