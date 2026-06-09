# Unified single-page app — implementation contract


Derived from `docs/design/unified-app.md`.


## Goal


Collapse the surfaces (ERD graph, data dictionary, flow viewer, flow process dictionary) into one React single-page app. `serve` renders one page with in-app **Graph / Dictionary / Flows** views switched without a reload; a single `export -o model.html` self-contained file replaces the `graph` / `dict` / `flow` subcommands. The **Dictionary is one inline, fully-laid-out, searchable page that fuses the entity data dictionary and the flow process dictionary** — entities, processes, externals, and data stores all rendered in full, filtered by a React search box, navigated by anchor links, **no dialogs**. The **rich entity dialog** (`SelectedEntityModal`) is reused for data entities wherever they appear: graph nodes (today) and **`db:` store nodes in DFDs** (new); every non-entity flow node keeps the plain markdown doc dialog. **Theme config, branding, and the FAB are shared app-level chrome that work across all three views — including DFDs (which are not themed today); branding + FAB use the ERD graph's version as canonical.** No router library, no second bundle.


## Non-goals


- No `react-router` or any routing dependency — extend `src/hash-router.ts`.
- No second compiled bundle.
- No redesign of the Cytoscape ERD renderer, the flow SVG renderer, validation rules, or the markdown/`ignatius.yml` authoring format.
- No redesign of the inline dictionary *format* — keep the current data-dictionary layout for entities and apply the same laid-out style to processes/externals/stores.


## Success criteria


- [ ] `ignatius serve <path>` serves one page at `/`; switching Graph ⇄ Dictionary ⇄ Flows causes **no full-page reload** (no second `GET /`), and the active view is reflected in `location.hash` (`#view=graph|dict|flow`). Back/forward and a deep link (`/#view=dict`) work.
- [ ] **Theme applies to all three views, including DFDs.** Selecting light/dark re-themes the Graph, the Dictionary, AND the flow viewer (the flow SVG stylesheet currently ignores theme config — it must consume the same theme vars). Verified by screenshot of a DFD in both dark and light.
- [ ] **Branding and the FAB are the ERD graph's version**, lifted to app-level shared chrome and shown consistently on all three views (not the flow viewer's separate `FlowChrome` variants).
- [ ] **Dictionary** renders, on one page with no dialogs: every entity in the current inline data-dictionary format (columns with type/nullability/default/description, PK/FK/AK markers, relationships + predicates, reader legend, per-entity findings) AND every process, external, and data store in the same laid-out style (process inputs/outputs, `db:` attribute lists, store/external descriptions, bodies, flow findings).
- [ ] The Dictionary search box filters the rendered page live (React state) across titles, descriptions, property/column names, and data types; non-matching items hide; clearing restores everything. Search text and scroll position survive a detour to another view and back (Dictionary stays mounted).
- [ ] Dictionary cross-references are clickable **anchor links** that scroll within the page — not modals.
- [ ] In the **Flows** view, the ⓘ badge on a **`db:` store** opens the rich `SelectedEntityModal` (attributes, child relationships, descriptions, example values) — the same dialog a graph node opens — NOT the markdown doc dialog. A process / external / non-`db` store still opens the plain markdown doc dialog. A `db:` store naming an **absent** entity falls back gracefully (markdown or empty state, surfaced by the existing `flow.unknown_store` finding) — never a crash.
- [ ] A `[[wiki-link]]` inside a flow markdown doc dialog that targets a **data entity** opens the rich entity dialog; one that targets a flow node opens the markdown doc dialog. Both resolve in-app without page navigation.
- [ ] `ignatius export <path> -o model.html` writes ONE self-contained file (no sibling files) that, opened from `file://` with no server, renders all three views, switches between them, runs the Dictionary search, themes correctly, and opens the entity dialog from a `db:` store — all offline. `-o` required (error + exit 1 when omitted).
- [ ] `export` exit code merges entity `globalErrors` + entity Class-B AND flow `validateFlows` Class-B into a single non-zero decision: exit 0 on a clean model, 1 when any of those is present.
- [ ] `export` injects the union of window globals into the one file: `__MODEL__`, `__FLOW_MODEL__`, `__LAYOUT_KEY__` (ERD), `__FLOW_LAYOUT_KEYS__` — so offline ERD position-restore AND flow persistence both work. (The flow generator lacks `__LAYOUT_KEY__` today.)
- [ ] `dict` / `graph` / `flow` subcommands are **removed**; invoking one prints a one-line error pointing to `export` and exits non-zero (they cannot reproduce the old per-surface files, so a silent alias would be more surprising than a clear error — see design Backward-compatibility). [Decision pending user veto — see CP7.]
- [ ] Live mode loads entity + flow data on boot and refreshes **all** views on the SSE `model-changed` event without a reload: editing an entity `.md` updates Graph + Dictionary; editing a flow `.md` updates Flows + the Dictionary's process sections. Exactly one app-level SSE subscription drives all views.
- [ ] `/dict`, `/flow`, `/flow-dict` routes are removed or redirect into the SPA (`/#view=…`); `generateDict` and `generateFlowDict` are no longer called by `serve` or the export path.
- [ ] `bun run typecheck` passes after each checkpoint. No `as`/`any` casts introduced.
- [ ] `bun run test` passes after each checkpoint. **`generateDict`/`generateFlowDict` survive (used by the CLI `dict`/`flow` subcommands) until CP7 removes those subcommands and CP8b deletes the generators** — so the existing `test-dict-*` / `test-flow-dict` string-assertion checks keep guarding those generators and stay GREEN until CP8b. CP4/CP5 **add** render-level checks for `DictionaryView` (Playwright harness, like `test-findings-panel.ts`); they do not delete the string checks. At CP8b, when the generators are deleted, their string checks are removed/replaced by the render-level checks (never deleted merely to go green). `test-flow-cli.ts`'s "sibling `.dict.html` exists" assertion **inverts** to "one file, no siblings" at CP7. Pinned `/dict`, `/flow-dict`, `__IGNATIUS_SURFACE__`, layout-injection, and `/api/*` checks are updated to the new contract as each lands.
- [ ] Visual screenshots captured + inspected: fused Dictionary (dark + light), Dictionary search filtering, view switching, a DFD themed dark + light, and the entity dialog opened from a DFD `db:` store.


## Approaches


Carried from the design. Chosen: **A — in-app view router**.


| # | Approach | Sketch | Cost | Risk |
|---|----------|--------|------|------|
| A | In-app view router | `view` + `#view=` hash; one mount; build/teardown the spatial renderer, keep Dictionary mounted; fused inline Dictionary with live search; rich entity dialog lifted + reused by `db:` stores; one `export` injects both models | high | render-effect re-key; porting two string generators; test re-authoring |
| B | Iframe-host the dicts | SPA shell + `<iframe>` | low | not one app; breaks offline `export`; can't fuse dicts or share dialog |
| C | Three routes, shared header | keep full pages | low | doesn't meet the ask |
| D | Micro-frontend shell | module federation | high | over-engineered; violates no-router/no-second-bundle |


## Recommendation


**A.** Leverage that bounds cost: `SelectedEntityModal` already exists (reuse for `db:` stores); the offline file already inlines both models via `generateFlowGraph` (only the ERD `__LAYOUT_KEY__` is missing); the fused Dictionary is a mechanical port of two string generators to JSX, shedding their duplicated chrome/theme/findings the app already owns. The real cost the design under-stated and this spec now names: the three render effects are mount-once + `__IGNATIUS_SURFACE__`-gated and must be **re-keyed to `view` state** (CP1), and the `db:` dialog needs a **new resolution path returning a `ModelNode`** (CP6), not the markdown `FlowDoc` the resolver returns today. Checkpoint order keeps each step green; old surfaces stay live until their replacement lands.


## Checkpoints


| # | Checkpoint | Files / areas | Agent | Est. files | Verifies |
|---|------------|---------------|-------|-----------|----------|
| 1 | **View router + render-effect re-key (structural)** — add `view` state + `#view=` to `hash-router.ts`; **re-key the flow-init (App.tsx ~1552), ERD-validate (~1596), and ERD-build (~1781) effects from `[]`/`__IGNATIUS_SURFACE__`-gate to `view`-driven**, dropping the existing teardown bodies in unchanged; **hoist the data-fetch + SSE effect out of any renderer lifecycle so it survives view switches**; FAB items switch views (Graph, Flows; Dictionary stub); seed initial view from `__IGNATIUS_SURFACE__` | `src/App.tsx`, `src/hash-router.ts`, `src/index.html` | atomic-builder | 3 | serve `/`; graph⇄flow switch with no second `GET /`; spatial renderers build + tear down on switch with no Cytoscape/navigator leak (switch N times, assert a single `__IGNATIUS_CY__`); data/SSE effect survives switches; hash reflects `view`; back/forward works; typecheck + test green |
| 2 | **Shared chrome (ERD version) + theme on DFDs** — lift the ERD graph's branding block, FAB, theme toggle, and `SelectedEntityModal` to app-level shared chrome rendered on all views; **thread theme vars into the flow SVG stylesheet builder so DFDs re-theme on light/dark** (they ignore theme today); retire the flow viewer's separate `FlowChrome` branding/FAB variants in favor of the shared ones | `src/App.tsx`, `src/flow-view/*` (stylesheet + chrome), `src/styles.css` | atomic-builder | 4 | branding + FAB identical across graph/flow/dict; toggling theme re-themes the Graph AND a DFD (screenshot DFD dark + light); the entity dialog still opens from graph taps; typecheck + test green |
| 3 | **Single data load + unified SSE** — boot fetches entity + flow once into shared app state; **unify the two existing `EventSource('/events')` subscriptions (ERD ~1633, flow `initFlowLive` ~448) into one app-level subscription** refreshing Graph, Dictionary, Flows; findings shared across views; keep `/api/model` + `/api/flow` (co-fetch) | `src/App.tsx`, `src/server.ts` | atomic-builder | 2 | exactly one SSE subscription; editing an entity `.md` updates graph live; editing a flow `.md` updates flow live; shared findings state populated for later db-store-dialog reuse; typecheck + test green |
| 4 | **Dictionary — entity section (inline, searchable, no dialogs, keep-mounted)** — port `generateDict`'s inline rendering to a React `DictionaryView` (entities in full: columns, markers, relationships, predicates, reader legend, findings); search box filtering live across ids/descriptions/columns/types; anchor cross-refs; Dictionary stays mounted (search + scroll survive detours); migrate dict CSS into bundle styles; add Dictionary to nav; reuse the existing `ColumnsTable`/`ChildrenTable`/`ExamplesAccordion` (with anchor-scroll `onNavigate`, NOT a dialog); `serve` `/dict` → redirect to `/#view=dict`, stop calling `generateDict`; **add render-level `DictionaryView` checks** (the existing `test-dict-*` string checks stay — they still guard `generateDict`, used by the CLI until CP7; removed/replaced at CP8b) | `src/App.tsx` (DictionaryView), `src/styles.css`, `src/server.ts`, `test/visual/` + `test/checks/` (new render-level) | atomic-builder | 6 | Dictionary lists every entity inline with full detail, no modals; search filters by id/description/column/type; cross-refs are in-page anchors; `/dict` redirects (no longer server-renders); new render-level dict checks pass; existing `test-dict-*` still green; screenshots dark+light; typecheck + test green |
| 5 | **Dictionary — fuse the process-model section** — extend `DictionaryView` with processes, externals, and data stores (port `generateFlowDict`'s inline content: inputs/outputs, `db:` attributes, store/external descriptions, bodies, flow findings) in the same laid-out style; unified search spans entities + processes + externals + stores; retire `generateFlowDict` from serve; remove/redirect `/flow-dict` | `src/App.tsx` (DictionaryView), `src/styles.css`, `src/server.ts`, `test/checks/*` | atomic-builder | 4 | one Dictionary page shows entities AND processes/externals/stores inline; search filters across all; `/flow-dict` no longer server-renders; screenshots; typecheck + test green |
| 6 | **Reuse the rich entity dialog for `db:` stores (new resolution path)** — add a `db:`-token resolution path that returns the live `ModelNode` from the entity catalog (not the markdown-reduced `FlowDoc`) and routes it to the shared `SelectedEntityModal`; **plumb the entity model + `entityErrors` into the flow render path** so the dialog's columns/relationships/examples/Issues all populate; entity-targeting `[[wiki-links]]` in flow doc dialogs open the rich dialog; process/external/non-`db` store keep `FlowDocModal`; guard absent-entity → graceful fallback | `src/App.tsx`, `src/flow-view/FlowDiagramSvg.tsx` (badge intent), `src/flow-view/*` (resolver) | atomic-builder | 3 | a `db:` store ⓘ opens the rich entity dialog with attributes/relationships/examples/findings populated; a process/external/non-db store opens markdown; an entity-targeting wiki-link opens the rich dialog; an absent-entity `db:` store falls back, no crash; typecheck + test green |
| 7 | **`export` CLI replaces graph/dict/flow** — new `exportCmd` parses entity + flows; a unified `generateApp` injects the union (`__MODEL__`, `__FLOW_MODEL__`, `__LAYOUT_KEY__`, `__FLOW_LAYOUT_KEYS__`) into ONE self-contained file (fold `generateGraph`/`generateFlowGraph` injection; flow-graph lacks `__LAYOUT_KEY__` today — add it); exit code merges entity global/Class-B + flow Class-B; **remove `dict`/`graph`/`flow` subcommands** — invoking one errors with "use `export`" (pending user veto); rewrite `test-flow-cli.ts` ("sibling exists" → "one file, no siblings") + graph/dict CLI checks | `src/cli.ts`, `src/generators/app.ts` (new, or fold into `graph.ts`), `src/generators/flow-graph.ts`, `test/checks/*` | atomic-builder | 5 | `export -o model.html` writes one file, no siblings; opened offline all three views + search + theme + db-store dialog work; exit 0 clean / 1 on entity-global/Class-B or flow Class-B; `-o` required; removed subcommands error helpfully; CLI checks updated + green |
| 8a | **Behavioral closeout** — remove/redirect any remaining `/flow`, `/dict`, `/flow-dict`; finalize FAB cross-nav (all three in-app); update remaining pinned `test/checks/*` (`__IGNATIUS_SURFACE__`, `/api/*`, layout-injection) to the new contract | `src/server.ts`, `src/App.tsx`, `test/checks/*` | atomic-builder | 4 | no `/dict`/`/flow`/`/flow-dict` string routes remain; FAB switches all three views; full `bun run test` green |
| 8b | **Non-behavioral closeout** — delete the retired `generateDict`/`generateFlowDict` (subcommands gone, nothing imports them) and now-dead `FlowChrome` branding/FAB code; **remove the `test-dict-*` / `test-flow-dict` string checks now that the generators are gone** (the CP4/CP5 render-level checks replace their coverage); update `.claude/project/signals.md`, the CLAUDE.md feature map, README/guides; capture the full visual screenshot set | `src/generators/*`, `src/flow-view/*`, `test/checks/test-dict-*.ts`, `test/checks/test-flow-dict.ts`, `.claude/project/signals.md`, `CLAUDE.md`, `docs/guides/*`, `test/visual/*` | atomic-builder | 8 | dead generators/chrome removed with nothing importing them; string-assertion dict/flow-dict checks removed (render-level coverage in place); signals + feature map reflect the collapse; guides updated; screenshots inspected; typecheck + test green |
| 9a | **Cohesion: one `<Modal>` primitive + facts-rich flow node dialogs** — extract a single `<Modal>` component (backdrop, stop-propagation, `.modal-close`, `.modal-header`, ONE ESC handler, focus) and refactor all hand-rolled shells (`SelectedEntityModal`, `FlowDocModal`, `LegendModal`, the inline Groups modal) onto it, removing the 4-way shell duplication + the two ESC handlers. **Enrich the non-entity flow node dialog**: the resolver returns the structured node (`FlowProcess`/`FlowExternal`/`FlowStoreRef`), and the dialog renders that node's DATA FACTS — a process's inputs/outputs table (reuse the Dictionary's `FlowIoTable`), an external/store's kind + references — ABOVE its markdown body. Entities (incl. `db:` stores) keep the rich `SelectedEntityModal`; non-entity nodes get facts + markdown (not the entity table — they are not data entities) | `src/App.tsx` (Modal, dialogs, resolver), `src/flow-view/*`, `src/styles.css` | atomic-builder | 4 | exactly one `<Modal>` component; all 4 dialogs use it; one ESC handler; a process ⓘ shows its inputs/outputs table + body (not markdown-only); external/store ⓘ shows kind + refs + body; `db:` store + entity taps unchanged (full rich dialog); typecheck + test green; visual screenshot of a process dialog with its I/O table |
| 9b | **Cohesion: unify the `.dict-*` / `.flow-*` Dictionary class families** — collapse the parallel section/table class families (`.dict-entity-section`/`.flow-process-section`/`.flow-external-section`/`.flow-store-section` → one shared section class; `.dict-attr-table`/`.dict-rel-table`/`.flow-io-table` → shared table classes) into ONE style system so the Dictionary has a single set of styles, not two kept in sync by hand. Update the `DictionaryView` render + `styles.css`; visuals unchanged | `src/App.tsx` (DictionaryView), `src/styles.css` | atomic-builder | 2 | one section + table class family used by entities AND flow items; no `.flow-*`/`.dict-*` duplication for sections/tables; the Dictionary looks identical before/after (screenshot diff); typecheck + test green |


## Renderer lifecycle (CP1–CP2 detail)


Hybrid model. The shared `graph-panel` div hosts exactly one active **spatial** renderer at a time (build/teardown on switch — the proven path); the **Dictionary** is a keep-mounted React subtree (cheap; preserves search + scroll).


- **Enter graph**: build Cytoscape + navigator + markers + hash viewport (existing main ERD effect, now `view`-keyed).
- **Leave graph**: destroy the Cytoscape instance, unmount the navigator (the navigator-leak fix path), clear `window.__IGNATIUS_CY__`.
- **Enter flow**: run `initFlowGraph` (live or static branch) into the panel.
- **Leave flow**: unmount the flow React root.
- **Dictionary**: own React subtree, stays mounted; entering/leaving hides the panel, never rebuilds the spatial renderer.
- **Data + SSE**: an app-level effect that is mounted across all view switches — NOT inside any renderer's lifecycle.


Teardown must be idempotent and leak-free; reuse the existing unmount bodies rather than authoring new ones. (Considered keep-all-mounted for the spatial renderers too; rejected — a `display:none` Cytoscape container has zero dimensions and needs a `cy.resize()` on re-show, and the navigator renders against a hidden canvas — worse than the proven teardown path.)


## What is retired vs kept


| Module / global | Fate |
|--------|------|
| `src/generators/dict.ts` (`generateDict`) | Retired; inline layout ported into `DictionaryView` (CP4). Deleted in CP8b once `dict` subcommand is gone. |
| `src/generators/flow-dict.ts` (`generateFlowDict`) | Retired; inline content ported into the Dictionary's process-model section (CP5). Deleted in CP8b. |
| `src/generators/graph.ts` / `flow-graph.ts` | Injection merged into `generateApp` (CP7); injects the union incl. ERD `__LAYOUT_KEY__` (flow-graph lacks it today). Bundle-embedding + `</script>`-escaping helpers kept. |
| `SelectedEntityModal` | Kept, lifted to app-level shared chrome; reused by graph nodes AND `db:` stores. |
| `FlowDocModal` (markdown dialog) | Kept for process / external / non-`db` store nodes only. |
| `FlowChrome` branding/FAB variants | Retired (CP2) — the ERD graph's branding + FAB become the shared, canonical chrome; dead variant code deleted CP8b. |
| Flow SVG stylesheet builder | Kept, but extended (CP2) to consume theme vars so DFDs re-theme. |
| `window.__IGNATIUS_SURFACE__` | Seed-only for initial view through CP7; removed in CP8a/b (update `index.html` + both generator injection sites). |
| `FindingsPanel`, theme toggle | Kept, lifted to shared chrome. |
| parse / validate / fingerprint / position persistence / drill-down | Untouched. |


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Render-effect re-key entangles SSE/data with renderer teardown | high | CP1 hoists data/SSE to an app-level effect first; spatial teardown bodies dropped in unchanged; a spike confirms the three effects refactor to `view`-keyed cleanly before CP1 lands |
| Cytoscape/navigator leak on repeated view switches | med | Reuse the proven teardown path; a check switches views N times and asserts a single `__IGNATIUS_CY__` |
| Dict/flow-dict CSS regressions when moved into the bundle | med | Screenshot Dictionary dark + light; migrate vars, don't re-author |
| Test re-authoring under-budgeted (~18 checks structurally pinned) | high | CP4/CP5/CP7 explicitly re-author `test-dict-*` + invert `test-flow-cli.ts`; never delete a check to go green |
| `db:` dialog assumed "wiring" but needs a `ModelNode` + entity-findings plumbing | med | CP6 builds a new resolution path + threads entity model/findings into the flow surface; absent-entity fallback guarded |
| Offline ERD position-restore silently no-ops | low | `generateApp` injects `__LAYOUT_KEY__` (CP7 success criterion) |
| DFD theming touches the isolated flow stylesheet | med | CP2 threads theme vars into the flow stylesheet builder; screenshot DFD dark + light as the gate |


## Implementation log


### Shipped — 2026-06-07


Built across 13 commits via `/subagent-implementation` (in place on `flow-edge-routing`, no worktree). Commits (chronological):


- `be45433` — docs: design + spec
- `d144b35` — CP1 in-app view router + render-effect re-key (graph⇄flow, no reload)
- `d076b00` — CP2a theme-aware DFD palette (light/dark on the flow viewer)
- `1e8db2f` — CP2b unify chrome (shared branding, theme toggle, view-contextual FAB)
- `bdcdaa1` — CP3 single data load + one SSE subscription for all views
- `3a24ece` — docs: defer dict test re-authoring CP4 → CP8b (spec amendment)
- `702a653` — CP4 React Dictionary view (inline, searchable entity reference; `/dict` redirects)
- `42431a8` — CP5 fuse the process dictionary into the Dictionary view
- `39feee3` — CP6 `db:` stores open the rich entity dialog in the flow viewer
- `956d70d` — CP7 `export` — one self-contained model.html replacing graph/dict/flow
- `c6d3594` — CP8a redirect `/flow` into the SPA; finalize in-app FAB nav
- `4dab724` — CP8b delete the retired string generators + dead code (net −5,926 lines)
- `78a4062` — CP8b sync guides + feature map to the unified app


**Out-of-scope work performed during this build:**


- Removed 6 obsolete `test/visual/` screenshot scripts that imported the deleted generators (CP8b) — not in the brief's deletion list but dead/broken after the generator removal.
- The flow viewer's separate `FlowChrome` FAB + theme toggle were retired in CP2b (folded into the shared app chrome) — a larger chrome refactor than "use the ERD version" implied.


**Unforeseens — surprises that emerged during implementation:**


- CP1 was a structural rework, not a "switch": the three render effects were mount-once + `__IGNATIUS_SURFACE__`-gated and had to be re-keyed to `view` state, with the data/SSE effect hoisted to survive switches (strategist-predicted; took 4 iterations including a DFD-preserve regression on SSE re-render).
- CP6's `db:` dialog was a data-shape change, not "wiring": the resolver returned markdown; it needed a discriminated entity-vs-doc result + a pan-free `openEntityById` reading live `model` via refs (closure-staleness caught in review).
- `generateDict`/`generateFlowDict` outlived the live `/dict`/`/flow-dict` routes by several checkpoints (CLI used them until CP7); the spec premise "string checks have nothing to assert at CP4" was false → test re-authoring moved to CP8b (change-logged).
- CP7's first offline test was doubly hollow (soft escapes + wrong DOM selectors that matched nothing); there was no real offline bug once the selectors were fixed.


**Deferred items still open (FOLLOWUPS — dispositioned at finalize):**


- F-2 retheme stale-closure guard; F-3 dark-bg test gate; F-4 Process-Dict ARIA role (link removed at CP8a — likely moot); F-5 stale-diagrams on zero-diagram edit; F-6 pre-existing `as` cast in FindingsPanel; F-7 zero-diagram-flows conflation; F-9 visual-test `waitForTimeout`; F-10 orphaned `inline-asset.ts`/`theme-css.ts`; F-11 FlowChrome dead-code sweep. (F-1 closed CP3; F-8 moot — graph.ts deleted.)
- `.claude/project/signals.md` refresh deferred to the ship verb (full deterministic scan).


**Squashed to `681c942` — 2026-06-09.** The per-checkpoint SHAs in this log are historical — unreachable from any branch after the `flow-edge-routing` branch was squashed to a single commit.


## Change log


### 2026-06-07 — Chrome-consistency pass (CP10a/b/c) after live verification


**What changed:** Added CP10a (one FAB icon + one menu component + modal Legend on every view + z-index overlap fix), CP10b (one shared `FindingsPanel` on all views, hidden when empty — retire FlowChrome's `FindingsAside`), CP10c (theme all FlowChrome elements — breadcrumb, DFD-nav card, minimap — for light mode; consistent minimap treatment). Detailed problem catalog + image descriptions: `.claude/.scratchpad/2026-06-07-unified-app-cohesion/PROBLEMS-chrome.md`.


**Why:** Live verification found the chrome diverges across Data Graph / Dictionary / Flow: FAB icon (4-dots on graph, `⋯` elsewhere), FAB menu content/order/behavior (modal Legend on graph vs inline-swatch legend on flow), findings panel (hidden-when-empty on graph vs always-shown "0 findings" on flow), minimap (three implementations, DD none), DFD light mode broken (FlowChrome hardcodes dark hex), and the dict side-nav overlapping the FAB menu unclosably.


**Superseded:** CP2's "branding + FAB are shared app-level chrome, identical across views" was only structurally true (one FAB button); the menu, findings, minimap, and FlowChrome's flow-specific elements remained divergent + non-theme-aware. CP10 makes the chrome genuinely uniform: one FAB menu component, one findings panel, theme-correct FlowChrome.


### 2026-06-07 — Cohesion pass added (CP9a/CP9b) after post-ship verification


**What changed:** Added CP9a (one shared `<Modal>` primitive + facts-rich non-entity flow dialogs) and CP9b (unify the `.dict-*`/`.flow-*` Dictionary class families). Post-ship verification found four cohesion answers: FAB uniform ✓, Dictionary visually uniform ✓ (but two parallel class families kept in sync by hand), DFD dialog detail PARTIAL (non-entity nodes were markdown-only), and dialogs PARTIAL (4 hand-rolled shells sharing CSS, no `<Modal>` component, 2 duplicated ESC handlers).


**Why:** User verification gate ("are we inventing a new dialog per screen? do non-entity DFD nodes get the loaded data?"). Decision: reuse already-loaded data to render each node's facts — entities get the rich table dialog; non-entity nodes render their structured data facts (process I/O, external/store kind+refs) + markdown, not markdown-only; and standardize on one `<Modal>` component + one Dictionary style system.


**Superseded:** CP6's "process/external/non-`db` store keep `FlowDocModal` (markdown only)" is amended — those nodes now get a facts-rich dialog (structured node data + markdown) on the shared `<Modal>`. The markdown-only `FlowDocModal` contract is replaced.


### 2026-06-07 — Test re-authoring moves from CP4 to CP8b (generators outlive the live path)


**What changed:** The `test-dict-*` (and `test-flow-dict`) string-assertion checks are NO LONGER re-authored at CP4/CP5. CP4/CP5 now ADD render-level `DictionaryView` checks; the existing string checks stay green guarding `generateDict`/`generateFlowDict`, which are removed at CP8b — where the string checks are then removed/replaced. CP4's `Files`/`Verifies` and the test-related success criterion were rewritten to match; CP8b gained the string-check removal.


**Why:** `generateDict`/`generateFlowDict` are still called by the CLI `dict`/`flow` subcommands until CP7 removes those subcommands and CP8b deletes the generators. The original spec premise — "a string generator no longer exists to assert against" at CP4 — was false: the generator outlives the live `/dict` route by several checkpoints. Re-authoring at CP4 would have churned 8 Playwright migrations while leaving the still-live generator untested.


**Superseded:** prior contract had CP4 re-author the `test-dict-*` string checks as render-level checks (premised on the generator being gone at CP4). New contract: string checks persist until the generator is deleted (CP8b); CP4/CP5 add render-level coverage alongside.
