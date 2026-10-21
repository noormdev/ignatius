# Graph arrangement


## Goal


Hierarchical mode keeps each colour group in one block, a model edit keeps the user's arrangement, and the Graph view gains undo/redo, multi-node selection and moving, and hiding nodes from view.


## Non-goals


- Pinning nodes so a re-layout keeps them in place.
- Changing the organic layout below `ORGANIC_FALLBACK_THRESHOLD` (500 entities). At or above it organic mode already falls back to the layered path, so it gets the per-group blocks too.
- Undo history across page reloads.
- Hiding non-entity nodes (joiner diamonds, cluster boxes).


## Success criteria


- [x] Hierarchical layout (and the organic fallback at 500+ entities) runs ELK `layered` once per colour group on a headless mirror (`buildScratchCore(cy, true, hidden)`), orders the group blocks with `orderRegions` (a group others reference comes first; cycles broken by least unplaced incoming weight, then most outgoing, then id) and places them with `packRegions` (skyline, width for ~16:10, gap = layer spacing). Joiners go in their cluster's block; ungrouped nodes form one block.
- [x] `layout-store` entries carry an optional `hidden: string[]`; `save(key, positions, hidden = [])` omits it when empty; `hidden(key)` reads it; `previous(exceptKey, nodeIds)` returns, with its hidden list, the newest other entry whose shared ids are at least half of `nodeIds` and half of the entry's own entities; null for an empty key.
- [x] A load with no entry for its key and a `previous` entry applies those positions and hidden set, seats each node the entry lacks beside its placed neighbours (centroid, then the nearest clear ring spot; a row under the graph when it has none), saves under the new key, and runs no layout.
- [x] `createEditHistory(limit = 100)` in `graph-edits.ts`: `push(before)` clears redo; `undo(current)` / `redo(current)` swap snapshots; `canUndo` / `canRedo`. A snapshot holds positions, the hidden set, and the layout mode; restoring one whose mode differs reports it through `onLayoutModeChange`, which the shell stores in `ignatius-layout-mode`. Restoring re-places change-review ghosts.
- [x] A drag pushes the pre-drag snapshot once per gesture, only if a node moved. A multi-node drag is one undo step.
- [x] Reset layout and the layout-mode switch push the pre-layout snapshot (with the mode from before the switch) and save the result, hidden set included, instead of clearing the stored entry. Asked for before the first layout lands, they run after it.
- [x] An edit (a drag that moves a node, hide, show, redo) made while a Reset or mode switch is computing cancels that layout, so it never lands over the edit. A cancelled layout leaves no trace: the mode goes back to the one before it and its undo step is dropped. Undo during a pending layout cancels it and counts as that undo. A plain click does not cancel. Edits before the first layout lands are ignored. A second request while one is pending replaces it and keeps the first's undo step and earlier mode.
- [x] Select mode: panning off, `selectionType('additive')`; a click on a node toggles it and opens no modal. Shift+drag boxes in normal mode (cytoscape's default box selection). Focus tiers pin only when exactly one node is selected.
- [x] Right-click (mouse only; a two-finger touch tap is ignored) on an entity hides it, or the whole selection when it is part of one; `h` hides the selection. A hidden node has class `user-hidden` (`display: none`) and is unselected; a hover or pinned focus on it is cleared at once. A joiner whose members are all hidden is hidden too. Layouts exclude hidden nodes, those joiners, and clusters left empty; edge spans are graded over visible edges.
- [x] A node shown again keeps its spot unless that spot overlaps a visible node, in which case it is seated beside its neighbours.
- [x] Navigating to a hidden entity (search Enter, entity links, panel rows, `entity=` deep links) shows it first.
- [x] Shortcuts on the Graph, never while typing: `Cmd`/`Ctrl`+`Z` undo, `Cmd`/`Ctrl`+`Shift`+`Z` and `Ctrl`+`Y` redo (`Cmd`+`Y` is left to the browser), `s` select mode, `h` hide selection.
- [x] `GraphEditBar` above the zoom control, the same 130 px wide: undo and redo arrows (disabled when empty), the select-mode toggle (dashed box with pointer, `aria-pressed`), and a crossed-out eye with the hidden count (disabled at 0) that opens a "Hidden" popover: "Show all" in its header, an eye button per entity; the popover closes when its last entity is shown. Icons are Lucide stroke paths. Hidden in print and under 768px like the zoom control.
- [x] A selected entity carries a 3 px ring in the theme link blue (`semanticColors[mode].link`), offset 3 px from its border. Cluster frames and joiner diamonds are unselectable, so a box selection holds entities only.
- [x] Checks: `test-grouped-layered.ts` (incl. a headless `layoutByGroup` run), `test-graph-edits.ts`, `test-layout-store.ts` 7–8, `test-shortcuts.ts` T31–T32; Playwright `test/visual/test-graph-edits.ts`.


## Approach


Per-group layered layout packed into one picture, and an arrangement that carries over to the next layout key. See [`docs/design/graph-arrangement.md`](../design/graph-arrangement.md).


## Change tree


```
src/app/
├── App.tsx ................................ M  (graphEdits state, GraphEditBar, shortcut callbacks, stored mode on undo)
├── styles.css ............................. M  (.graph-edit-bar)
├── hooks/useKeyboardShortcuts.ts .......... M  (onUndo, onRedo, onToggleSelectMode, onHideSelection)
├── logic/shortcuts.ts ..................... M  (undo, redo, toggleSelectMode, hideSelection)
├── components/ui/
│   ├── GraphEditBar.tsx ................... A
│   └── HelpModal.tsx ...................... M  (move several, undo, hide rows; S, H, ⌘Z keys)
└── views/graph/
    ├── GraphView.tsx ...................... M  (carry-over, hidden set, history, select mode)
    ├── graph-edits.ts ..................... A  (history, snapshot, state, LayoutMode types)
    ├── grouped-layered.ts ................. A  (orderRegions, packRegions, layoutByGroup)
    ├── layout-store.ts .................... M  (hidden, previous)
    ├── organic-layout.ts .................. M  (buildScratchCore exclude, joiner region)
    └── styles.ts .......................... M  (node.user-hidden)
test/checks/
├── test-graph-edits.ts .................... A
├── test-grouped-layered.ts ................ A
├── test-layout-store.ts ................... M
└── test-shortcuts.ts ...................... M
test/visual/test-graph-edits.ts ............ A
docs/
├── design/
│   ├── graph-arrangement.md ............... A
│   └── graph-position-persistence.md ...... M  (pointer to graph-arrangement)
├── guides/commands.md ..................... M  (s, h, undo/redo keys)
├── spec/
│   ├── graph-arrangement.md ............... A
│   ├── graph-position-persistence.md ...... M  (carry-over, Reset saves)
│   ├── help-overlay.md .................... M  (new Graph rows and keys)
│   └── keyboard-nav-shortcuts.md .......... M  (s, h, undo/redo)
└── wiki/
    ├── feature-map.md ..................... M
    └── frontend.md ........................ M
```


## Outline


```
grouped-layered.ts
  orderRegions — group block order from cross-group FK weight
  packRegions — skyline placement of block boxes
  layoutByGroup — per-group ELK runs, then order and pack
graph-edits.ts
  USER_HIDDEN_CLASS — class on a hidden node
  GraphSnapshot — positions, hidden ids, layout mode
  LayoutMode — organic, hierarchical, or tree
  GraphEditState — what the edit bar draws
  createEditHistory — undo/redo stacks, discardLast
layout-store.ts
  hidden — stored hidden ids for a key
  previous — newest other entry sharing half of each side
GraphView.tsx
  GraphViewHandle — undo, redo, toggleSelectMode, hideSelection, showHidden
  snapshot / persist / reportEdits — state capture, save, shell report
  placeNewNodes — seat nodes beside placed neighbours
  cancelPendingRelayout — drop a pending relayout, restore its mode, discard its undo step
  readyForEdit — first layout landed; cancel any pending relayout
  relayout — Reset and mode switch, with the undo step
  hideNodes / showNodes / setSelectMode — the edits
GraphEditBar.tsx
  GraphEditBar — undo, redo, select toggle, hidden list
```


## Flows


**Hierarchical layout**

1. `runLayout('hierarchical')` builds a mirror with one compound per group, leaving out hidden nodes.
2. `layoutByGroup` runs ELK `layered` on each group, orders the blocks, packs them.
3. Positions are applied to the live graph; a newer layout run discards a stale result.

**Load after a model edit**

1. No entry for the new key; `previous` finds the entry from before the edit.
2. Its hidden set is applied, then its positions; nodes it lacks are seated beside their neighbours.
3. The result is saved under the new key.

**Hide and undo**

1. User right-clicks `User`; the pre-hide snapshot is pushed, `User` gets `user-hidden`, the bar shows "1 hidden".
2. User presses `Cmd`+`Z`; the snapshot is restored and the current state becomes redoable.
3. Each change saves positions and the hidden set under the current key.


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Another model shares half the table names both ways and lends its arrangement | low | Reset layout starts fresh; the carry-over records no undo step, so Reset is the escape |
| Long cross-group edges in hierarchical mode | med | Inherent to block packing; block order puts referenced groups first to shorten them |
| Many hidden nodes shown at once after a re-layout crowd one spot | low | Each is placed in turn against the already placed ones, so none overlap |


## Change log


### 2026-10-20 — Tree is a third layout mode

**What changed:** `LayoutMode` gains `tree` (see `docs/spec/graph-tree-layout.md`); a snapshot's mode may be any of the three.

**Why:** the Tree layout shipped.
