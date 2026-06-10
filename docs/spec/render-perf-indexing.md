# Render performance: ELK avoidance + precomputed O(1) indexes


## Goal


Cut graph initial-render latency at scale (300+ entity files) and remove O(n²) scan-in-loop hot spots. Two
independent wins: stop running ELK on the render critical path when a layout is already known (and offload it to
a worker when it isn't), and precompute every *repeated* model lookup (id, edge endpoints, PK/AK/FK columns,
basetype/subtype membership, group) into O(1) maps built once per Model.


## Non-goals


- **L5** — headless server-side layout precompute shipped in the payload. Dropped.
- Changing layout *output* when ELK runs. The worker must produce the same positions the main-thread ELK
  produces today (same algorithm + options).
- Indexing **cold one-shot** lookups (single, non-repeated). Only repeated lookups (per-loop / per-click /
  per-render) get a map; a map for a single lookup costs more than it saves.
- Attaching index maps to the **serialized** Model — Maps do not survive JSON (`window.__MODEL__`,
  `/api/model`). The index is build-on-consume.


## Success criteria


- [ ] **L1** — a repeat graph load whose `layoutKey` has saved positions does NOT run ELK: cy is constructed
  with `layout: { name: 'preset' }` and the saved positions applied. Verified by a measured drop in
  time-to-`layoutstop` vs the CP1 baseline AND an assertion that the ELK layout did not run.
- [ ] **L4** — a first load (no cached layout) runs ELK in a Web Worker off the main thread; the main thread is
  not blocked during layout (UI stays responsive / a spinner renders). The resulting node positions match the
  current main-thread ELK output for the same model + mode.
- [ ] Subtype compound parents (`_cluster_*`) and joiners render correctly in `preset` mode — boxes size around
  restored children, no displaced children, no missing boxes.
- [ ] `buildModelIndex(model): ModelIndex` exists as a pure function (no I/O), unit-tested, returning O(1):
  `nodeById`, `nodeIdSet`, `edgesBySource`, `edgesByTarget`, `edgeByEndpointPair`, `pkByNode`, `columnsByNode`,
  `akColumnsByNode`, `fkColumnsByNode`, `subtypeMemberToCluster`, `clustersByMemberId`, `basetypeClusterById`,
  `nodesByGroup`. Built once where a Model enters a consumer; never serialized.
- [ ] **L3** — `App.tsx` cluster-wiring `elements.find` (≈4316) replaced by an id→element Map; subtype member
  wiring output unchanged.
- [ ] Render + interaction lookups over `model.nodes`/`edges`/`subtypeClusters`/`groups` (the hit-list hot
  sites) use the index, not `.find` / `.filter` / `.includes`. Per-click entity resolution (`openEntityById`,
  cytoscape click, hash restore, modal open) is O(1).
- [ ] Flow O(n²) hot spots indexed: entity-by-id (`flow-validate:71`), process in/out edges (`:345`),
  storeRef-by-token (`:549` / `flow-parse:549`), process-by-id (`:603`) — each via a prebuilt Map.
  `validateFlows` findings unchanged on the `key-inherited` (clean) and `broken-demo` baselines.
- [ ] Dictionary `nodes.filter(group === key)` double-scan (`App.tsx` 2719/2736) computed once via
  `nodesByGroup`.
- [ ] Error indexes (`errorsByEntityId`, `errorsByProcessId`) are App-level `useMemo`s over findings, NOT in
  `ModelIndex`.
- [ ] No behavior / visual regression: all `test/checks` green; `validate` output identical on baselines;
  Graph / Dictionary / Flows render identical (screenshots match).
- [ ] Measurement harness exists and reports parse-ms / time-to-`layoutstop` / time-to-interactive for a
  generated synthetic model and an optional `--model <dir>`. Baseline + per-CP numbers recorded in the
  implementation log.
- [ ] **L2** — ELK cost scales by node count so a large model (~361 entities, the real `pos-noorm-model`)
  RENDERS instead of crashing the tab, in BOTH layout modes. Layered: thoroughness ladder `<50→30`, `50–100→20`,
  `100–200→14`, `200+→7` (user-specified), plus dropping the expensive placement/routing at the high tiers if
  measurement shows it's needed (`NETWORK_SIMPLEX`→`BRANDES_KOEPF`, `ORTHOGONAL`→`POLYLINE`). Organic/stress (the
  default, and the crashing path): scale stress cost AND `arrangeOrganic` iteration counts by node count, with a
  hard fallback to cheap layered above a measured threshold if stress cannot render at scale. **Small models
  (<50) keep today's exact high-quality settings — zero visual/quality regression below the first threshold.**


## Approaches


Analysis already done (two read-only grounding passes; ELK confirmed as the render-path dominant cost,
`elkjs` confirmed as a direct dep usable headless + in a worker). Lever decisions:


| Lever | Decision |
|-------|----------|
| L1 — skip ELK when a cached layout exists | DO — biggest initial-render win; build the shared preset-apply path |
| L3 — fix the O(n²) element `.find` | DO — folds into the index sweep |
| L4 — ELK in a Web Worker | DO — rides L1's preset-apply path; unfreezes the first load |
| Index sweep — nodeById / edges / PK / AK / FK / basetype-subtype / group | DO — build-on-consume `ModelIndex`; correctness-at-scale + interaction snappiness |
| L2 — ELK quality knobs by size | DEFER (last) |
| L5 — server precompute shipped in payload | DROP |


## Recommendation


Measurement-first (CP1 harness), then L1 (biggest lever, self-contained), then the index core + sweep, then the
flow hot spots, then L4. **L1 and L4 share one preset-apply mechanism** (apply positions → do not run ELK),
built in L1 and reused in L4. `ModelIndex` is **build-on-consume** because the Model serializes to JSON; the
bundle is rebuilt wherever a Model enters a consumer (after `parseModels`, after the fetch, after reading the
global) and memoized.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Measurement harness + synthetic model generator | `scripts/` or `test/visual/` (new), `tmp/` generated | atomic-builder | ~2 | prints parse-ms / time-to-`layoutstop` / TTI for a generated ~300-entity model + optional `--model`; baseline captured |
| 2 | **L1** — skip ELK when a cached layout exists → shared preset-apply path | `src/App.tsx` (cy init ≈4403–4541) | atomic-builder | 1 | cached `layoutKey` → cy built with `preset`, ELK not run; compound parents/joiners correct; time-to-`layoutstop` drops vs CP1; no visual regression (screenshot) |
| 3 | `buildModelIndex` core + unit test | `src/model-index.ts` (new), `src/parse.ts` (types only) | atomic-builder | 2 | pure fn; O(1) maps per criteria; unit test covers nodeById / edges / pk / ak / fk / basetype-subtype / group; not serialized |
| 4 | **L3** + render/interaction sweep onto the index | `src/App.tsx` (4316, 2719/2736, per-click `.find`s), App-level error memos | atomic-builder | 1 | 4316 + dict double-filter + per-click finds use the index; error memos; Graph/Dict identical; screenshots match |
| 5 | **L2** — scale ELK cost by node count (both modes) so a ~361-entity model renders, not crashes | `src/App.tsx` (`buildLayoutOpts` ≈4434–4470, `arrangeOrganic` + its passes ≈57–235) | atomic-builder | 1 | 361-node synthetic + `pos-noorm-model` RENDER (no crash) in organic AND hierarchical; thoroughness ladder applied; small (<50) models visually unchanged; measured layoutstop drop |
| 5b | **Edge-paint bug** — connecting lines/markers don't paint until mouseover on large/preset renders | `src/App.tsx` (layoutstop / preset path / redrawMarkers ordering ≈4688-4760), `src/markers.ts` | atomic-builder | ~2 | edges + markers paint on load WITHOUT hover, on both first-load (ELK) and preset (cached) paths, at scale (screenshot proof, large model) |
| 6 | **L4** — ELK in a Web Worker via the preset-apply path | `src/App.tsx`, new worker glue (`elkjs` `elk-worker`), `src/types` | atomic-builder | ~3 | first load runs ELK off the main thread (UI not blocked); positions match current ELK output; graceful fallback; measured TTI |
| 7 | Flow validate/parse hot spots indexed (deprioritized to last) | `src/flow-validate.ts` (71/345/549/603), `src/flow-parse.ts` (549) | atomic-builder | 2 | hot `.find`s → prebuilt Maps; `validateFlows` findings unchanged on `key-inherited` + `broken-demo` |


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Preset mode mis-sizes subtype compound boxes | med | CP2 success criterion + screenshot; restore children only, let box recompute |
| Worker ELK output differs from cytoscape-elk (node dimensions) | med | feed identical ELK options + per-node dims from the same label sizing; assert positions match on a fixture |
| Index drift — a consumer mutates the model after the index is built | low | build from the immutable parsed Model; rebuild on model change (SSE / refetch) |
| Worker serialization / bundling under the Bun `--compile` binary + static export | med | use `elkjs` `elk-worker.min.js`; verify in the compiled binary and the static export |
| Indexing subtly changes validate output | low | byte-compare findings on the baselines (CP5) |


## Change log


### 2026-06-10 — Pull L2 forward; reorder remaining CPs

**What changed:** L2 (scale ELK cost by node count) moved from a non-goal to checkpoint CP5 and prioritized
ahead of the worker and flow indexing. The flow-validate/parse indexing (was CP5) becomes CP7. New execution
order for the remaining work: **CP5 L2 → CP6 worker → CP7 flow**.

**Why:** the user's real model is ~361 entities and CRASHES the browser tab on first load (not merely slow). L1
only helps repeat loads; the worker would make it non-blocking but not faster. L2 attacks the root — the default
**organic/stress** layout is O(n²) per iteration plus `arrangeOrganic`'s 80–90-iteration O(n²) post-passes,
which is what blows time/memory at 361 nodes. User specified a layered thoroughness ladder (`<50→30`,
`50–100→20`, `100–200→14`, `200+→7`); investigation found the crashing default is organic mode (where
thoroughness does not apply), so L2 must also scale the stress + `arrangeOrganic` path.

**Superseded:** prior contract deferred L2 to last and listed it under Non-goals.

### 2026-06-10 — Add CP5b: edge-paint-on-hover bug

**What changed:** Added CP5b — on large / cached-layout (preset) renders, edge connecting lines / crow's-foot
markers do not paint until the user mouses over them. Fix the post-layout render ordering so edges + markers
paint on load without hover, on both the first-load (ELK) and preset paths.

**Why:** user-reported after L2 made the 361-entity model render. Leading cause (investigation): `redrawMarkers()`
runs before `cy.fit()` forces a visual render of newly-applied positions, so `markers.ts` reads NaN rendered
endpoints and skips drawing; a hover-triggered repaint then paints them. Predates L2; exposed at scale.

### 2026-06-10 — CP6 (worker) bundler-blocked + deferred; CP7 deprioritized

**What changed:** CP6 (ELK web worker) was attempted but NOT shipped — the worker never activates under Bun's
HTML bundler (`new Worker(new URL(...))` is inlined into the single chunk, always falling back to main-thread
ELK), so it delivered no benefit while adding App.tsx complexity. Discarded (not committed); scaffolding
preserved at `tmp/trash/cp6-worker/`. Deferred to followup `render-perf-elk-web-worker` (needs a separate worker
build entrypoint + Blob-URL inline for the single-file export). CP7 (flow validate/parse indexing) deferred to
followup `render-perf-flow-index` (low value, user-deprioritized; not on the render-critical path).

**Why:** L2 (CP5) already makes the 361-entity model render (was crashing) — the worker is a non-blocking
nicety, not a blocker, and needs a focused build-infra session. Committing non-functional speculative code
(especially into the to-be-decomposed App.tsx) violates the simplicity principle.

**Superseded:** CP6/CP7 are no longer in this batch's shipped scope (see Implementation log).


## Implementation log

### Shipped — 2026-06-10 (branch `perf-render-indexing`, commit-only)

Built across CP1–CP5b via `/subagent-implementation`. Commits (chronological):

- `f7c9b27` — CP1 perf harness + synthetic model generator (baseline: 300 nodes → ELK 7.4 min; parse 122ms)
- `9c9e9d3` — CP2 **L1** skip ELK when a cached layout exists → preset apply (5.5× at n=50; replaces 445s at n=300)
- `f33aa1f` — CP3 pure `buildModelIndex` — 13 O(1) maps (id/edge/pk/ak/fk/basetype-subtype/group)
- `9e82bd7` — (followup) track App.tsx decomposition per user
- `af1f562` — CP4 **L3** + render/interaction lookups routed through ModelIndex (no behavior change)
- `126bbd1` — CP5 **L2** scale ELK cost by node count → **361-entity model renders (~10s) instead of crashing**
- `3ce0008` — (spec) add CP5b
- `d6565dc` — CP5b paint MARKERS on load (forceRender + deferred redrawMarkers) — partial; canvas edge lines still wiped
- `3010c19` — CP5c the real edge-paint fix: `cy.style()` reassignment invalidates cytoscape's stale element texture cache (forceRender alone only schedules a draw); edge LINES now paint on load on large models (ELK + preset). Supersedes CP5b's partial fix.

**Headline:** the user's real ~361-entity model went from **crashing the tab → rendering in ~10s**, and edges
now paint on load. L1 makes repeat loads instant.

**Out-of-scope work performed during this build:**
- L2 (CP5) was pulled forward from a non-goal to a checkpoint when the real model was found to crash (not just be
  slow). The default organic/stress layout + `arrangeOrganic` O(n²) passes were the crash; organic falls back to
  cheap layered above 150 entities.
- CP5b (edge-paint bug) was discovered mid-batch from user feedback.
- Rebuilt the stale local `dist/ignatius` (0.6.0→0.7.0) to clear a pre-existing test-suite gate.

**Unforeseens:**
- The default layout mode is organic (stress), not layered — so the user's thoroughness ladder (layered-only)
  had to be paired with stress + `arrangeOrganic` scaling to fix the crash.
- CP6 worker: Bun's HTML bundler inlines workers, so the worker never runs — deferred (see change-log).

**Deferred items still open:**
- `render-perf-elk-web-worker` (CP6 — non-blocking first-load layout; needs separate worker build).
- `render-perf-flow-index` (CP7 — flow validate/parse O(n²) indexing; low value).
- `app-tsx-decomposition` (user-requested; App.tsx is ~5300 lines).
- Scratchpad `FOLLOWUPS.md` F-1..F-9 (nits: docstrings, test strictness, harness dead-code, the n=150 LONGEST_PATH
  option, synthetic-fixture edge legibility) — awaiting user triage (user asleep at finalize; scratchpad retained).

**Squashed to a single commit on `main` — 2026-06-10.** Per-checkpoint SHAs above are historical (unreachable; the `perf-render-indexing` branch was collapsed to one commit).
