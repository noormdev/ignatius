# Graph and Flow search


## Problem


The Graph view (DG) and the Flows view (DFD) have no way to find a node by name. On a model with hundreds of entities the graph is a visual scan; in flows it is worse — only one diagram renders at a time, so a process buried in a sub-DFD is invisible until you drill into the right diagram by luck. The Dictionary view already has search-as-you-type; the other two views have nothing. Issue #18 tracks the graph half ("Searchable highlight of matching entities in the Graph view"); this design covers both views.


## Goals


- A search bar on the Graph view: type a term, non-matching entities dim, matching entities stay lit with a visible highlight, a count readout shows how many matched, Enter pans to each match in turn.
- A search bar on the Flows view: the term is matched across **all** diagrams including sub-DFDs; a results list shows every matching process, external, store, and diagram title with the diagram it lives in; clicking a result navigates to that diagram, where non-matches render dimmed.
- Matching is by **title** by default — entity id; process id, label, and dotted number; external id and label; store name and display name; diagram id and title. Ids are included because models are authored as files: users know entities and flows by slug as much as by display label. A per-bar **toggle switch labeled "Include descriptions"** opts into also matching the markdown body text — a switch with a descriptive label, not a terse button, because "Body" alone doesn't tell a user what it does.
- `/` focuses the active view's search input (all three views — the Dictionary's existing bar included).
- Everything is client-side: the feature works identically in `ignatius serve` and the static `export` HTML.


## Non-goals


- The Dictionary view's search behavior is unchanged (it continues to always match columns and body).
- No column, type, or predicate matching in the Graph search — title and body only. Columns can be added later if title+body proves insufficient.
- No fuzzy matching. Case-insensitive substring, same as the Dictionary.
- No search-term persistence (no URL hash param, no localStorage).
- Search never removes nodes from the canvas, never mutates layout or saved positions, and never auto-zooms the DFD to a node.


## Approach


**Dim, don't filter.** Matching nodes keep full opacity plus a highlight; everything else drops to low opacity. Removing non-matches from the canvas would re-layout the graph and destroy the user's spatial memory — the whole point of search-as-highlight is that matches pop *in place*. This mirrors the graph's existing focus-tier dimming and the DFD's hover dim, so the visual language is already established.

**Pure matchers, view-specific wiring.** The match logic lives in `src/app/logic/search.ts` next to the existing Dictionary matchers — new functions that take an `includeBody` flag, leaving the always-match-everything Dictionary helpers untouched. The shell (`App.tsx`) owns the search state per view (mirroring `dictSearchText`), computes the match set with the pure functions, and hands it to each view through its existing channel: a prop into `GraphView` (applied as cytoscape classes) and a prop threaded through `FlowsView` into `FlowDiagramSvg` (applied as node/edge opacity).

**One shared bar component.** A `SearchBar` UI component (input, body toggle, count, results slot) rendered by the shell for the graph and flow views — the same composition pattern as `ZoomControl`. It reuses the Dictionary bar's visual styling so all three views read as one system.

**Distinct graph classes.** The graph search uses its own `search-match` / `search-dim` cytoscape classes rather than reusing `.faded`. The hover focus tiers add and clear `.faded`/`.inherited-dim` aggressively (`clearFocusTiers` strips them on every mouseout); piggybacking on those classes would make hover permanently erase the search state. Separate classes make hover and search compose: hover tiers win transiently while the pointer is on a node, and the search dim is still there when the hover clears.

**Flow search is cross-diagram.** The DFD surface shows one diagram at a time, so in-diagram dimming alone cannot answer "where is Validate Payment?". The pure flow matcher walks every non-synthetic diagram recursively (the synthesized context/Level-1 diagrams are excluded, as the Dictionary sidebar already does — their nodes are copies of leaf-diagram nodes and would duplicate every result). Results are surfaced as a dropdown under the bar; a click routes through the existing `selectDiagramById`, which already reconstructs the full breadcrumb path into any sub-DFD.


## Per-view behavior


### Graph (DG)

- Term entered (debounced, like the Dictionary's 200 ms) → shell computes matched entity ids → `GraphView` adds `search-dim` to non-matching nodes and `search-match` to matches. Edges stay lit only when **both** endpoints match; every other edge dims.
- Count readout in the bar: `n of N`.
- Enter cycles through matches in id order via the existing `navigateToEntity` (center + select). No new navigation machinery.
- Hover, shift-lineage, background taps behave as today; they must not permanently clear search dimming. Clearing the term removes both classes everywhere.
- Search classes are ephemeral view state: they never enter the model, the layout fingerprint, saved positions, or the static export, and they are re-applied after SSE model refreshes and layout-mode switches.

### Flows (DFD)

- Term entered → shell computes matches across all non-synthetic diagrams: processes (id, label, dotted number), externals (id, label), stores (name, display name), and diagram titles. Body toggle adds each node's markdown body.
- Dropdown under the bar lists results grouped by diagram: kind marker, label, dotted number for processes, diagram title. Clicking a row calls `selectDiagramById(diagramId)`; a diagram-title row navigates to that diagram. Enter opens the first row — the keyboard path to the top result. The list is capped for display with a "+N more" overflow line.
- In the rendered diagram, nodes whose token is in the match set keep full opacity; others render at the existing `DIM_OPACITY`. Edges stay lit when **either** endpoint matches (a matched process's data flows are the information). Role-split layout copies (`--src`/`--snk`, `--read`/`--write` suffixes) match by their base token.
- Hover dim wins while hovering (unchanged behavior); releasing hover restores the search dim.
- The bar shares the top edge with the DFD breadcrumb chips and nav card; it must never overlap them, at any breadcrumb depth — the flow surface's chrome layout accounts for the bar the same way the graph surface accounts for the error banner.

### Keyboard

- `/` resolves to a new `{ type: 'search' }` shortcut action — after the editable guard (typing `/` in any input inserts the character), gated off ctrl/meta/alt. The shell focuses the active view's search input; for the Dictionary this reaches the existing bar through a new `focusSearch()` on `DictionaryViewHandle`.
- **Cmd/Ctrl+K** resolves to the same `{ type: 'search' }` action on all three views — resolved before the editable guard like the zoom chords, so it focuses the search bar even while typing elsewhere. This is the industry-standard search chord; `/` remains as the lightweight alternative.
- Escape in a search input clears the term and blurs.


## Alternatives considered


- **Filter (remove) non-matching nodes** — rejected: re-layout on every keystroke, destroys spatial memory, fights the position-persistence feature.
- **Reusing `.faded` for graph search dim** — rejected: `clearFocusTiers` strips `.faded` on every hover exit, so search state would be erased by incidental mouse movement.
- **One global search across views (command-palette style)** — rejected for now: each view has view-specific result semantics (pan vs navigate-and-dim), and the per-view bar matches the Dictionary precedent. A palette can compose on top later.
- **Flow search scoped to the visible diagram only** — rejected: does not solve "which diagram is it in?", which is the actual pain.


## References


- Issue #18 — Searchable highlight of matching entities in the Graph view (the DG half of this design).
- `docs/design/viewer-ux-polish.md` — deferred item #7 (graph search highlight) points at issue #18; this design supersedes that deferral.
- `docs/design/dd-spotlight-grid.md` — the Dictionary search bar this bar's styling mirrors.
