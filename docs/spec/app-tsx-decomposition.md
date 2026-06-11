# Spec: App.tsx decomposition

## Goal

Decompose `src/App.tsx` (5514 lines) into a layered `src/app/` tree with a strict downward dependency rule: shell → views → domain components → ui primitives → pure logic/dom. Behavior-neutral relocation first; view extraction and twin merges as separate screenshot-gated phases.

## Non-goals

- Splitting `src/styles.css` (2161L) — cascade/theme-var order is behavior-visible; separate follow-up.
- Moving already-factored modules (`hash-router.ts`, `markers.ts`, `wrap-label.ts`, `layout-store.ts`, `layout-fingerprint.ts`, `model-index.ts`) — correctly placed; moving churns `server.ts`/`generators/` imports for no gain.
- Touching `src/flow-view/` (SVG renderer) — already its own module.
- Refactoring `FlowDiagramSvg.tsx` (1422L) — out of scope; own follow-up.
- Any rendering or behavior change in P1. Zero visual diff is the P1 contract.

## Success criteria

1. `bun run typecheck` introduces no new errors after any checkpoint. Baseline: 434 pre-existing errors at branch point `b919b37` (115 in `src/App.tsx`; CI runs typecheck `continue-on-error: true`). Gate per checkpoint: total error count ≤ baseline; relocated `App.tsx` errors may move files but not multiply.
2. `bun run test` (54 check scripts) exits 0 after every checkpoint.
3. `bun run build:bundle` succeeds after every checkpoint.
4. `src/main.tsx` imports from `./app/App` without breakage.
5. P1 produces zero visual diff — confirmed by manual runs of the CP18/CP22/CP23/CP3/CP13/CP21 visual test scripts (`test/visual/`, Playwright, not run by `bun run test` or CI).
6. Each P1 checkpoint: no logic changes, no prop renames, no behavior deltas — only file-moves and import-path updates.
7. After P1-1: `src/App.tsx` is gone; shell lives at `src/app/App.tsx`; `src/main.tsx` imports `./app/App`. After P1-9: `src/app/App.tsx` contains only the `App()` shell function, `FlowSurface`, `initFlowGraphCore`, and the cy-init effect; all other declarations have moved into the target tree.
8. P2a GraphView/FlowsView extraction: CP18 (`test-cp18-navigator-crash.ts`), CP22 (`test-cp22-zoom-control.ts`), CP23 (`test-cp23-flow-zoom-control.ts`) visual tests pass after extraction.
9. P2b twin merges: before/after screenshot pair (Playwright) for each merged component proves rendered output is identical.
10. After P2c: `src/app/App.tsx` contains only state declarations, the view switch, modal hosting, and top-level composition; `useModelData.ts`, `useHashRoute.ts`, `useThemeMode.ts` live in `src/app/hooks/` and `FabMenu.tsx` in `src/app/components/ui/`.

## Approaches

| # | Approach | Pros | Cons |
|---|----------|------|------|
| A | Layer-first only (`components/`, `logic/`, `styles/` flat) | familiar React convention | hides subject duplication; domain edges invisible |
| B | Feature-first by view (`graph/`, `dict/`, `flow/` each self-contained) | matches hash-router vocabulary | dict↔flow shared components (`IoTable`, `ProcessesSection`, examples) have no home; forces false ownership |
| C | **Hybrid: layers + subject-grouped domain components** | duplication colocated and visible; shared components have a true home; dependency rule enforceable by directory | one more level of nesting |
| D | Single-pass restructure + dedupe + view extraction in one PR | one review | cannot attribute screenshot regressions to move vs redesign |

## Recommendation

**C, phased.** The dependency map shows `FlowIoTable` consumed by `DictProcessSection` (CP25/26) and `ProcessesSection` consumed by `SelectedEntityModal` and `FlowNodeModal` (CP21) — these cut across views, so view-first (B) misfiled them. Table twins (`ColumnsTable`/`DictColumnsTable`, etc.) confirm subject is the reusable unit. D is rejected: each extraction must be behavior-neutral and screenshot-verified, requiring move and redesign in separate diffs.

## Layer model

Dependency direction is always downward:

```
shell (App.tsx)
  └── views/ (GraphView · DictionaryView · FlowsView)
        └── components/ by subject (entity · process · flow-node · findings)
              └── components/ui/ (Modal · ZoomControl)
                    └── logic/ (pure) + dom/ (imperative glue)
```

| Layer | Contents | Test |
|-------|----------|------|
| logic | search matchers, dotted sort, doc-resolver, finding-rows, color math, `buildAllFlowNodeIds` (pure) | framework-free, `bun test`-able |
| dom | `resolveBodyClick`, `upgradeMissingLinksInContainer` (DOM mutation), `applyThemeCssVars` | DOM, no React |
| ui | `Modal`, `ZoomControl` | React, domain-blind |
| domain components | subject cards/tables/modals (entity, process, flow-node, findings) | React, view-blind |
| views | GraphView (cy lifecycle), DictionaryView, FlowsView (FlowSurface host) | own renderer lifecycle + view-local controls |
| shell | App: state, SSE, routing, theme, FAB | composition only |

## Target tree

```
src/app/
├── App.tsx                    # shell (moved from src/App.tsx)
├── globals.d.ts               # window.__MODEL__ / __FLOW_MODEL__ / etc. declarations
├── logic/
│   ├── color.ts               # blendHex, pastel, lighten, hexToRgba  [App.tsx:419–469]
│   ├── search.ts              # nodeMatchesSearch, processMatchesSearch, externalMatchesSearch,
│   │                          #   storeMatchesSearch, sortGroupNodes, parseDottedNumber,
│   │                          #   compareDottedProcesses  [App.tsx:1760–1820, 2203–2250, 2415–2435]
│   ├── doc-resolver.ts        # splitDocToken, buildFlowDocResolver, FlowDoc types  [App.tsx:527–664]
│   ├── finding-rows.ts        # FindingRow type, buildFindingRows  [App.tsx:3364–3409]
│   └── flow-node-ids.ts       # buildAllFlowNodeIds (pure)  [App.tsx:2437–2461]
├── dom/
│   ├── body-links.ts          # resolveBodyClick, upgradeMissingLinksInContainer  [App.tsx:2596–2654]
│   └── theme-css-vars.ts      # applyThemeCssVars  [App.tsx:364–418]
├── components/
│   ├── ui/
│   │   ├── Modal.tsx          # [App.tsx:665–704]
│   │   ├── ZoomControl.tsx    # ZoomControlProps, ZoomControl  [App.tsx:3690–3753]
│   │   └── FabMenu.tsx        # per-view FAB menu lists (~200L) — extracted in P2c
│   ├── entity/
│   │   ├── ClassificationBadge.tsx    # KNOWN_CLASSIFICATIONS, DictClassificationBadge  [App.tsx:1817–1845]
│   │   ├── ColumnsTable.tsx           # modal flavor  [App.tsx:1528–1600]
│   │   ├── DictColumnsTable.tsx       # dict flavor  [App.tsx:1846–1930]  ← twin, colocated P1, merged P2b
│   │   ├── ChildrenTable.tsx          # modal flavor  [App.tsx:1601–1641]
│   │   ├── DictRelationshipsTable.tsx # dict flavor  [App.tsx:1931–1994]  ← twin
│   │   ├── ExamplesAccordion.tsx      # modal flavor  [App.tsx:1642–1690]
│   │   ├── DictExamplesAccordion.tsx  # dict flavor  [App.tsx:1995–2031]  ← twin
│   │   ├── EntityCard.tsx             # was DictEntitySection  [App.tsx:2032–2161]
│   │   └── EntityModal.tsx            # was SelectedEntityModal  [App.tsx:1369–1485]
│   ├── process/
│   │   ├── KindMarker.tsx             # FLOW_KIND_MARKERS, FlowKindMarker  [App.tsx:2251–2279]
│   │   ├── IoTable.tsx                # FlowIoTable  [App.tsx:2280–2414]
│   │   ├── ProcessExamples.tsx        # FlowProcessExamplesSection  [App.tsx:1691–1759]
│   │   ├── ProcessCard.tsx            # was DictProcessSection  [App.tsx:2462–2547]
│   │   ├── ProcessesTable.tsx         # DictProcessesTable  [App.tsx:2162–2202]
│   │   └── ProcessesSection.tsx       # cross-ref table  [App.tsx:1486–1527]
│   ├── flow-node/
│   │   ├── ExternalCard.tsx           # was DictExternalSection  [App.tsx:2548–2570]
│   │   ├── StoreCard.tsx              # was DictStoreSection  [App.tsx:2571–2595]
│   │   ├── FlowNodeModal.tsx          # [App.tsx:705–808]
│   │   └── FlowDocModal.tsx           # [App.tsx:809–847]
│   └── findings/
│       └── FindingsPanel.tsx          # FindingsPanel  [App.tsx:3410–3496]
├── hooks/
│   ├── useModelData.ts    # SSE + model/flow fetch + findings state (~150L)
│   ├── useHashRoute.ts    # hash-router read/write, back/forward restore (~100L)
│   └── useThemeMode.ts    # theme-mode detection + applyThemeCssVars effect (~60L)
├── views/
│   ├── graph/
│   │   ├── organic-layout.ts          # fanSubtypeClusters, deoverlapNodes, separateClusterFans,
│   │   │                              #   separateLeafFan, decollinearNodes, arrangeOrganic,
│   │   │                              #   organicIters + ELK tier constants  [App.tsx:48–281]
│   │   ├── styles.ts                  # buildStyles  [App.tsx:1224–1368]
│   │   ├── navigator.ts               # NavigatorInstance, mountNavigator, teardownNavigator  [App.tsx:282–363]
│   │   └── GraphView.tsx              # P2a: cy-init host (shell retains in P1)
│   ├── dict/
│   │   └── DictionaryView.tsx         # DictionaryView  [App.tsx:2655–3363]
│   └── flow/
│       ├── FlowsView.tsx              # P2a: FlowSurface + initFlowGraphCore host (shell retains in P1)
│       └── LegendModal.tsx            # LegendModal  [App.tsx:3497–3689]
```

`src/main.tsx` import updates to `./app/App`. `src/index.html` unchanged.

## Checkpoints

All P1 checkpoints: `atomic-builder`. Zero behavior change. Twins are colocated — NOT merged. `App.tsx` keeps `FlowSurface`, `initFlowGraphCore`, `DictionaryView` internals, and the full `App()` shell until P2a/P2b.

### P1 — Evacuation (moves + renames only)

¹ `bun run test` includes `test/checks/test-findings-panel.ts` which requires a Playwright/browser env; run full `bun run test` locally when Playwright is available.

| CP | Name | Files / areas | Agent | Est. files | Verifies |
|----|------|---------------|-------|-----------|---------|
| P1-1 | Scaffold + window globals | Create `src/app/` skeleton dirs; move `src/App.tsx` → `src/app/App.tsx`; update `src/main.tsx` import; add `src/app/globals.d.ts` with `window.__MODEL__`, `window.__FLOW_MODEL__`, `window.__FLOW_LAYOUT_KEYS__`, `window.__LAYOUT_KEY__`, `window.__THEME_MODE__`, `window.__IGNATIUS_MODE__`, `window.__IGNATIUS_PERF__` declarations | atomic-builder | 3 | `bun run typecheck`, `bun run build:bundle` ¹ |
| P1-2 | Logic layer | Extract `color.ts`, `search.ts`, `doc-resolver.ts`, `finding-rows.ts` into `src/app/logic/`; update imports in `App.tsx` | atomic-builder | 5 | `bun run typecheck`, `bun run test`, `bun run build:bundle` |
| P1-3 | DOM + logic helpers | Extract `applyThemeCssVars` → `src/app/dom/theme-css-vars.ts`; extract `resolveBodyClick`, `upgradeMissingLinksInContainer` → `src/app/dom/body-links.ts`; extract `buildAllFlowNodeIds` → `src/app/logic/flow-node-ids.ts`; update imports | atomic-builder | 4 | `bun run typecheck`, `bun run test`, `bun run build:bundle` |
| P1-4 | Graph helpers | Extract `organic-layout.ts` (ELK tier constants + all 7 layout functions, lines 48–281), `navigator.ts` (lines 282–363), `styles.ts` (lines 1224–1368) into `src/app/views/graph/`; update imports in `App.tsx` | atomic-builder | 4 | `bun run typecheck`, `bun run test`, `bun run build:bundle` |
| P1-5 | UI primitives | Extract `Modal` (lines 665–704), `ZoomControl` + `ZoomControlProps` (lines 3690–3753) into `src/app/components/ui/`; update imports | atomic-builder | 3 | `bun run typecheck`, `bun run test`, `bun run build:bundle` |
| P1-6 | Process + flow-node components | Extract `KindMarker`, `IoTable`, `ProcessExamples`, `ProcessCard`, `ProcessesTable`, `ProcessesSection` into `src/app/components/process/`; extract `FlowNodeModal`, `FlowDocModal`, `ExternalCard`, `StoreCard` into `src/app/components/flow-node/`; update imports | atomic-builder | 7 | `bun run typecheck`, `bun run test`, `bun run build:bundle`; `bun test/visual/test-cp13-external-store-parity.ts`, `bun test/visual/test-cp21-flow-node-processes.ts` |
| P1-7 | Entity components | Extract `ClassificationBadge`, `ColumnsTable`, `DictColumnsTable`, `ChildrenTable`, `DictRelationshipsTable`, `ExamplesAccordion`, `DictExamplesAccordion`, `EntityCard`, `EntityModal` into `src/app/components/entity/`; update imports | atomic-builder | 10 | `bun run typecheck`, `bun run test`, `bun run build:bundle`; `bun test/visual/test-cp13-external-store-parity.ts` |
| P1-8 | Findings + LegendModal | Extract `FindingsPanel` → `src/app/components/findings/FindingsPanel.tsx`; extract `LegendModal` → `src/app/views/flow/LegendModal.tsx`; update imports | atomic-builder | 3 | `bun run typecheck`, `bun run test`, `bun run build:bundle`; `bun test/visual/test-cp15-kind-colors.ts` |
| P1-9 | DictionaryView evacuation | Move `DictionaryView` (lines 2655–3363) into `src/app/views/dict/DictionaryView.tsx`; update imports in `App.tsx` | atomic-builder | 2 | `bun run typecheck`, `bun run test`, `bun run build:bundle`; `bun test/visual/test-cp24-sidebar-nesting.ts`, `bun test/visual/test-cp25-dd-endpoint-links.ts`, `bun test/visual/test-cp26-process-examples-in-dd.ts` |

### P2a — View extraction (ref ownership changes)

| CP | Name | Files / areas | Agent | Est. files | Verifies |
|----|------|---------------|-------|-----------|---------|
| P2a-1 | FlowsView extraction | Move `FlowSurface` + `initFlowGraphCore` (lines 848–1223) and all flow-view refs/effects from `App()` into `src/app/views/flow/FlowsView.tsx`; narrow the shell↔view contract to a typed handle interface | atomic-surgeon | 3 | `bun run typecheck`, `bun run test`, `bun run build:bundle`; `bun test/visual/test-cp18-navigator-crash.ts`, `bun test/visual/test-cp23-flow-zoom-control.ts`, `bun test/visual/test-cp3-dfd-url-navigability.ts` |
| P2a-2 | GraphView extraction | Move cy-init effect + all cy refs from `App()` into `src/app/views/graph/GraphView.tsx`; narrow the shell↔view contract to a typed handle interface | atomic-surgeon | 2 | `bun run typecheck`, `bun run test`, `bun run build:bundle`; `bun test/visual/test-cp18-navigator-crash.ts`, `bun test/visual/test-cp22-zoom-control.ts`, `bun test/visual/test-cp2-preset-layout.ts` |

### P2b — Twin merges (rendered output changes, screenshot-gated)

| CP | Name | Files / areas | Agent | Est. files | Verifies |
|----|------|---------------|-------|-----------|---------|
| P2b-1 | Columns twins merge | Unify `ColumnsTable` + `DictColumnsTable` into a single component with a mode/variant prop; update all callers | atomic-surgeon | 3 | `bun run typecheck`, `bun run test`, `bun run build:bundle`; before/after Playwright screenshot pair |
| P2b-2 | Relationships twins merge | Unify `ChildrenTable` + `DictRelationshipsTable`; update callers | atomic-surgeon | 3 | `bun run typecheck`, `bun run test`, `bun run build:bundle`; before/after Playwright screenshot pair |
| P2b-3 | Examples twins merge | Unify `ExamplesAccordion` + `DictExamplesAccordion`; update callers | atomic-surgeon | 3 | `bun run typecheck`, `bun run test`, `bun run build:bundle`; before/after Playwright screenshot pair |

### P2c — Shell slimming (hooks + FabMenu)

Same risk class as P2a: ownership moves, screenshot-gated.

| CP | Name | Files / areas | Agent | Est. files | Verifies |
|----|------|---------------|-------|-----------|---------|
| P2c-1 | Extract shell hooks | Extract SSE + model/flow fetch + findings state into `src/app/hooks/useModelData.ts` (~150L); extract hash-router read/write + back/forward restore into `src/app/hooks/useHashRoute.ts` (~100L); extract theme-mode detection + `applyThemeCssVars` effect into `src/app/hooks/useThemeMode.ts` (~60L); update `App()` to call all three hooks | atomic-surgeon | 4 | `bun run typecheck`, `bun run test`, `bun run build:bundle`; `bun test/visual/test-cp3-dfd-url-navigability.ts` (hash-route restoration) |
| P2c-2 | Extract FabMenu | Move per-view FAB menu item lists + render logic from `App()` into `src/app/components/ui/FabMenu.tsx` (~200L); `App()` renders `<FabMenu view={activeView} … />`; update imports | atomic-surgeon | 2 | `bun run typecheck`, `bun run test`, `bun run build:bundle`; `bun test/visual/test-cp22-zoom-control.ts`, `bun test/visual/test-cp23-flow-zoom-control.ts` |

### P3 — Signals + docs refresh

| CP | Name | Files / areas | Agent | Est. files | Verifies |
|----|------|---------------|-------|-----------|---------|
| P3-1 | Signals refresh | Run `/refresh-signals` to update `.claude/project/signals.md` line-number citations pointing to `App.tsx`; update `CLAUDE.md` feature-map `src/App.tsx` references to the new paths | atomic-builder | 2 | `bun run typecheck`, `bun run test`, `bun run build:bundle` |
| P3-2 | Followup closure | Close `.claude/project/followups/app-tsx-decomposition.md` via `atomic followups close` | atomic-builder | 1 | followup status shows closed |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Upward imports — any lower layer (`logic/`, `dom/`, `ui/`) importing a higher layer (`components/`, `views/`, shell) | Low — direction is enforced by the layer model | Import-path review at each checkpoint's reviewer pass (TypeScript does not catch layering violations — a `logic/` file importing `views/` compiles fine); flag any upward import in review |
| P2a ref ownership split misses an imperative handle path (zoom, navigator) | Medium — CP18/CP22/CP23 cover the exact seams | Run all three visual tests immediately after P2a-1 and P2a-2 |
| P2b twin merges surface intentional rendering differences (column subsets, link behavior) | Medium | Capture before/after screenshot pair per merge; keep both deliberately if output differs |
| `buildAllFlowNodeIds` / `upgradeMissingLinksInContainer` are exported from `App.tsx` — consumers may import directly | Low — only `App.tsx` self-imports these today | Verify with `bun run typecheck` after P1-3 |
| `src/generators/app.ts` imports from `src/App.tsx` via bundle — broken if the file moves | None — generators import the compiled bundle, not source | Confirmed: `src/generators/embedded-bundle.ts` imports `dist/static/index.html` as a file ref |
| P2c `useHashRoute` extraction misses the back/forward DFD deep-link restore path (`selectDiagramById` on `hashchange`) | Medium — CP3 covers sub-DFD navigability | Run `bun test/visual/test-cp3-dfd-url-navigability.ts` (cases A–G2) immediately after P2c-1 |
| P2c FabMenu extraction drops a per-view menu item or its handler wiring | Low — item lists are static per view | CP22/CP23 visual tests cover graph + flow FAB items; manually verify dict-view FAB items after P2c-2 |

## Change log



### 2026-06-10 — Typecheck gate is baseline-relative

**What changed:** SC-1 restated from "typecheck exits 0" to "no new errors vs the 434-error baseline at `b919b37`".

**Why:** baseline verification in the worktree showed 434 pre-existing tsc errors (115 in `src/App.tsx`, plus `trash/`, `test/`); CI already runs typecheck `continue-on-error: true`. Exit-0 was unachievable without scope creep (see followup `parse-ts-preexisting-tsc-errors`).

**Superseded:** SC-1 "bun run typecheck exits 0 after every checkpoint."

## Implementation log

### shipped — 2026-06-10

Built across 19 iterations of /subagent-implementation on branch `app-tsx-decomposition`. Commits (chronological):

- `3090728` — P1-1 scaffold src/app/ + move shell
- `bc61899` — P1-2 logic layer
- `d96b062` — P1-3 dom helpers + flow-node-ids
- `575f2c6` — P1-4 graph helpers (organic-layout, navigator, styles)
- `6689673` — P1-5 ui primitives (Modal, ZoomControl)
- `efaa5f1` — P1-6 process + flow-node components (10 files)
- `09dfbc2` — P1-7 entity components (9 files, twins colocated)
- `acfcb25` — P1-8 FindingsPanel + LegendModal
- `5553078` — P1-9 DictionaryView evacuation (P1 done: 5514L → 2274L)
- `6b3da5e` — P2a-1 FlowsView + FlowsViewHandle
- `23204ef` — P2a-2 GraphView + GraphViewHandle (1 fix round: panelNavigate select-only)
- `a3bae06` — P2b-1 columns twins → variant component
- `25a19d8` — P2b-2 relationships twins → variant component
- `0a403e8` — P2b-3 examples twins → variant component
- `0d67f70` — P2c-1 shell hooks (useModelData, useHashRoute, useThemeMode)
- `e65216d` — P2c-2 FabMenu (shell at 483L)
- `161fd84` — P3-1 signals refresh
- `fdb9e7c` — P3-2 followup closure
- `e5f3a10` — symbol renames aligned to file names (ledger F-3)
- `4ab0a67` — polish batch: ledger F-2/F-4/F-5/F-6/F-7/F-8 (1 fix round on badge redraw)

**Out-of-scope work performed during this build:**
- Repaired `test/visual/test-cp10b-findings-panel.ts` — broken on main before this branch (stale `'Flows'` FAB label expectation vs actual "Data Flows").
- Fixed latent stale-warning-badge bug: badges now redraw on SSE finding changes via `redrawMarkersRef` (previously only on viewport/theme events).

**Unforeseens — surprises that emerged during implementation:**
- `bun run typecheck` baseline was 434 pre-existing errors, not 0 — SC-1 amended to a baseline-relative gate before iteration 1 (see Change log).
- Typecheck count drifts when implementers leave scratch `.ts` files in gitignored `tmp/` (tsconfig sweeps them) — gate refined to exclude `tmp/`.
- P2a-2 first pass changed findings-panel navigation semantics (opened the entity modal); caught by reviewer against base diff, fixed with a dedicated `onPanelSelect` callback.
- F-6 badge-redraw first pass appended without clearing (drawWarningBadges is append-only); fixed by routing through the cy-init `redrawMarkers` closure via ref.

**Deferred items still open:**
- none — all 8 FOLLOWUPS ledger items fixed or closed in-branch (F-1, F-3..F-8 fixed; F-4 resolved as optional-prop).
