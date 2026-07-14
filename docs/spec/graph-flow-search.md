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
- SC5 — Both bars: with the description toggle off, a term that appears only in a node's markdown body does not match; toggling it on makes it match. The control is a toggle switch (`role="switch"`, `aria-checked`, visible label "Include descriptions"), not a bare button. Title fields per kind: entity `id`; process `id`/`label`/`dottedNumber`; external `id`/`label`; store `name`/`displayName`; diagram `id`/`title`. Body fields: entity `bodyHtml` stripped of tags; flow nodes `body`.
- SC6 — Flows: the matcher walks every non-synthetic diagram recursively (sub-DFDs included; `SYNTHETIC_DIAGRAM_IDS` excluded). The dropdown lists each match with kind, label, dotted number (processes), and owning diagram title, grouped by diagram, display-capped with a `+N more` overflow line. Clicking a row (or pressing Enter for the first row) calls `selectDiagramById(diagramId)` and lands on that diagram — including a sub-DFD with its full breadcrumb path.
- SC7 — Flows: in the rendered diagram, nodes whose base token (role-split `--src`/`--snk`/`--read`/`--write` suffixes stripped) is in the match set keep full opacity; all others render at `DIM_OPACITY`. An edge stays undimmed when either endpoint matches. While a pointer hover is active the existing hover dim wins; on hover exit the search dim returns.
- SC8 — Two routes to `{ type: 'search' }`: `/` after the editable guard and gated off ctrl/meta/alt (typing `/` inside any input/textarea/contenteditable/modal inserts the character), and Cmd/Ctrl+K resolved BEFORE the editable guard (like the zoom chords) so it focuses search even while typing elsewhere, with the browser default prevented. Both work on all three views; the shell focuses the active view's search input (graph bar, flow bar, or the Dictionary's existing input via `DictionaryViewHandle.focusSearch()`). Escape in a search input clears the term and blurs.
- SC9 — Search state never enters the model, the layout fingerprint, `layout-store` saved positions, the URL hash, or the static export payload.
- SC10 — `bun run test` and `bunx tsc --noEmit` exit 0: all existing checks stay green and the new checks pass. New Playwright checks follow the existing skip-if-dist-absent pattern.
- SC11 — Bundle-only: no file under `src/server/` or `src/generators/` changes, and the search code paths perform no network requests — live serve and static export share the identical code path by construction.
- SC12 — Chrome non-collision on the Flows view: the search bar never overlaps the DFD breadcrumb chips or the diagram nav card, at any breadcrumb depth (proven against the 4-level `test/fixtures/flows-leveling` fixture) — same standing as the graph view's banner non-collision.


## Checkpoints


| # | Checkpoint | Files/areas | Verifies |
|---|------------|-------------|----------|
| CP1 | Pure matchers: per-kind title/body match functions taking `includeBody`, plus the recursive cross-diagram flow walker returning grouped results with tokens | `src/app/logic/search.ts`, `test/checks/test-viewer-search.ts` | Unit check green; SC5/SC6 matcher halves proven on fixture data |
| CP2 | `SearchBar` component + shell graph wiring: search state, match computation, `searchMatches` prop into `GraphView`, `search-match`/`search-dim` styles, count readout, Enter cycle, `.viewer-search-bar` CSS | `src/app/components/ui/SearchBar.tsx`, `src/app/App.tsx`, `src/app/views/graph/GraphView.tsx`, `src/app/views/graph/styles.ts`, `src/app/styles.css`, `test/checks/test-graph-search.ts`, `test/visual/test-graph-search.ts` | SC1–SC4 asserted in the Playwright check against `models/key-inherited`; SC9 asserted there too (URL hash and persisted layout positions unchanged while searching) |
| CP3 | Flow wiring: shell flow-search state, `searchTokens` threaded `FlowsView` → `FlowDiagramSvg` opacity rules, results dropdown + `selectDiagramById` navigation | `src/app/App.tsx`, `src/app/views/flow/FlowsView.tsx`, `src/flow-view/FlowDiagramSvg.tsx`, `src/app/components/flow/FlowSearchResults.tsx`, `src/app/styles.css`, `test/checks/test-flow-search.ts`, `test/visual/test-flow-search.ts` | SC6/SC7 asserted in the Playwright check, including a sub-DFD navigation; SC9's flow half asserted there (hash gains no search param; flow layout store unchanged) |
| CP4 | `/` shortcut end-to-end: resolver action, `useKeyboardShortcuts` `onSearch`, shell focus routing, `DictionaryViewHandle.focusSearch()`, HelpModal search + `/` rows, guide/feature-map rows, keymap amendments to the shortcut and help-overlay specs (the repo requires those specs stay current with the keymap) | `src/app/logic/shortcuts.ts`, `src/app/hooks/useKeyboardShortcuts.ts`, `src/app/App.tsx`, `src/app/views/dict/DictionaryView.tsx`, `src/app/components/ui/HelpModal.tsx`, `test/checks/test-shortcuts.ts`, `docs/guides/commands.md`, `docs/spec/keyboard-nav-shortcuts.md`, `docs/spec/help-overlay.md`, `CLAUDE.md` | SC8 resolver cases green in `test-shortcuts.ts`; docs rows present; both keymap specs amended with change-log entries |
| CP5 | Search-bar refinement: the description toggle becomes a labeled switch, the bar and dropdown get a visual tightening pass within the existing design language (theme tokens, radii, frosted chrome, focus ring, switch styling, count treatment, row hover states — verified by screenshots in both themes), Cmd/Ctrl+K joins `/` as a search-focus chord on all views, and the flow bar no longer collides with the DFD breadcrumb chrome | `src/app/components/ui/SearchBar.tsx`, `src/app/styles.css`, `src/app/logic/shortcuts.ts`, `src/app/components/ui/HelpModal.tsx`, `test/checks/test-shortcuts.ts`, `test/checks/test-graph-search.ts`, `test/checks/test-flow-search.ts`, `docs/guides/commands.md`, `docs/spec/keyboard-nav-shortcuts.md`, `CLAUDE.md` | SC5's switch semantics + SC8's Cmd/Ctrl+K cases asserted in the checks; SC12's non-collision asserted against the deep-nesting fixture; both-theme screenshots reviewed; docs rows updated |


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


### 2026-07-14 — CP5: switch control, visual tightening, Cmd/Ctrl+K

**What changed:** SC5's body toggle is now contracted as a labeled toggle switch ("Include descriptions", `role="switch"`); SC8 gains Cmd/Ctrl+K resolved before the editable guard on all views; new SC12 pins flow-view chrome non-collision (search bar vs breadcrumb chips / nav card); new CP5 covers all of it plus a visual tightening pass on the bar and dropdown.

**Why:** user feedback on the live branch — the bare "Body" button was unclear, the bar design needed polish, Cmd/Ctrl+K is the expected search chord, and the flow bar covered the DFD breadcrumbs.

**Superseded:** the body control as a plain pill button labeled "Body"; `/` as the only search-focus shortcut; the flow bar's position being unconstrained relative to the breadcrumb chrome.

### 2026-07-14 — Correction: checkpoint-table column schema

**What changed:** The Checkpoints table's columns were restructured from `# | Scope | Proof` to the validator-required `# | Checkpoint | Files/areas | Verifies`. Content unchanged.

**Why:** `atomic validate spec` (run at the finish-line verification gate) failed S5 on the column schema; the contract itself was already current.

### 2026-07-14 — CP4 covers the keymap spec surfaces

**What changed:** CP4's scope, proof, and the change tree now include amendments to `docs/spec/keyboard-nav-shortcuts.md` and `docs/spec/help-overlay.md`, and the `CLAUDE.md` keyboard-shortcuts row's key list.

**Why:** the repo's shortcut-key convention (project signals, cross-cutting section) requires every new key to update the keymap spec, the help-overlay spec, and the shell wiring surfaces together; the initial change tree missed the two spec files.

### 2026-07-14 — Initial spec

**What changed:** Initial contract for title-first search on the Graph and Flows views with an opt-in body toggle, cross-diagram flow results, and the `/` focus shortcut.

**Why:** Neither view is searchable; users cannot find entities or processes on large models. Issue #18 (graph half) plus the flows gap raised alongside it.


## Implementation log

### shipped — 2026-07-14

Built across 4 iterations of the /autopilot subagent loop. Commits (chronological):

- `196c214` — design doc + spec
- `82d1c84` — CP1 pure title/body matchers + cross-diagram flow walker (+12-assertion unit check)
- `ffdf70d` — CP2 graph search bar: dim/highlight classes, count, Enter cycling, banner offset (+26-assertion Playwright check, visual)
- `e41a241` — spec amendment: CP4 covers the keymap spec surfaces
- `3c4d520` — CP3 flow cross-diagram search: results dropdown, token dimming, live renderer updates (+25-assertion Playwright check, visual)
- `de396ab` — CP4 `/` shortcut + help overlay + guide/keymap-spec/feature-map rows
- `8afa0bc` — spec correction: validator column schema for the checkpoints table

**Out-of-scope work performed during this build:**

- none

**Unforeseens — surprises that emerged during implementation:**

- Global error banner (z-index 200) fully occluded the search bar on error-bearing models — fixed with a measured `--search-bar-top` offset plus a true-positive-proven regression check against `models/broken-demo`.
- The `data-token` DOM attribute stamps externals as the bare id while every other kind is prefixed — search tokens therefore mirror the layout `node.id` scheme instead; recorded on the token type's doc comment.
- The repo carries a systemic pre-existing typecheck debt (cytoscape `Core` typing, ~640 instances; CI runs typecheck `continue-on-error`) — the gate used throughout was "no new error categories," verified per iteration.

**Deferred items still open:**

- none — the FOLLOWUPS ledger closed empty (F-1 folded into CP3).
