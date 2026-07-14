# Spec: Graph and Flow search


## Goal


Search bars on the Graph (DG) and Flows (DFD) views. Matching is by title by default; a per-bar toggle opts into also matching markdown body text. Graph: matches highlight in place, non-matches dim, Enter pans through matches. Flows: matches are found across all diagrams including sub-DFDs, listed in a results dropdown that navigates to the owning diagram, where non-matches render dimmed. `/` focuses the active view's search input on all three views. Closes issue #18 (the graph half).


## Approach


Dim-don't-filter with pure matchers and per-view wiring, per `docs/design/graph-flow-search.md`.


## Non-goals


- Dictionary view search behavior is unchanged (still always matches columns and body). Its only change is a `focusSearch()` handle method for `/`.
- No column/type/predicate matching in Graph search.
- No fuzzy matching — case-insensitive substring on the trimmed term.
- No persistence of the search term (no hash param, no localStorage).
- No node removal, no layout mutation, no saved-position writes, no DFD auto-zoom/pan to a matched node.
- No server or generator changes (bundle-only parity is pinned as SC11).


## Success criteria


- SC1 — Graph: with a term entered, non-matching nodes carry cytoscape class `search-dim`, matching nodes carry `search-match` and full opacity; an edge stays undimmed only when both endpoints match. Clearing the term removes both classes from every element.
- SC2 — Graph: the bar shows a `n of N` count readout that tracks the match set.
- SC3 — Graph: Enter cycles matches in ascending id order (wrapping), each press centering + selecting the next match via the existing `navigateToEntity`.
- SC4 — Graph: hover dim, shift-lineage, background tap, layout-mode toggle, and an SSE model refresh none of them permanently clear active search dimming; after each, the search classes are present again without retyping.
- SC5 — Both bars: with the body toggle off, a term that appears only in a node's markdown body does not match; toggling body on makes it match. Title fields per kind: entity `id`; process `id`/`label`/`dottedNumber`; external `id`/`label`; store `name`/`displayName`; diagram `id`/`title`. Body fields: entity `bodyHtml` stripped of tags; flow nodes `body`.
- SC6 — Flows: the matcher walks every non-synthetic diagram recursively (sub-DFDs included; `SYNTHETIC_DIAGRAM_IDS` excluded). The dropdown lists each match with kind, label, dotted number (processes), and owning diagram title, grouped by diagram, display-capped with a `+N more` overflow line. Clicking a row (or pressing Enter for the first row) calls `selectDiagramById(diagramId)` and lands on that diagram — including a sub-DFD with its full breadcrumb path.
- SC7 — Flows: in the rendered diagram, nodes whose base token (role-split `--src`/`--snk`/`--read`/`--write` suffixes stripped) is in the match set keep full opacity; all others render at `DIM_OPACITY`. An edge stays undimmed when either endpoint matches. While a pointer hover is active the existing hover dim wins; on hover exit the search dim returns.
- SC8 — `/` resolves to `{ type: 'search' }` after the editable guard and gated off ctrl/meta/alt; the shell focuses the active view's search input (graph bar, flow bar, or the Dictionary's existing input via `DictionaryViewHandle.focusSearch()`). Typing `/` inside any input/textarea/contenteditable/modal inserts the character. Escape in a search input clears the term and blurs.
- SC9 — Search state never enters the model, the layout fingerprint, `layout-store` saved positions, the URL hash, or the static export payload.
- SC10 — `bun run test` and `bunx tsc --noEmit` exit 0: all existing checks stay green and the new checks pass. New Playwright checks follow the existing skip-if-dist-absent pattern.
- SC11 — Bundle-only: no file under `src/server/` or `src/generators/` changes, and the search code paths perform no network requests — live serve and static export share the identical code path by construction.


## Checkpoints


| # | Scope | Proof |
|---|-------|-------|
| CP1 | Pure matchers in `src/app/logic/search.ts`: per-kind title/body match functions taking `includeBody`, plus the recursive cross-diagram flow walker returning grouped results with tokens. Unit check `test/checks/test-viewer-search.ts`. | Unit check green; SC5/SC6 matcher halves proven on fixture data. |
| CP2 | `SearchBar` component + shell graph wiring: search state in `App.tsx`, match computation, `searchMatches` prop into `GraphView`, `search-match`/`search-dim` styles in `styles.ts`, count readout, Enter cycle, `.viewer-search-bar` CSS. Playwright check `test/checks/test-graph-search.ts` + visual `test/visual/test-graph-search.ts`. | SC1–SC4 asserted in the Playwright check against `models/key-inherited`; SC9 asserted there too (URL hash and persisted layout positions unchanged while searching). |
| CP3 | Flow wiring: shell flow-search state, `searchTokens` threaded `FlowsView` → `FlowDiagramSvg` opacity rules, results dropdown + `selectDiagramById` navigation. Playwright check `test/checks/test-flow-search.ts` + visual `test/visual/test-flow-search.ts`. | SC6/SC7 asserted in the Playwright check, including a sub-DFD navigation; SC9's flow half asserted there (hash gains no search param; flow layout store unchanged). |
| CP4 | `/` shortcut end-to-end: resolver action, `useKeyboardShortcuts` `onSearch`, shell focus routing, `DictionaryViewHandle.focusSearch()`, HelpModal search + `/` rows, `docs/guides/commands.md` shortcut row, `CLAUDE.md` feature-map row, and keymap amendments to `docs/spec/keyboard-nav-shortcuts.md` + `docs/spec/help-overlay.md` (the repo requires those specs stay current with the keymap). Extend `test/checks/test-shortcuts.ts`. | SC8 resolver cases green in `test-shortcuts.ts`; docs rows present; both keymap specs amended with change-log entries. |


## Change tree


```
M src/app/logic/search.ts                — title/body matchers + cross-diagram flow walker
A src/app/components/ui/SearchBar.tsx    — shared bar: input, body toggle, count, results slot
M src/app/App.tsx                        — per-view search state, match computation, bar mounting, / focus routing
M src/app/views/graph/GraphView.tsx      — searchMatches prop → search-match/search-dim class application
M src/app/views/graph/styles.ts          — search-match / search-dim cytoscape styles
M src/app/views/flow/FlowsView.tsx       — searchTokens prop threaded into svgProps
M src/flow-view/FlowDiagramSvg.tsx       — searchTokens folded into nodeOpacity/edgeOpacity
M src/app/styles.css                     — .viewer-search-bar + results dropdown styles (print-hidden)
M src/app/logic/shortcuts.ts             — '/' → { type: 'search' } action
M src/app/hooks/useKeyboardShortcuts.ts  — onSearch callback in KeyboardShortcutsConfig
M src/app/views/dict/DictionaryView.tsx  — DictionaryViewHandle.focusSearch()
M src/app/components/ui/HelpModal.tsx    — per-view search rows + '/' in Keyboard sections
A test/checks/test-viewer-search.ts      — unit: matchers + flow walker
M test/checks/test-shortcuts.ts          — '/' resolver cases
A test/checks/test-graph-search.ts       — Playwright: dim/highlight/count/Enter/body toggle/hover interplay
A test/checks/test-flow-search.ts        — Playwright: dropdown, sub-DFD navigation, in-diagram dim
A test/visual/test-graph-search.ts       — screenshot: graph search active
A test/visual/test-flow-search.ts        — screenshot: flow search active + dropdown
M docs/guides/commands.md                — '/' keyboard shortcut row
M docs/spec/keyboard-nav-shortcuts.md    — '/' in the keymap/resolver contract + change-log entry
M docs/spec/help-overlay.md              — search rows in the view branches + change-log entry
M CLAUDE.md                              — feature-map row (and '/' added to the keyboard-shortcuts row's key list)
```


## Outline


- `src/app/logic/search.ts`
  - `entityMatches` — entity title match, body opt-in
  - kind-specific flow node matchers — process/external/store title fields, body opt-in
  - `searchFlowDiagrams` — recursive non-synthetic diagram walk producing the result list
  - `FlowSearchResult` — one dropdown row: what matched, its token, and the owning diagram
- `src/app/components/ui/SearchBar.tsx`
  - `SearchBar` — debounced input (200 ms), body toggle (aria-pressed), count slot, Enter/Escape handling, results children slot, focusable via ref
- `src/app/App.tsx`
  - graph/flow search state pairs — term + includeBody per view, survive view switches
  - match-set memos — entity id set (graph), token set + result list (flow)
  - bar mounting — graph bar when view=graph, flow bar when view=flow and diagrams exist
  - `onSearch` routing — focus active view's input
- `src/app/views/graph/GraphView.tsx`
  - `searchMatches` prop — match set applied as classes; reapplied after model refresh and layout-mode change
- `src/app/views/graph/styles.ts`
  - `node.search-dim` / `edge.search-dim` — low opacity; `node.search-match` — outline emphasis, mode-aware
- `src/app/views/flow/FlowsView.tsx`
  - `searchTokens` prop — pass-through into `svgProps`
- `src/flow-view/FlowDiagramSvg.tsx`
  - `searchTokens?` prop — base-token comparison inside `nodeOpacity`/`edgeOpacity`, hover wins while active
- `src/app/logic/shortcuts.ts`
  - `'/'` case — `{ type: 'search' }`, after editable guard, no ctrl/meta/alt
- `src/app/hooks/useKeyboardShortcuts.ts`
  - `onSearch` — new config callback + dispatch case
- `src/app/views/dict/DictionaryView.tsx`
  - `focusSearch()` — handle method focusing the existing dict input
- `src/app/components/ui/HelpModal.tsx`
  - search rows — graph + flow branch terms; `/` row in each Keyboard section
- test files — one check per CP as listed in the change tree
- docs — `commands.md` shortcut row; `CLAUDE.md` feature-map row


## Flows


1. **Graph search** — user switches to Graph → types `party` in the bar → after debounce the shell computes matching entity ids → GraphView adds `search-match` to matches, `search-dim` to the rest, edges dim unless both endpoints match → bar shows `4 of 214` → user presses Enter repeatedly → each press centers + selects the next match in id order, wrapping → user clears the input (or presses Escape) → all search classes removed, count hidden.
2. **Body toggle** — user types a term that only appears in an entity's prose body → no match with the toggle off → user clicks the body toggle → the body text is included and the entity lights up; same mechanics on the flow bar.
3. **Flow search + navigate** — user switches to Flows → types `refund` → dropdown lists matches grouped by diagram (process `3.2 Process Refund` under "Order To Cash", diagram "Refund") → user clicks the process row → `selectDiagramById` opens the owning sub-DFD with its breadcrumb path → the diagram renders with non-matching nodes at `DIM_OPACITY` → hovering any node shows the normal hover focus; leaving restores the search dim.
4. **Keyboard focus** — user presses `/` on any view → the active view's search input focuses (Dictionary included) → typing goes into the input; pressing `/` while already typing in any editable inserts a literal `/`.


## Risks


| Risk | Likelihood | Mitigation |
|------|------------|------------|
| GraphView class lifecycle: hover tiers, lineage, relayout, and SSE refresh each manipulate element classes or rebuild elements, silently erasing search state | Medium | Dedicated `search-*` classes (never touched by `clearFocusTiers`) plus a reapply effect keyed on the match set and cy generation; SC4 pins the behavior under test |
| FlowDiagramSvg token mismatch: layout node ids carry role-split suffixes while match tokens do not | Medium | SC7 pins suffix-stripped base-token comparison; the unit walker test pins token construction |
| Playwright timing flakiness on the new checks | Low | Follow the existing check idioms (`test-keyboard-shortcuts.ts`, `test-dfd-edge-hover.ts`): explicit waits on rendered state, skip-if-dist-absent |


## Change log


### 2026-07-14 — CP4 covers the keymap spec surfaces

**What changed:** CP4's scope, proof, and the change tree now include amendments to `docs/spec/keyboard-nav-shortcuts.md` and `docs/spec/help-overlay.md`, and the `CLAUDE.md` keyboard-shortcuts row's key list.

**Why:** the repo's shortcut-key convention (project signals, cross-cutting section) requires every new key to update the keymap spec, the help-overlay spec, and the shell wiring surfaces together; the initial change tree missed the two spec files.

### 2026-07-14 — Initial spec

**What changed:** Initial contract for title-first search on the Graph and Flows views with an opt-in body toggle, cross-diagram flow results, and the `/` focus shortcut.

**Why:** Neither view is searchable; users cannot find entities or processes on large models. Issue #18 (graph half) plus the flows gap raised alongside it.
