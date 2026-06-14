# DFD viewer overhaul — leveling + layout

## Goal

Replace the flat, hand-rolled DFD viewer with (a) canonical Yourdon/SSADM leveling (context → Level-1 overview → leaf decompositions, navigable by drill-down and breadcrumbs) and (b) ELK-driven layout (crossing minimisation, ordered bands, compact diagrams with full data contracts available on demand), while keeping the existing SVG renderer as a position consumer. The proving model is `models/llm-memory-db-mssql/`. All existing checks must stay green throughout.


## Non-goals

- Rewriting `FlowDiagramSvg.tsx` — it becomes a position consumer; its rendering logic is untouched.
- Unifying ELK across the ER graph (`cytoscape-elk`) and the DFD view — deferred (design open question 4).
- Changing ELK layout for the entity model or the ER graph.
- Physical folder restructure of `flows/` — leveling is logical only.
- Queue-payload validation or usage-index changes (excluded by `docs/spec/process-flows.md` non-goals).
- Authoritative silent rewrite of boundary flows — balancing is reconciliation (lint), never a rewrite.


## Success criteria

All of the following must be true for the overhaul to be considered done:

- [ ] **C1.** `bun run test` passes (all assertion checks in `test/checks/*.ts`) at every checkpoint, with zero regressions.
- [ ] **C2.** `ignatius validate models/llm-memory-db-mssql` exits 0 with 0 findings (proving model clean throughout).
- [ ] **C3.** `ignatius validate models/key-inherited` exits 0 (existing model unaffected).
- [ ] **C4.** ELK positions module: for every `FlowDiagram`, all node ids receive (x, y) positions and the band ordering invariant holds — **max-y of band N < min-y of band N+1** across all five bands: source-ext (band 0) → input-store (band 1) → process-row (band 2) → output-store (band 3) → sink-ext (band 4). Verified by comparing bounding-box extremes of node positions per band, not centroids.
- [ ] **C5.** Dense-diagram screenshots (`memory-lifecycle`, `tag-administration`): substantially fewer edge crossings than the pre-overhaul baseline (`tmp/elk-spike/shots/<diagram>-0-baseline.png`), and no overlapping edge labels. The crossing comparison is the deterministic count recorded in `tmp/elk-spike/metrics.json` / `decision.md`.
- [ ] **C6.** Leveling: on the proving model, the auto-derived context diagram has exactly 1 process (the system bubble) and only flows to/from externals.
- [ ] **C7.** Leveling: on the proving model, the auto-derived Level-1 overview (a) contains all 6 activity processes, (b) contains every store whose degree across the leaf set is ≥ 2, and (c) contains NO store whose degree across the leaf set is exactly 1 (single-process-local stores are absent from Level-1).
- [ ] **C8.** `FlowDiagramSvg` renders identically when passed ELK positions (via the new `elkPositions` prop) vs the old banded positions — no visual regression on `key-inherited/flows/order-to-cash`. Verified AT the wiring checkpoint (CP3) by capturing both screenshots. ELK is the primary position source for all renders; the banded `computeFlowLayout` path is retained ONLY as the fallback when ELK layout fails. `savedPositions` drag overrides win over both.
- [ ] **C9.** Drill-down, breadcrumbs, and `dfd=` deep-link work for the synthesised context and Level-1 diagrams (exercised by a URL-navigability check analogous to `test-cp3-dfd-url-navigability.ts`).
- [ ] **C10.** An unbalanced-boundary fixture fires `flow.unbalanced_decomposition` at the context↔L1 and L1↔leaf boundaries; the proving model fires none.
- [ ] **C11.** `bun run typecheck` clean (no new type errors introduced).
- [ ] **C12.** Dotted-number correctness: on the proving model each synthesised Level-1 process carries its correct top-level number (`1`, `2`, …, `6`); each leaf diagram's processes are renumbered `N.1`, `N.2`, … where `N` is their parent Level-1 number. Verified via the existing `dottedNumber` / `compareDottedProcesses` scheme on the proving model.
- [ ] **C13.** Edge data contracts (the column lists) remain reachable in the viewer: with full-column-list labels off the canvas by default, each edge's data contract is available on hover/click. No always-on column-list label is rendered inline on the canvas (only short `ext:`/`kind:` payload phrases may render inline).


## Approaches

The genuine forks, resolved per `docs/design/dfd-overhaul.md`:

| Fork | Options | Decision |
|------|---------|----------|
| Level-1 overview source | A auto-derive · B hand-author · C hybrid (auto-derive proposal + balancing lint, author may override) | **C** — context fully auto-derived; Level-1 auto-derived, reconciled by lint, not authoritative |
| ELK adoption scope | A replace only DFD positioner · B unify ELK across DG+DFD | **A** — DG via cytoscape-elk already works; unification deferred |
| Async seam | A make `FlowDiagramSvg` internal layout async · B precompute ELK positions upstream in `renderDiagram`, pass as prop | **B** — renderer stays a synchronous position consumer; `await` happens once in `FlowsView.renderDiagram` |
| Re-parenting | A physical folder restructure of `flows/` · B logical (each top-level diagram = a Level-1 process) | **B** — no model file churn; existing sub-DFD drill-down supports it. Synthesized context + Level-1 diagrams reuse the existing `FlowDiagram` shape and are inserted into the existing `diagrams`/`subDfds` tree — NO new type introduced. Downstream consumers `/api/flow`, `buildFlowDocResolver`, `buildFlowNodeUsageIndex`, and `buildEntityUsageIndex` are unaffected by shape because the tree structure is unchanged. |
| Sequencing | spike → Stream B (layout) → Stream A (leveling) | each checkpoint lands and verifies independently |

**Engine note.** ELK (`elkjs`) is the only headless JS engine with all of {layered Sugiyama, band partitioning, port-side constraints, first-class edge-label placement via label-dummy-node}. It is already a direct dep (`^0.9.3`; target 0.11.x). Capability claims are primary-sourced — see `docs/research/dfd-layout-and-leveling.md §3`. The specific ELK option names and partition-index mapping live in the design's §Recommendation and the research report — the spec states behavioral outcomes only. The tuned outcome is validated by the completed spike: band partitioning holds and roughly halves crossings on the dense diagrams; full column-list labels are moved on-demand to avoid width blowup (`tmp/elk-spike/decision.md`).


## Recommendation

Per `docs/design/dfd-overhaul.md`: a new async ELK positions module receives a `FlowDiagram` and returns node positions (and edge-label positions), keyed by node id. `renderDiagram` in `FlowsView.tsx` awaits this module before mounting `FlowDiagramSvg`; positions arrive as a new `positions` prop — the same shape the renderer already merges from `savedPositions`. `buildFlowData` / `computeFlowLayout` in `flow-layout.ts` continue supplying nodes/edges/storeNums synchronously; only the position source changes. ELK runs on the **main thread** via the `web-worker` package (a browser-native `Worker` passthrough that also resolves cleanly under Bun's bundler); DFDs are small (< 50 nodes), so main-thread layout is imperceptible. The GWT kernel (~1.5 MB) ships in the bundle. (A separate off-main-thread worker artifact was evaluated and dropped — the bundled-worker path fought Bun's bundler; main-thread is the simpler, working choice.) Saved drag positions (the `savedPositions` override path in `FlowsView.tsx`) continue to override ELK positions unchanged. Leveling derivation inserts synthesised context and Level-1 `FlowDiagram` objects atop the `FlowModel` tree; `selectDiagramById` / `findDiagramPath` / `dfd=` hash routing require no structural change. Balancing and naming-collision checks extend `checkUnbalancedDecomposition` in `flow-validate.ts`.

**Store ordering — no compound grouping.** The layout relies on ELK's natural in-layer ordering (crossing minimisation) to keep each store adjacent to the process(es) it connects. It does **not** wrap related stores in ELK compound parents: the spike showed compound nodes under partitioning collapse the band structure and multiply crossings (`tmp/elk-spike/decision.md`). The ELK module returns node positions and short-label positions only — no group-membership map.

**Edge labels — on-demand, not always-on.** Full column-list data contracts are not rendered as inline canvas labels: the spike showed always-on column lists (even line-wrapped) blow diagram width to ~2000–5000px (`tmp/elk-spike/decision.md`). Instead the data contract is reachable on hover/click of an edge. ELK's label-dummy-node placement is used only for short `ext:`/`kind:` payload phrases that may render inline.


## Checkpoints

One slice per row. Each must end green (`bun run test` + `ignatius validate` clean) before the next begins.

| # | Title | What it delivers | Files / areas | Verifies |
|---|-------|-----------------|---------------|----------|
| **SPIKE** | ELK band-layout prototype (COMPLETE) | Headless ELK Layered with band partitioning on `memory-lifecycle` + `tag-administration`. Baseline + variant screenshots and deterministic crossing counts captured to `tmp/elk-spike/`. Decision in `tmp/elk-spike/decision.md`: **proceed with ELK bands** (crossings ~halved, drawing ~5× smaller); **compound grouping dropped** (backfires — crossings 13→69, 4→34); **column-list labels on-demand** (always-on blows width to ~2000–5000px). | `tmp/elk-spike/` | C5 baseline + crossing counts captured; spike decision recorded (gate: bands hold + label width acceptable via on-demand) |
| **1** | ELK positions module | New async module: accepts a `FlowDiagram`, runs `elkjs` Layered headlessly (per-node band partition + `DOWN` direction, port sides), returns `{ positions: Record<string, {x,y}>, labelPositions: Record<string, {x,y}> }` (positions for all nodes; label positions for short inline labels only). Bump `elkjs` `^0.9.3` → `0.11.x`. elkjs-under-Bun needs a `workerFactory` (see `tmp/elk-spike/decision.md`). | `src/flow-view/elk-flow-layout.ts` (new) · `package.json` | New `test/checks/test-elk-flow-positions.ts` asserting C4: all node ids present + band ordering invariant (max-y of each band < min-y of the next band) |
| **2** | Edge-label strategy (on-demand) | The ELK module lays out inline labels only for short `ext:`/`kind:` payload phrases; full `db:` column-list contracts are NOT laid out inline. The renderer exposes each edge's full data contract on hover/click instead of an always-on label. | `src/flow-view/elk-flow-layout.ts` · `src/flow-view/FlowDiagramSvg.tsx` (edge hover/click contract) | New check / screenshot asserting C5 (no overlapping labels on dense diagrams) and C13 (contract reachable on hover/click) |
| **3** | Wire into FlowsView | `renderDiagram` in `FlowsView.tsx` awaits `elk-flow-layout` and passes positions to `FlowDiagramSvg` via a new optional `elkPositions` prop (additive — existing `savedPositions` override path intact). ELK runs main-thread via the `web-worker` package (no separate worker artifact). ELK is the primary position source; the banded `computeFlowLayout` path is kept ONLY as the fallback when ELK layout fails. ELK runs on every render (deterministic — no churn); `savedPositions` overrides are layered on top, so a partial drag keeps ELK positions for the non-dragged nodes. Capture before/after screenshots of `order-to-cash` for C8 here. | `src/flow-view/FlowDiagramSvg.tsx` (new `elkPositions` prop) · `src/app/views/flow/FlowsView.tsx` (`renderDiagram`, `savedPositions` override) · `src/flow-view/elk-flow-layout.ts` · `package.json` (`web-worker` dep) | C1, C2, C3; C8 verified and closed here (screenshots saved to `tmp/`); C5 screenshots of both dense diagrams |
| **4** | Leveling derivation | New module derives context (`FlowDiagram`, 1 process + external boundary flows) and Level-1 overview (`FlowDiagram`, activity processes + degree≥2 stores) from the parsed leaf set; inserts both atop `FlowModel.diagrams` using the existing `FlowDiagram` shape (no new type). Each existing top-level diagram becomes a `subDfd` of its Level-1 process. Level-1 processes carry correct top-level dotted numbers (`1`, `2`, …); each leaf diagram's processes are renumbered `N.1`, `N.2`, … using the existing `dottedNumber` / `compareDottedProcesses` scheme. Naming-collision rule: store reference tokens that are identical strings but carry conflicting attributes (different `kind` or `title`) across leaves are flagged (no edit-distance heuristics). Consumers `/api/flow`, `buildFlowDocResolver`, `buildFlowNodeUsageIndex`, and `buildEntityUsageIndex` are unaffected (shape unchanged). | `src/flows/flow-derive-levels.ts` (new) · `src/flows/flow-parse.ts` (`parseFlows` consumer) · `src/flows/flow-validate.ts` (new naming-collision rule) | New `test/checks/test-leveling.ts` asserting C6, C7, and C12 on the proving model |
| **5** | Balancing reconciliation | Extend `checkUnbalancedDecomposition` in `flow-validate.ts` to the context↔L1 and L1↔leaf boundaries. Add a test fixture with a deliberate boundary-flow mismatch (one inflow present at L1 but absent from context). | `src/flows/flow-validate.ts` (`checkUnbalancedDecomposition` function) · `test/fixtures/unbalanced-levels/` (new fixture) | New check asserting C10: fixture fires `flow.unbalanced_decomposition`; proving model fires none (C2) |
| **6** | Navigation integration | Context and Level-1 diagrams appear in the Flows view; drill-down from a Level-1 process opens its leaf decomposition; breadcrumbs cross all three levels; `dfd=<id>` deep-links to context and L1 survive page refresh via `selectDiagramById` / `findDiagramPath`. No routing change required — `hash-router.ts` is unaffected. | `src/app/views/flow/FlowsView.tsx` (diagram list, breadcrumb labels) | New `test/visual/test-cp-leveling-nav.ts` (URL navigability, cases A–D: context load, L1 drill, leaf drill, refresh-restore); C9 |
| **7** | Proving-model verification | End-to-end: `ignatius validate models/llm-memory-db-mssql` clean; screenshots of context, L1 overview, `memory-lifecycle`, and `tag-administration` rendered with ELK layout (bands ordered, no label overlap, drill-down functional). | `models/llm-memory-db-mssql/` · `scripts/screenshot.ts` | C1, C2, C3, C4, C5, C6, C7, C9, C10, C11, C12, C13 — full sign-off (C8 already closed at CP3) |


## Risks

Evidence from `docs/research/dfd-layout-and-leveling.md §5`:

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Drawing-size inflation from space-reserving edge labels (documented ~3× at 100 vertices in dense DFDs) | Resolved by the spike | Full column-list labels are off-canvas by default (CP2); the data contract is on hover/click. The spike confirmed always-on labels blow width to ~2000–5000px (`tmp/elk-spike/decision.md`); on-demand labels keep the compact ELK layout. |
| Band-constraint fragility: partitioning + compound hierarchy can behave unexpectedly (elkjs#327, elk#623) | Resolved by the spike | Compound grouping is dropped — the spike reproduced the fragility (crossings 13→69, 4→34, bands collapsed). Partitioning is the sole band lever; store proximity comes from ELK's natural in-layer ordering. |
| Main-thread jank from the GWT kernel; bundle size grows ~1.5 MB | Low — DFDs are < 50 nodes; main-thread layout is imperceptible | Accepted (CP3): ELK runs main-thread via `web-worker`. If a future model has large DFDs, revisit an off-main-thread worker. |
| Async API mismatch: current preset positioner is synchronous; SVG render path must become async | Low — `renderDiagram` in `FlowsView.tsx` is already async-capable | Async seam is contained to `renderDiagram`. No changes to renderer internals. |
| Auto-derivation correctness: naming collisions across leaves may mis-promote or split logically-shared stores | Medium — `llm-memory-db-mssql` uses consistent store ids, but future models may not | Surface naming-collision findings (CP5 naming-collision rule) for the mechanical case: identical token strings with conflicting `kind`/`title` across leaves. Never silently merge. |
| Balancing drift between derived levels and leaf content | Medium — derivation synthesises context flows from the leaf boundary set, which may be incomplete | Route all discrepancies through `flow.unbalanced_decomposition` (Class A, soft warning), never through silent rewrite. Author corrects the leaf file; derivation re-runs. |


## Change log

### 2026-06-13 — spike outcome: drop compound grouping, labels on-demand

**What changed:** The SPIKE checkpoint ran (`tmp/elk-spike/`) and its findings amended the plan. (1) Compound store grouping is removed — it more than quintupled crossings and collapsed the bands; store proximity now comes from ELK's natural in-layer ordering. (2) Full column-list edge labels are no longer rendered inline (always-on labels blow diagram width to ~2000–5000px even line-wrapped); the data contract moves to hover/click. (3) The spike gate metric changed from bounding-box *area* ≤ 2× to a *width*/usability bound, because area masked the horizontal blowup. Success criteria, the Recommendation, the Checkpoints table, and the Risks table were rewritten to this truth and renumbered.

**Why:** Empirical spike evidence on the two dense diagrams (`tmp/elk-spike/decision.md`, `metrics.json`, 14 screenshots).

**Superseded:** prior C6 (compound-group contiguous x-range) is removed; prior CP2 (Compound store grouping) is removed; prior CP3 (label-dummy-node placement for all labels) is now CP2 (on-demand contracts; ELK labels for short payloads only); prior area-based gate (old C13) is replaced by a width bound; criteria/checkpoints renumbered accordingly.

### 2026-06-14 — CP3 worker decision: main-thread ELK

**What changed:** CP3 wires ELK via the `web-worker` package on the main thread rather than a dedicated off-main-thread worker artifact. The prop is named `elkPositions`. Recommendation, the CP3 row, and the bundle-weight risk were updated.

**Why:** the bundled off-main-thread worker fought Bun's bundler; main-thread is the simpler working path and imperceptible for < 50-node DFDs (verified: CP3 renders both dense diagrams + order-to-cash with no regression, suite 59/0).

**Superseded:** the planned `src/flow-view/elk-worker.*` artifact and off-main-thread isolation are dropped; the ~1.5 MB kernel ships in the bundle.
