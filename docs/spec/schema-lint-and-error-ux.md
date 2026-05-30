# Schema lint + error UX — spec


## Goal

Introduce a pure `validateModel(model) → ValidationResult` layer with a stable rule-ID registry, surface its findings on every consumer (static dict, static graph, live viewer, CLI stderr), and add a persistent top-right panel in the live `ignatius serve` viewer that updates on every save and lets the user jump to a broken entity.


## Non-goals

- Auto-fix.
- Model-design suggestions ("consider promoting X to a basetype").
- LSP / IDE integration.
- Markdown body validation.
- Configurable severity. Class is encoded in the type (`EntityError` always warning, `GlobalError` always error).
- `--strict` flag promoting warnings to errors. Exit code in v1: errors → 1, warnings → 0.
- A separate `ignatius lint` subcommand. The architecture supports adding one later; not in this pass.
- `_meta.yaml` / `_branding.yaml` malformed handling.
- Per-edge triangles. Node triangles + global banner only.


## Success criteria

- A pure function `validateModel(model: Model): ValidationResult` exists and is exported from a new module. For every rule in the design's catalog, calling `validateModel` on a model that violates the rule produces an entry containing the expected `ruleId`, and calling it on a model that satisfies the rule produces no entry for that `ruleId`.
- `EntityError` entries carry at minimum `{ ruleId, entityId, severity: 'warning', message }`. `GlobalError` entries carry at minimum `{ ruleId, severity: 'error', omitted: { kind, id }, reason }`. The shapes are exported from the same module and consumed by every surface.
- The `RULES` registry contains an entry for every `ruleId` in the design's catalog. For any valid `ruleId`, `RULES[ruleId]` returns a non-null object with `title`, `explanation`, and `class` fields.
- `parseModels` returns `{ model, globalErrors }` where `globalErrors: GlobalError[]` lists files that failed to parse (each tagged with a `parse.*` ruleId). The returned `model` contains every entity that parsed successfully. Callers compose `[...parseResult.globalErrors, ...validation.globalErrors]` into a single `GlobalError[]` that every surface consumes — there is no separate "parse errors" lane downstream.
- Per-file YAML parse failures (`parse.invalid_yaml`, `parse.missing_id`, `parse.empty_frontmatter`) are caught inside the scan loop. A single malformed file does not reject the whole `parseModels` promise.
- A rule registry `RULES: Record<RuleId, { title, explanation, class }>` is the single lookup for human-readable rule descriptions across all surfaces.
- The validator strips Class-B references from `cleanedModel`: dangling-target edges, clusters with missing basetypes, and missing cluster members are absent from `cleanedModel.edges` / `cleanedModel.subtypeClusters`. Class-A entities remain in `cleanedModel.nodes` decorated by the matching `EntityError`.
- Classification names are canonicalized to lowercase in `cleanedModel`; the validator emits `entity.unknown_classification` for anything outside the canonical set. `dict.ts` and `App.tsx` consume the canonical lowercase form (no per-consumer recasing).
- Loading a model where an FK edge `target` does not exist produces a `GlobalError` with `ruleId: 'edge.unknown_target'`; `cleanedModel.edges` excludes that edge; the dict global banner names it; the dict source-entity row carries a triangle linking to a `#missing-<target-id>` placeholder section.
- Loading a model where `subtype.basetype` references a missing entity produces `cluster.missing_basetype`; the cluster is absent from `cleanedModel.subtypeClusters`; the global banner names it.
- Loading a model where a cluster member is missing produces `cluster.missing_member`; the member is dropped from `cleanedModel`; the basetype entity carries a triangle.
- Loading a model where `classification: kernel` is declared but `pk` contains an FK column produces `entity.classification_mismatch_dependent`; the entity renders with a triangle whose detail explains the mismatch.
- Loading a model with `pk: []` produces `entity.missing_pk`; the entity renders with a placeholder PK row.
- Loading a model with no findings produces no banners, no triangles, no panel.
- `parseModels` defaults `pk` to `[]` and `columns` to `{}` when missing in frontmatter. The `Frontmatter` and `ModelNode` types reflect this — every downstream consumer treats `pk` as always-present (possibly empty) and `columns` as always-present (possibly empty), with no need for `?` chaining or `|| []` guards at the call site.
- The static `graph` bundle calls `validateModel(window.__MODEL__)` on bootstrap in static mode; the global banner and node triangles reflect the bundle's re-validation, not just whatever was baked at build time. Opening a stale `graph.html` against the embedded model still shows current findings.
- `ignatius dict` and `ignatius graph` print findings to stderr in the format `<severity>  <ruleId>  <location>  <message>`, sorted errors-first then by rule ID then by entity id. Exit code is `1` if any errors exist, `0` if only warnings.
- In `ignatius serve`, a persistent top-right panel renders when findings > 0. The panel lists every current finding (parse + global + entity), sorted as above. The panel collapses to a `⚠ N issues` badge on user click and re-expands on click.
- On every SSE `model-changed` event in `ignatius serve`, the panel re-renders against the latest `/api/model` payload. When findings drop to zero, the panel hides entirely (no empty "all good" chrome).
- Clicking an entity-scoped finding row in the panel both (a) expands the row accordion-style to display the registry-resolved title, full explanation, and fix hint inline, and (b) pans + zooms the graph viewport to center the affected entity and makes it the active selection. The user sees the full explanation without leaving the panel and also sees which node it refers to. Clicking the node itself still opens the existing detail modal, which has its own "Issues" section — the panel and the modal are independent read surfaces. Rows for global findings (no `entityId`) expand to show explanation but do not pan or select.
- A malformed model that causes the graph initializer to throw renders the global error banner instead of a blank screen; no uncaught exception propagates to the browser console.
- The bundle distinguishes static-graph mode from live-server mode via a build-time flag injected as `window.__IGNATIUS_MODE__`. `generateGraph` injects `'static'`; the live server's HTML route (`src/server.ts`) injects `'live'`. The bundle reads the flag once on bootstrap. In `'static'` mode it calls `validateModel(window.__MODEL__)` and uses that result for all renders. In `'live'` mode it fetches `/api/model` and uses the server-computed `validation` payload (no local `validateModel` call). The two paths are mutually exclusive. Observable: viewing the page source of a static `graph.html` shows `window.__IGNATIUS_MODE__ = 'static'`; viewing the source of `ignatius serve`'s `/` shows `window.__IGNATIUS_MODE__ = 'live'`.


## Approach

`validateModel` lives in a new module `src/validate.ts`, exporting `validateModel`, the `RULES` registry, and the rule-ID + result types. `parseModels` keeps responsibility for I/O and YAML, gains the per-file try/catch for `parse.*` errors, and returns `{ model, globalErrors }` where `globalErrors` carries `parse.*` ruleIds. It does not call `validateModel`.

Callers (cli, server, generators) compose the final `GlobalError[]` for every surface as `[...parseResult.globalErrors, ...validation.globalErrors]`. There is one merged list downstream — no separate parse-error lane. The `/api/model` payload exposes both arrays uncombined (`{ model, parseGlobalErrors, validation }`) only so the React bundle can attribute findings to their source if needed; surfaces concatenate on render.

The static `graph` bundle runs `validateModel` standalone on `window.__MODEL__` when `window.__IGNATIUS_MODE__ === 'static'`. In `'live'` mode it consumes the server-computed `validation` from `/api/model` and never calls `validateModel`.

The React panel + node triangle behavior are added to the existing single-component `App.tsx`. The triangle is drawn by extending `src/markers.ts` (the existing crow's-foot canvas overlay), not per-node DOM. The panel is a new fixed-position React subcomponent.

CLI stderr printing is consolidated in `src/cli.ts` after `parseModels` + `validateModel` have run, before generator output is written.


## Checkpoints

| # | Checkpoint | Files / areas | Agent | Verifies |
|---|------------|---------------|-------|----------|
| 1 | `validateModel` core + rule registry + all Class A entity rules | `src/validate.ts` (new), `test/checks/test-validate-entity.ts` (new) | atomic-builder | `validateModel(model)` produces findings with the expected `ruleId` for every entity rule (`entity.missing_pk`, `entity.missing_columns`, `entity.invalid_field_type`, `entity.classification_mismatch_dependent`, `entity.classification_mismatch_independent`, `entity.unknown_classification`, `entity.unknown_group`, `entity.naming_not_pascal_case`, `entity.column_not_snake_case`); registry has an entry for every rule ID; `cleanedModel` preserves all Class A entities decorated by matching `EntityError`s; module has no Node imports (browser-safe — verified by `bun build:bundle`) |
| 2 | Edge + cluster validator rules + parse-time rules + parse.ts contract change | `src/validate.ts`, `src/parse.ts`, `test/checks/test-validate-refs.ts` (new) | atomic-builder | `edge.unknown_target` strips the edge from `cleanedModel`; `edge.dangling_fk_column` flags the source entity but leaves the edge; `cluster.missing_basetype` strips the cluster; `cluster.missing_member` drops the member + flags basetype; `cluster.no_discriminator` flags basetype; `parse.invalid_yaml` / `parse.missing_id` / `parse.empty_frontmatter` are caught per-file inside the scan loop (single bad file does not reject the whole promise) and returned in `parseModels`'s `globalErrors`; `pk` defaults to `[]` and `columns` to `{}` when absent in frontmatter; `Frontmatter` and `ModelNode` types updated; every existing consumer of `parseModels` (dict, App, server, cli) compiles against the new return shape; classification normalized lowercase in `cleanedModel`; `bun test/checks/test-validate-refs.ts` passes on the real `models/` directory with zero unexpected findings (any pre-existing real violations in `models/` are fixed in the same CP); `bunx tsc --noEmit` clean |
| 3 | Dict surface | `src/generators/dict.ts` | atomic-builder | Global banner at top of page (static, not sticky, red) lists the merged `GlobalError[]` (`parseResult.globalErrors` ++ `validation.globalErrors`) with registry-resolved titles; per-entity `⚠` opens a `<details>` block listing that entity's findings; FK anchors to omitted entities render as `<a class="dict-link-missing" href="#missing-<id>">`; one `#missing-<id>` placeholder section per omitted target at page bottom; dict consumes the canonical lowercase classification (the hard-coded `kernel` fallback in `dict.ts` is removed) |
| 4 | Server API contract + CLI stderr + build-time mode flag | `src/server.ts`, `src/cli.ts`, `src/generators/graph.ts`, every existing `parseModels` caller | atomic-builder | `/api/model` payload is `{ model, parseGlobalErrors, validation }`; SSE `model-changed` re-fetch returns the same shape; the live server's HTML route injects `window.__IGNATIUS_MODE__ = 'live'`; `generateGraph` injects `window.__IGNATIUS_MODE__ = 'static'`; CLI prints the merged `GlobalError[]` plus `validation.entityErrors` to stderr in the format `<severity>  <ruleId>  <location>  <message>` sorted errors-first then by ruleId then by entityId; exit code `1` if any errors, `0` if only warnings |
| 5 | Graph surface — bundle mode dispatch + degradation boundary + node triangles + global banner | `src/App.tsx`, `src/markers.ts`, `src/styles.css` | atomic-builder | (Depends on CP-4's mode-flag injection in `generateGraph` and `src/server.ts`.) Bundle reads `window.__IGNATIUS_MODE__` once on bootstrap; in `'static'` it calls `validateModel(window.__MODEL__)` and uses the result; in `'live'` it fetches `/api/model` and uses the server-computed `validation` only (no local `validateModel` call); global banner overlay at top of canvas, dismissible; entities with findings render a `⚠` corner badge via extended `markers.ts` canvas overlay; clicking a triangled node opens the existing detail modal which now includes an "Issues" section listing the entity's findings with registry-resolved titles; omitted entities absent from canvas; a malformed model that throws during graph initialization renders the global banner instead of a blank canvas, with no uncaught browser-console exception; visual check via `scripts/screenshot.ts` confirms `⚠` badges and crow's-foot FK markers coexist on the same canvas without one hiding the other |
| 6 | Live authoring panel (`ignatius serve`) | `src/App.tsx`, `src/styles.css` | atomic-builder | Persistent top-right panel renders when findings > 0; lists the merged `GlobalError[]` plus `validation.entityErrors` sorted errors-first then by ruleId then by entityId; collapses to `⚠ N issues` badge on user click and re-expands on click; re-renders on every SSE `model-changed` against the latest `/api/model` payload; clicking an entity-scoped row both expands the row inline (registry-resolved title + explanation + fix hint) and pans + zooms + selects the affected entity; clicking a global-scoped row expands the row inline only (no pan/select); panel hidden entirely when findings = 0 |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Existing callers of `parseModels` destructure a `Model` directly (e.g. `const model = await parseModels(...)`); the return-shape change to `{ model, globalErrors }` will type-error everywhere | High | CP-2 owns the contract change and must update every call site in the same commit; `bunx tsc --noEmit` is a CP-2 signal |
| Reference `models/` set may already contain rule violations (wrong classification declarations, dangling FKs); CP-2 false-positives obscure whether the rules themselves are firing correctly | Medium | Run validator against `models/` before CP-2 close; fix actual model issues first so a clean run confirms correctness |
| Bundle re-validation in static `graph.html` requires importing `validate.ts` into the React bundle; if the validator pulls a Node-only dep (e.g. `node:fs`) it will break the browser build | Medium | Keep `validate.ts` free of I/O and Node imports — type-only deps on `Model` from `parse.ts`; CP-1 includes a `bun build:bundle` signal to catch accidental Node imports |
| `⚠` node badges via `markers.ts` canvas overlay must coexist with the existing crow's-foot rendering on the same canvas; layering or repaint ordering could hide one or the other | Medium | CP-5 includes a visual-check signal via `scripts/screenshot.ts` against `test/visual/` showing a model with both badges and FK markers visible |
| Graph degradation boundary lives in CP-5 alongside bundle validation; CP-3 (dict) and CP-4 (server API + CLI) land first, so a developer running an intermediate commit against a malformed model could still white-screen the live viewer | Low | Acceptable transitional state — CP-5 closes it. CPs land in order on a single branch; no intermediate release is exposed to users. |
| Live panel SSE re-render churn if a user saves rapidly | Low | The existing SSE debounce (200ms) in `server.ts` already coalesces; no additional throttle needed |
| Classification lowercase canonicalization breaks existing model files that capitalize classification | Low | The validator normalizes on read; users authoring `Kernel` still parse correctly. Any downstream code reading raw `node.classification` was already broken by the existing parse.ts:106 capitalization vs dict.ts:15 lowercase inconsistency, which this spec fixes |


## Change log

<!-- empty during drafting; first entry on first post-approval amendment -->
