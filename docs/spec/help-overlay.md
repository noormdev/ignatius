# Help overlay

## Goal

A view-aware orientation overlay ("what am I looking at?") opened by a top-bar
`?` button and the `?` key. Brief, one line per concept, tailored to the active
view (Graph / Dictionary / Flows). Distinct from the symbol `LegendModal`.

## Non-goals

- Replacing the `LegendModal` (symbol reference) — the help overlay points to it.
- A guided tour, tooltips, or first-run auto-open.
- Data-driven or per-model help content.
- A theme-toggle or other new shortcut beyond `?`.

## Approach

See `docs/design/help-overlay.md`. Chosen: a `HelpModal` on the shared `Modal`
primitive, view-switched on `ViewName`, with static term→description content; the
`?` key added to the existing pure `resolveShortcut` as a `help` action.

## Success criteria

- [x] `HelpModal` (`src/app/components/ui/HelpModal.tsx`) renders on the shared `Modal` primitive with `className="help-modal"`, switches body content on `view: ViewName`, and titles per view ("About the Graph/Dictionary/Flows").
- [x] Graph body covers: an ER-diagram intro, the five entity types (Independent, Dependent, Subtype, Associative, Classifier), how-to-explore (layouts, Shift+hover lineage, click/drag/zoom, search — term matching with a body-text toggle, Enter cycling through matches), and the key-inherited vs surrogate distinction.
- [x] Dictionary body covers: Read/Browse lenses, spotlight, Shift+hover lineage, search/focus.
- [x] Flows body covers: a DFD intro, symbols (process/store/external), drill-down + inspect, cross-diagram search (results grouped by diagram, non-matches dimmed in the rendered diagram).
- [x] A Keyboard section is present on every view and tailored to it (only the keys active there), including `/` to focus that view's search input; Graph and Flows footnote a pointer to the Legend.
- [x] A `?` top-bar button sits just left of the theme toggle (shared chrome, all views), opens the overlay, and is hidden in `@media print`.
- [x] `resolveShortcut` returns `{ type: 'help' }` for `?`: resolved after the editable guard, before the bare-key modifier guard (Shift is inherent), and gated off ctrl/meta/alt. `useKeyboardShortcuts` carries an `onHelp` callback; the shell opens the overlay.
- [x] Editable guard holds: typing `?` in the search box inserts a literal `?` and does NOT open the overlay.
- [x] Escape (via the `Modal` primitive) and backdrop click close it.
- [x] `test-shortcuts.ts` T16 covers `?` resolution (shift/bare/editable/modifier-gated); `test/checks/test-help-overlay.ts` is a CI Playwright check (button + `?` key + Escape + view-aware content + editable guard).
- [x] No new `tsc --noEmit` errors in touched files; `bun run test` exits 0; `bun run build:cli` succeeds.

## Checkpoints

| # | Checkpoint | Files/areas | Verifies |
|---|------------|-------------|----------|
| 1 | HelpModal component + view-aware content | `src/app/components/ui/HelpModal.tsx`, `src/app/styles.css` | renders per view; concise rows |
| 2 | `?` key + button wiring | `src/app/logic/shortcuts.ts`, `src/app/hooks/useKeyboardShortcuts.ts`, `src/app/App.tsx` | button + `?` open; editable guard |
| 3 | Tests + docs | `test/checks/test-shortcuts.ts`, `test/checks/test-help-overlay.ts`, `docs/**`, `CLAUDE.md` | T16 + browser check green; surfaces consistent |

## Risks

| Risk | L | Mitigation |
|------|---|------------|
| `?` swallowed by the bare-key modifier guard (needs Shift) | high | Resolve `?` before the modifier guard, after the editable guard; T16 asserts shift+`?` → help |
| Content drifts from actual app behavior | med | Terms mirror the LegendModal + signals vocabulary; concise rows reduce surface to maintain |
| Help vs Legend confusion | low | Distinct titles; Graph/Flows footnote points to the Legend for symbols |

## Change log

### 2026-07-14 — Search rows + `/` key added

**What changed:** the Graph and Flows "How to explore" sections each gained a Search row (Graph: term matching, body-text toggle, Enter cycling; Flows: cross-diagram results grouped by diagram, in-diagram dimming). Every view's Keyboard section now lists `/` — focus that view's search input.

**Why:** the graph-flow-search feature (`docs/spec/graph-flow-search.md`, SC8) adds search bars to Graph, Dictionary, and Flows with a shared `/` focus shortcut; the help overlay must describe what a first-time viewer sees, including the new search affordance.
