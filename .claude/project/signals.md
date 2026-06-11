# Project signals

## Framework & runtime

- Runtime: Bun (all scripts, server, test runner, binary compiler)
- Language: TypeScript (strict, ESM modules, `type: "module"` in package.json)
- Frontend: React 19, Cytoscape.js 3.31 + cytoscape-elk 2.2 + cytoscape-navigator 2.0, ELK layout engine
- Markdown parsing: markdown-it 14; YAML parsing: yaml 2.8
- No Express, no Vite, no webpack — Bun.serve + Bun HTML imports only
- Dev tools: Playwright (screenshot/SSE tests), webview-bun

## Build / test / lint

| Purpose | Command | Source |
|---------|---------|--------|
| Build compiled binary | `bun run build:cli` | package.json |
| Build React bundle only | `bun run build:bundle` | package.json |
| Rename hashed → stable names | `bun run build:stable-names` | scripts/stable-names.ts |
| Dev server (hot reload) | `bun run dev` | package.json → src/server/server.ts |
| Dev CLI (hot reload) | `bun run dev:cli` | package.json → src/cli/cli.ts serve models/key-inherited |
| Run all assertion checks | `bun run test` | package.json globs `test/checks/*.ts` |
| Run a single check | `bun test/checks/test-<name>.ts` | test/checks/ |
| Typecheck | `bun run typecheck` | package.json → `bunx tsc --noEmit` |

`build:cli` sequence: `build:bundle` → `build:stable-names` → `bun build --compile src/cli/cli.ts --outfile dist/ignatius`

`bun run test` runs a shell loop over `test/checks/*.ts` in order; exits 1 on first failure. CI (.github/workflows/ci.yml) runs every `test/checks/*.ts` via a loop (same set as `bun run test`) after building the binary.

[`test/`](../../test) is organized into subdirectories — not a formal test-framework suite:

- [`test/checks/`](../../test/checks) — 54 raw assertion scripts (PASS/FAIL/throw). Run by `bun run test` and CI. Includes `test-validate-entity.ts` and `test-validate-refs.ts` which pin `key-inherited` as the clean baseline and `broken-demo` as the broken fixture. `test-validate-refs.ts` expects 4 global + 8 entity = 12 total findings (1 additional `body.unknown_link` from `broken-demo/Order.md`'s `[[Cart]]` link). `test-api-model.ts` asserts `layoutKey` field is present in `/api/model` response. `test-layout-fingerprint.ts` (255L) and `test-layout-store.ts` (157L) pin the fingerprint / localStorage helper. `test-layout-key-injection.ts` (132L) asserts `window.__LAYOUT_KEY__` in static graph HTML. `test-wikilink.ts` covers the `[[…]]` inline rule. `test-validate-body-links.ts` covers `body.unknown_link` emission. `test-open-browser.ts` covers `browserOpenCommand` argv mapping. `test-titlelize.ts` (83L) covers `titlelize()`. `test-entity-usage-index.ts` (190L) covers `buildEntityUsageIndex()`. `test-cp5-title-override.ts` (106L) covers `title:` frontmatter override on flow externals/stores. `test-cp15-flow-kind-palette.ts` (105L) covers `resolveFlowKindPalette` defaults + YAML overrides. `test-cp16-process-examples.ts` (186L) covers `parseProcessExamples` and `FlowProcess.examples` parse round-trip. `test-cp21-flow-node-usage-index.ts` (234L) covers `buildFlowNodeUsageIndex` token-keyed map (ext:, file:, db: endpoint dedup + direction). `test-model-index.ts` (409L) covers `buildModelIndex` — all 13 maps, empty model, multi-cluster members, fkColumnsByNode derivation. `test-synthetic-model.ts` (90L) asserts `gen-synthetic-model.ts` output parses cleanly via `parseModels` with no global errors.
- [`test/visual/`](../../test/visual) — 55 Playwright screenshot scripts for manual visual inspection. NOT run by `bun run test`. Includes `screenshot-position-persist.ts` (drag→reload→restore-all-nodes + reset→ELK) and CP1–CP26 visual test scripts. `test-cp3-dfd-url-navigability.ts` (381L) covers cases A–G2. `test-cp13-external-store-parity.ts` (354L) covers external/store DD section body parity and `fromFlow` in-place navigation. `test-cp14-no-text-select.ts` (231L) covers `user-select: none` on DFD node groups. `test-cp15-kind-colors.ts` (186L) covers kind-colored store/external fills in dark + light. `test-cp16-process-examples.ts` (233L) covers process dialog example tables. `test-cp18-navigator-crash.ts` (262L) covers navigator lifecycle teardown on view-switch (CP18). `test-cp19-minimap-parity.ts` (415L) covers DFD minimap visual alignment to DG minimap (CP19). `test-cp20-io-endpoint-links.ts` (311L) covers clickable IO table endpoints in process dialogs (CP20). `test-cp21-flow-node-processes.ts` (352L) covers Processes section in external/store dialogs (CP21). `test-cp22-zoom-control.ts` (365L) covers ZoomControl on Graph view (CP22). `test-cp23-flow-zoom-control.ts` (409L) covers ZoomControl on Flows view (CP23). `test-cp24-sidebar-nesting.ts` (236L) covers hierarchical dotted-number sort + depth indent for processes in the DD sidebar (CP24). `test-cp25-dd-endpoint-links.ts` (328L) covers external/store IO endpoint links in the DD process card (CP25). `test-cp26-process-examples-in-dd.ts` (202L) covers per-process sample-data tables in the DD card (CP26). `test-cp2-preset-layout.ts` (230L) covers preset-layout cache-hit path (no ELK run when saved positions exist). `test-cp5b-edge-paint-on-load.ts` (223L) covers edge-paint texture-cache fix on initial load.
- [`test/fixtures/`](../../test/fixtures) — YAML fixtures and fixture model roots loaded by check scripts.
- [`test/notes/`](../../test/notes) — 2 markdown dev notes.

No linter or formatter configured in package.json.

## Language breakdown

| Language | LOC | Files | % |
|----------|-----|-------|---|
| TypeScript | 39242 | 207 | 67% |
| Markdown | 15036 | 203 | 46% |
| CSS | 2161 | 2 | 3% |
| YAML | 1324 | 12 | 2% |
| Shell | 116 | 1 | 0% |
| JSON | 101 | 4 | 0% |
| HTML | 27 | 2 | 0% |
| TOML | 2 | 1 | 0% |

## DevOps & CI

- CI provider: GitHub Actions ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)). Triggers on all branch pushes and PRs to master/main.
- CI pipeline: install deps → cache Playwright → build bundle + stable-names → compile binary → run all `test/checks/*.ts` → typecheck (`continue-on-error: true`).
- Release pipeline: [`.github/workflows/release-please.yml`](../../.github/workflows/release-please.yml) (release-please driven; a `build` job gated on `release_created` compiles the 5 platform binaries + checksums and attaches them to the release in the same push-to-main run). [`install.sh`](../../install.sh) (repo root) is the curl-able CLI installer that pulls those binaries from `releases/latest/download`.
- Binary is built locally or in CI via `bun run build:cli`; produces `dist/ignatius`.
- package.json `name` is `ignatius`. The repo *directory* is still named `derek-db-generator/` — the one remaining derek reference, a known leftover.

---

## Domains

| Domain | Repo paths | One-liner | Detail |
|--------|------------|-----------|--------|
| cli | [`src/cli/`](../../src/cli) | citty-based subcommand dispatch (serve/validate/export/version/update); `dict`/`graph`/`flow` are removal stubs; model-root discovery + interactive picker; port fallback + browser open on serve; self-update + version reporting | (below) |
| server | [`src/server/server.ts`](../../src/server/server.ts) | Bun.serve with `/api/model` + `/api/flow` + `/events` SSE + fs.watch live-reload; `/dict` and `/flow` redirect to unified SPA hash routes; `/flow-dict` redirects to `/#view=dict` | (below) |
| parser | [`src/model/parse.ts`](../../src/model/parse.ts), [`src/model/wikilink.ts`](../../src/model/wikilink.ts), [`src/model/model-index.ts`](../../src/model/model-index.ts) | `ignatius.yml` config loading → ParseResult: {model, globalErrors}; nodes, edges, cardinality + classification derivation; wiki-link inline rule + two-pass body rendering with bodyLinks; `buildModelIndex` — 13 O(1) lookup maps built once per Model on consume | (below) |
| validate | [`src/model/validate.ts`](../../src/model/validate.ts) | Pure model validator: RuleIds across 5 domains, two severity tiers (A=warn, B=omit); coerces invalid pk/columns to safe defaults in cleanedModel | (below) |
| flows | [`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts), [`src/flows/flow-validate.ts`](../../src/flows/flow-validate.ts), [`src/flows/flow-fingerprint.ts`](../../src/flows/flow-fingerprint.ts), [`src/flows/flow-usage-index.ts`](../../src/flows/flow-usage-index.ts), [`src/flows/titlelize.ts`](../../src/flows/titlelize.ts), [`src/flow-view/flow-layout.ts`](../../src/flow-view/flow-layout.ts) | SSADM data flow diagrams: `parseFlows` (recursive sub-DFDs, `_externals/`/`_stores/` with `kind:`+`title:` frontmatter, `displayName`, `titlelize`), `parseProcessExamples` (in/out example tables), `validateFlows` (11 `flow.*` rules), `buildFlowLayoutKeys`, `buildEntityUsageIndex` (entity↔process cross-reference); `extKind`/`storeKind` on layout node data for kind-colored fills; `ignatius flow` is a removal stub. See [`docs/spec/process-flows.md`](../../docs/spec/process-flows.md). | (below) |
| frontend | [`src/app/`](../../src/app) | React 19 unified SPA (Graph/Dictionary/Flows views) decomposed into a layered [`src/app/`](../../src/app) tree; shell (`App.tsx`) owns state + composition; views own cy/SVG lifecycle; components handle entity/process/flow-node rendering; hooks manage model data, hash routing, and theme; logic/ and dom/ are pure utilities | (below) |
| generators | [`src/generators/`](../../src/generators) | Unified static HTML export via `generateApp` (single file — graph + dict + flows); [`src/generators/app.ts`](../../src/generators/app.ts) is the sole static generator; [`src/generators/embedded-bundle.ts`](../../src/generators/embedded-bundle.ts) loads the React bundle. Separate `dict.ts`, `graph.ts`, `flow-graph.ts`, `flow-dict.ts`, `inline-asset.ts`, `theme-css.ts` were removed when the SPA was unified. | (below) |
| theme | [`src/theme/`](../../src/theme) | ThemeConfig + Branding types, default palettes, dark/light merging | (below) |
| skill | [`skills/noorm-modeling/`](../../skills/noorm-modeling) | Project-scoped Claude skill: Q&A-driven entity authoring + model bootstrap, convention-aware, writes files + verifies with `ignatius validate` | (below) |
| docs | [`docs/`](../../docs) | Design docs, specs, guides, glossary. Includes [`docs/spec/unified-app-polish.md`](../../docs/spec/unified-app-polish.md) (CP1–CP13 batch spec), [`docs/spec/dfd-polish-round2.md`](../../docs/spec/dfd-polish-round2.md) (CP14–17 batch spec), [`docs/spec/dfd-polish-round3.md`](../../docs/spec/dfd-polish-round3.md) (CP18–23 batch spec), [`docs/spec/process-flows.md`](../../docs/spec/process-flows.md) (637L comprehensive flow spec), [`docs/spec/render-perf-indexing.md`](../../docs/spec/render-perf-indexing.md) (202L render-perf spec: ELK skip/worker + ModelIndex), and [`docs/glossary.md`](../../docs/glossary.md) (canonical DG/DD/DFD/DE/DS/EE vocabulary). | (below) |
| scripts | [`scripts/`](../../scripts) | Build helpers: stable-names.ts, convert-yaml-to-md.ts, probe.ts, screenshot.ts; perf tooling: gen-synthetic-model.ts (synthetic IDEF1X model generator), perf-harness.ts (Playwright-based render latency measurement) | (below) |

## Domain detail

### cli

[`src/cli/cli.ts`](../../src/cli/cli.ts) is the binary entry point. Eight subcommands registered: `serve`, `server` (alias for serve), `dict`, `graph`, `validate`, `flow`, `export`, `version`, `update`. `dict`, `graph`, and `flow` are removal stubs — each prints "Removed — use: ignatius export -o model.html" to stderr and exits 1. Active model subcommands: `serve`, `validate`, `export`.

`serve` accepts optional positional `[path]` and `--port`/`-p`, `--model`, `--open`/`-o` flags. Delegates binding to `serveWithPortFallback` in [`src/cli/serve-port.ts`](../../src/cli/serve-port.ts). When the requested port is taken (`EADDRINUSE`), TTY prompts via `@clack/prompts` text defaulting to the next free port; non-TTY auto-advances. After binding, `--open` dynamically imports [`src/cli/open-browser.ts`](../../src/cli/open-browser.ts) and calls `openBrowser`.

`export` subcommand: parses entity model via `parseModels()`, validates with `validateModel()`, then parses flows via `parseFlows()` if a `flows/` directory exists, validates with `validateFlows()`. Loads the embedded React bundle via `loadEmbeddedBundle()`, calls `generateApp(model, flowModel, bundle, { themeMode })` from [`src/generators/app.ts`](../../src/generators/app.ts), writes a single HTML file. Exit code 1 when any entity global errors OR flow Class-B errors are present.

`validate` subcommand: same `parseModels` → `validateModel` → optional `parseFlows` + `validateFlows` flow, prints findings to stderr, prints a one-line stdout summary (`✓`/`✗`). Exit code 1 on errors.

[`src/cli/open-browser.ts`](../../src/cli/open-browser.ts) exports `browserOpenCommand(platform, url): string[]` (pure) and `openBrowser(url, platform?)` (fire-and-forget `Bun.spawn`). Dynamically imported only on `--open`.

[`src/cli/version.ts`](../../src/cli/version.ts) exports `VERSION` from a JSON import of [`package.json`](../../package.json) — Bun inlines it at `--compile` time.

[`src/cli/update.ts`](../../src/cli/update.ts) powers `update` (flags `--check`, `--yes`/`-y`). Resolves latest tag via `releases/latest` redirect Location header, compares semver, on consent downloads + verifies sha256, atomically renames over `process.execPath`. Guards: dev runtime → no self-replace; win32 → manual-download message; non-TTY without `--yes` → report-only.

[`src/cli/discover.ts`](../../src/cli/discover.ts) — pure model-root resolver. Exports `resolveModel(base, opts): Promise<ResolveResult>` and `ModelCandidate` / `ResolveResult` types. Algorithm: (1) base itself has `ignatius.yml` → single; (2) search down (skipping `_*`, `node_modules`, `.git`, `dist`, `tmp`, [`trash`](../../trash), `.worktrees`, [`.claude`](..)); (3) walk up; (4) exactly 1 → single; (5) multiple + `--model` → filter; (6) multiple + no key → many. `ResolveResult` discriminated union: `single | many | no-match | none`.

[`src/cli/resolve-model.ts`](../../src/cli/resolve-model.ts) — exports `pickModel(base, modelKey): Promise<string>`. Handles all four result kinds: single → return dir; none/no-match → stderr + exit 1; many + non-TTY → stderr key list + exit 2; many + TTY → `@clack/prompts` select picker (cancel → exit 130).

### server

[`src/server/server.ts`](../../src/server/server.ts) exports `serveCommand(modelsDir, opts)` returning `{ server, stop }`. Routes:

- `GET /` → bundled React HTML (unified SPA)
- `GET /dict` → 302 redirect to `/#view=dict`
- `GET /flow` → 302 redirect to `/#view=flow`
- `GET /flow-dict` → 302 redirect to `/#view=dict` (CP5 — process dictionary fused into Dictionary view)
- `GET /api/model` → JSON `{ model, parseGlobalErrors, validation, layoutKey }` where `validation = { entityErrors, globalErrors, cleanedModel }` and `layoutKey = layoutFingerprint(model)`
- `GET /api/flow` → JSON `{ diagrams, entityModel, validation, flowLayoutKeys }`. Guard: if no `flows/` directory returns empty-state 200. `entityModel` travels with the payload so the flow viewer can resolve `db:` store docs to ERD entity narratives.
- `GET /api/asset` → model-dir asset proxy (path traversal blocked)
- `GET /events` → SSE stream; timeout disabled via `server.timeout(req, 0)`

`fs.watch` watches `modelsDir` recursively; only `.md` and `.yaml` extensions trigger events. Debounce: 200ms coalesce. SSE event name: `model-changed`. `stop()` closes the watcher, clears debounce timer, clears SSE client set, stops Bun server.

### parser

[`src/model/parse.ts`](../../src/model/parse.ts) exports `parseModels(dir): Promise<ParseResult>`. `ParseResult = { model: Model; globalErrors: GlobalError[] }`. Config loading: reads `ignatius.yml`; top-level keys populate `_meta`; `theme:` deep-merged via `mergeTheme()`; `branding:` merged via `mergeBranding()`. `Model` type: `{ groups, nodes, edges, subtypeClusters, theme, branding, _meta? }`. Entity classification fully derived (5-rule order): Classifier → Subtype → Associative → Dependent → Independent. `identifying` per edge also derived. `deriveCardinality()` uses derived `identifying` + nullability + AK membership. Body markdown rendered to HTML via markdown-it at parse time.

**Wiki-links (two-pass body rendering):** `ModelNode` carries `bodyLinks?: string[]`. Body rendering deferred to a second pass after all entity ids are known. [`src/model/wikilink.ts`](../../src/model/wikilink.ts) exports `WikiLinkEnv`, `splitWikiTarget`, and `wikiLinkPlugin(md)`. Valid links emit `<a class="entity-link" data-entity="…">…</a>`; unknown links emit `<span class="entity-link entity-link--missing" …>`. Absent `knownIds` → optimistic.

**Predicates:** `Predicate = { fwd: string; rev: string }` and `normalizePredicate(raw): Predicate`. `ModelEdge.predicate` is always a normalized `Predicate`.

**ModelIndex ([`src/model/model-index.ts`](../../src/model/model-index.ts), 222L):** exports `buildModelIndex(model: Model): ModelIndex` and `endpointKey(source, target): string`. Pure module — no Bun/Node/DOM imports; browser-safe; same discipline as `validate.ts`. `ModelIndex` carries 13 maps:
- `nodeById: Map<string, ModelNode>` — O(1) node lookup by id
- `nodeIdSet: Set<string>` — O(1) membership tests
- `edgesBySource: Map<string, ModelEdge[]>` — edges keyed by source node id
- `edgesByTarget: Map<string, ModelEdge[]>` — edges keyed by target node id
- `edgeByEndpointPair: Map<string, ModelEdge>` — edge keyed by `"source>target"` token (produced by `endpointKey`)
- `pkByNode: Map<string, string[]>` — pk column names per node
- `columnsByNode: Map<string, Record<string, ColumnDef>>` — declared columns per node
- `akColumnsByNode: Map<string, Set<string>>` — AK-participating column names per node (absent when no AKs)
- `fkColumnsByNode: Map<string, Set<string>>` — FK column names (from `edge.on` keys) per source node (absent when no outgoing edges)
- `subtypeMemberToCluster: Map<string, SubtypeCluster>` — first-wins cluster for a member id
- `clustersByMemberId: Map<string, SubtypeCluster[]>` — all clusters for a member (multi-cluster support)
- `basetypeClusterById: Map<string, SubtypeCluster>` — cluster keyed by basetype id
- `nodesByGroup: Map<string, ModelNode[]>` — nodes grouped by `node.group`

Build-on-consume contract: Maps do not survive JSON serialization. Call `buildModelIndex` wherever a Model enters a consumer (after `parseModels`, after SSE `model-changed`, after reading `window.__MODEL__`). Never serialize the index or attach it to a JSON payload. Empty model → all maps empty, no throw.

### validate

[`src/model/validate.ts`](../../src/model/validate.ts) — pure module with no Node/Bun I/O; imports only types from `./parse`. Browser-safe and unit-testable with plain Model literals.

Exports: `validateModel(model: Model): ValidationResult`, `formatFindingsForStderr(globalErrors, entityErrors, flowErrors?): string[]`, `RULES: Record<RuleId, RuleEntry>`, types `RuleId`, `EntityError`, `GlobalError`, `ValidationResult`, `RuleEntry`.

`RuleId` union: 14 rules across 4 domains — parse (`parse.invalid_yaml`, `parse.missing_id`, `parse.empty_frontmatter`), entity (`entity.missing_pk`, `entity.missing_columns`, `entity.invalid_field_type`, `entity.unknown_group`, `entity.example_unknown_column`), body (`body.unknown_link`), edge (`edge.unknown_target`, `edge.dangling_fk_column`), cluster (`cluster.missing_basetype`, `cluster.missing_member`, `cluster.no_discriminator`).

`RuleEntry.class`: `'A'` = render degraded + warning triangle; `'B'` = omit + global banner. `RuleEntry.liveOnly?: boolean` — only `entity.example_unknown_column` carries this flag. `body.unknown_link` is Class A, not `liveOnly`.

`ValidationResult = { entityErrors: EntityError[]; globalErrors: GlobalError[]; cleanedModel: Model }`. `cleanedModel` has dangling edges and broken clusters removed, AND nodes with invalid pk/columns coerced to safe defaults.

`RULES` is a `Record<RuleId, RuleEntry>` — TypeScript compile-errors if any RuleId is missing an entry.

`formatFindingsForStderr` accepts optional `flowErrors` third param so CLI callers can pass combined entity + flow findings in a single call. Sorts rows: errors before warnings, ruleId alphabetical, location alphabetical.

### flows

[`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts) (755L) — SSADM data flow diagram parser. Exports `parseFlows(dir): Promise<FlowParseResult>`, `parseProcessExamples()`, types `FlowModel`, `FlowDiagram`, `FlowProcess`, `FlowExternal`, `FlowStoreRef`, `FlowEdge`, `FlowEndpoint`, `FlowExample`, `FlowExampleRow`, `FlowParseResult`.

`FlowStoreRef.displayName` — human-readable display label resolved as: `title:` frontmatter override → `titlelize(name)` from [`src/flows/titlelize.ts`](../../src/flows/titlelize.ts). `FlowExternal` display label similarly resolved: `title:` frontmatter → `external:` value → `titlelize(id)`.

`FlowExternal.kind?: FlowStoreRef['kind']` — optional `kind:` from `_externals/*.md` frontmatter. Absent → conventional green (no visual regression). Present → kind-colored fill in `FlowDiagramSvg`.

`FlowProcess.examples?: { in: FlowExample[]; out: FlowExample[] }` — optional per-process in/out data examples parsed from `examples:` frontmatter. `FlowExample = { from?, to?, label?, rows: FlowExampleRow[] }`. `FlowExampleRow = Record<string, string | number | boolean>`. `parseProcessExamples(raw)` is an exported pure function (used by tests directly and called internally during process file parsing).

`FlowDiagram.title` — always `titlelize(id)` at parse time; `id` is the stable routing key. Non-entity stores carry `kind:` frontmatter (`cache`, `queue`, `file`, `doc`, `manual`, `other`); `_stores/*.md` files read `kind:` and `title:` from frontmatter.

[`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts) imports `titlelize` from [`src/flows/titlelize.ts`](../../src/flows/titlelize.ts) and `wikiLinkPlugin` from [`src/model/wikilink.ts`](../../src/model/wikilink.ts). Flow markdown bodies (`[[Target]]` links) are rendered optimistically — every target becomes a navigable anchor, resolved at click time.

[`src/flows/titlelize.ts`](../../src/flows/titlelize.ts) — exports `titlelize(slug: string): string`. Pure, framework-free. Rules: split on hyphens/underscores, then split within segments at camelCase/ACRONYM/digit boundaries, title-case each word, join with spaces. Example: `order-to-cash` → `"Order To Cash"`, `HTTPRequest` → `"HTTP Request"`.

[`src/flows/flow-usage-index.ts`](../../src/flows/flow-usage-index.ts) — two exports. `buildEntityUsageIndex(diagrams: FlowDiagram[]): Map<string, ProcessUsage[]>` — unchanged; maps bare entity id → `ProcessUsage[]`; only `db:` endpoints count; used by `SelectedEntityModal`'s Processes section. `buildFlowNodeUsageIndex(diagrams: FlowDiagram[]): Map<string, ProcessUsage[]>` (CP21) — token-keyed superset; maps `"kind:name"` token (e.g. `"ext:Customer"`, `"file:gateway-log"`, `"db:Payment"`) → `ProcessUsage[]`; covers ALL non-`proc` endpoint kinds; same dedup + direction logic. Both walk diagrams recursively including sub-DFDs. `ProcessUsage` carries `processId`, `processLabel`, `dottedNumber`, `dfdId`, `dfdTitle`, `direction`. `buildEntityUsageIndex` imported by [`src/app/App.tsx`](../../src/app/App.tsx); `buildFlowNodeUsageIndex` imported by [`src/app/views/flow/FlowsView.tsx`](../../src/app/views/flow/FlowsView.tsx).

[`src/flow-view/flow-layout.ts`](../../src/flow-view/flow-layout.ts) (475L) — `FlowElementData` node variant carries `extKind?: FlowKindKey` (for externals with optional kind) and `storeKind?: FlowKindKey` (for all store-kind nodes). These fields are read by `FlowDiagramSvg` to select the kind-colored fill from `kindPalette`.

[`src/flow-view/FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx) (1422L) — accepts two new props: `onZoomChange?: (scale: number) => void` (fires on every scale state change via `useEffect`) and `onRegisterZoomControl?: (ctrl: { zoomTo(scale: number): void; resetFit(): void } | null) => void` (fires after first render with imperative handles, fires with `null` on unmount). Wheel zoom delta tamed to `0.95`/`1.05` per tick (previously `0.9`/`1.1` — CP23).

[`src/flow-view/FlowChrome.tsx`](../../src/flow-view/FlowChrome.tsx) (409L) — `.flow-minimap-wrapper` left offset aligned to 16px (matching DG `.minimap` left offset when DFD nav is hidden); minimap label removed from DOM (CP19). `FlowChromeHandle` and `FlowChromeProps` types unchanged.

[`src/flows/flow-validate.ts`](../../src/flows/flow-validate.ts) (640L) — exports `validateFlows(flowModel, model, config): FlowValidationResult`. 11 `flow.*` rules including recursive data-level balancing. `FlowError` type.

[`src/flows/flow-fingerprint.ts`](../../src/flows/flow-fingerprint.ts) (90L) — exports `buildFlowLayoutKeys(flowModel): Record<string, string>`. Returns a map of diagram id → structural fingerprint for every diagram in the tree (top-level and sub-DFDs). Used by server `/api/flow` and `generateApp`.

[`models/key-inherited/flows/order-to-cash/_stores/gateway-log.md`](../../models/key-inherited/flows/order-to-cash/_stores/gateway-log.md) — demo non-entity store with `kind: file` and `title: Payment Gateway Log` frontmatter; used to exercise non-`db` store parsing and display.

### frontend

`src/App.tsx` was decomposed from a 5241L monolith into a layered [`src/app/`](../../src/app) tree. The entry point is now [`src/app/App.tsx`](../../src/app/App.tsx) (483L). [`src/app/main.tsx`](../../src/app/main.tsx) is the React entry point. Layer rule: shell → views → components → ui → logic/dom (downward only).

**Layer map:**

- **Shell** — [`src/app/App.tsx`](../../src/app/App.tsx) (483L): state, view-switch, modal hosting, composition. Owns `openEntityById` (with `fromFlow` flag), `modelIndex` + `modelIndexRef` useMemo/ref pair, `appErrorsByEntityId` Map, `appAllFlowNodeIds`, `entityUsageIndex` useMemo, and `pendingScrollProcessIdRef` for dict process-scroll. Interacts with GraphView and FlowsView exclusively through typed imperative handles (`GraphViewHandle`, `FlowsViewHandle`).

- **Hooks:**
  - [`src/app/hooks/useModelData.ts`](../../src/app/hooks/useModelData.ts) (158L) — exports `useModelData(opts?)`. Unified SSE subscription + model/flow fetch + findings state. Static mode: reads `window.__MODEL__` / `__FLOW_MODEL__` once on mount. Live mode: boots with parallel `/api/model` + `/api/flow`, then re-fetches on every `model-changed` SSE event. Returns `{ model, findings: ModelFindings, flowDiagrams, flowFindings: FlowFindings, layoutKeyRef, bannerDismissed, setBannerDismissed }`. Exports `ModelFindings` and `FlowFindings` types.
  - [`src/app/hooks/useHashRoute.ts`](../../src/app/hooks/useHashRoute.ts) (64L) — exports `useHashRoute(opts?)`. Owns hash read/write and `popstate` back/forward restoration. Seeds from `location.hash` on mount. Accepts `onRestoreDfd` callback for DFD deep-link restore. Returns `{ view, setView }`.
  - [`src/app/hooks/useThemeMode.ts`](../../src/app/hooks/useThemeMode.ts) (30L) — exports `useThemeMode(themeConfig?)`. Seeds from `window.__THEME_MODE__` or localStorage. Calls `applyThemeCssVars` on change. Returns `{ themeMode, toggleTheme }`.

- **Logic (pure, no DOM/React):**
  - [`src/app/logic/doc-resolver.ts`](../../src/app/logic/doc-resolver.ts) (125L) — exports `buildFlowDocResolver(diagrams, getEntityModel)` and `splitDocToken(token)`. `FlowDocResult` discriminated union: `entity` / `node` / `doc`. Resolver is keyed by stable id/slug — `title:` overrides on externals/stores do not break `[[wiki-link]]` resolution. Accepts a getter for live model so SSE-updated entity-id set is always current.
  - [`src/app/logic/flow-node-ids.ts`](../../src/app/logic/flow-node-ids.ts) (28L) — exports `buildAllFlowNodeIds(diagrams, entityModel?)`. Returns `ReadonlySet<string>` merging all process/external/non-db-store ids with ERD entity ids. Used by `FlowNodeModal` and the flow-opened `SelectedEntityModal` upgrade pass.
  - [`src/app/logic/color.ts`](../../src/app/logic/color.ts) — exports `hexToRgba` and `blendHex`. Used by `EntityModal` (RGBA tint) and `theme-css-vars.ts` (surface-alt blend).
  - [`src/app/logic/search.ts`](../../src/app/logic/search.ts) — DD CSS Custom Highlight search logic.
  - [`src/app/logic/finding-rows.ts`](../../src/app/logic/finding-rows.ts) — finding row formatting logic extracted from FindingsPanel.

- **DOM helpers:**
  - [`src/app/dom/body-links.ts`](../../src/app/dom/body-links.ts) (69L) — exports `resolveBodyClick(e, scrollFn)` (shared body-click handler for entity/process/external/store DD body divs — intercepts `a[data-entity]` and `.entity-link--missing` spans) and `upgradeMissingLinksInContainer(container, knownIds)` (rewrites `.entity-link--missing` spans to live `<a>` anchors after body render when the target id is now known).
  - [`src/app/dom/theme-css-vars.ts`](../../src/app/dom/theme-css-vars.ts) (57L) — exports `applyThemeCssVars(theme, mode)`. Sets all CSS custom properties on `document.documentElement`. Called by `useThemeMode`.

- **UI components:**
  - [`src/app/components/ui/Modal.tsx`](../../src/app/components/ui/Modal.tsx) — shared modal primitive (title + onClose + children).
  - [`src/app/components/ui/ZoomControl.tsx`](../../src/app/components/ui/ZoomControl.tsx) (66L) — view-agnostic `ZoomControl` component. Props: `percent`, `onZoomIn`, `onZoomOut`, `onSetPercent(pct)`, `onReset`. Clicking the readout opens an inline text input (commit on Enter/blur, cancel on Escape). CSS class `.zoom-control`. Rendered by shell for both Graph and Flows views.
  - [`src/app/components/ui/FabMenu.tsx`](../../src/app/components/ui/FabMenu.tsx) — per-view FAB menus. Items are view-gated (graph/dict/flow-specific items not rendered for other views).

- **Entity components:**
  - [`src/app/components/entity/EntityModal.tsx`](../../src/app/components/entity/EntityModal.tsx) (129L) — exports `SelectedEntityModal`. Props: `selected`, `model`, `nodeById`, `nodeIdSet`, `entityErrors`, `onClose`, `onNavigate`, `processUsages`, `onNavigateToProcess`, `allFlowNodeIds`. `fromFlow` context is passed as `allFlowNodeIds` being set — when present, runs `upgradeMissingLinksInContainer` for wiki-link upgrade.
  - [`src/app/components/entity/EntityCard.tsx`](../../src/app/components/entity/EntityCard.tsx) (139L) — exports `DictEntitySection`. Used by `DictionaryView` for the dict entity card.
  - [`src/app/components/entity/ClassificationBadge.tsx`](../../src/app/components/entity/ClassificationBadge.tsx) — exports `DictClassificationBadge`.
  - [`src/app/components/entity/ColumnsTable.tsx`](../../src/app/components/entity/ColumnsTable.tsx) — columns table with `variant='modal'|'dict'`.
  - [`src/app/components/entity/ChildrenTable.tsx`](../../src/app/components/entity/ChildrenTable.tsx) — children/subtype table with `variant='modal'|'dict'`.
  - [`src/app/components/entity/ExamplesAccordion.tsx`](../../src/app/components/entity/ExamplesAccordion.tsx) — examples accordion with `variant='modal'|'dict'`.

- **Process components:**
  - [`src/app/components/process/IoTable.tsx`](../../src/app/components/process/IoTable.tsx) (134L) — exports `FlowIoTable`. Props include `onOpenToken?` / `canOpenToken?` for clickable non-`db` endpoint cells (CP20).
  - [`src/app/components/process/KindMarker.tsx`](../../src/app/components/process/KindMarker.tsx) — exports `FlowKindMarker`.
  - [`src/app/components/process/ProcessExamples.tsx`](../../src/app/components/process/ProcessExamples.tsx) — exports `FlowProcessExamplesSection`. Renders per-process in/out example tables (CP16).
  - [`src/app/components/process/ProcessCard.tsx`](../../src/app/components/process/ProcessCard.tsx) — process DD card (`DictProcessSection`), renders `FlowIoTable` + `FlowProcessExamplesSection` (CP26).
  - [`src/app/components/process/ProcessesTable.tsx`](../../src/app/components/process/ProcessesTable.tsx) — exports `DictProcessesTable`. Entity→process cross-reference table shown in entity modal and DD.
  - [`src/app/components/process/ProcessesSection.tsx`](../../src/app/components/process/ProcessesSection.tsx) (43L) — exports `ProcessesSection`. Renders inside `SelectedEntityModal` and `FlowNodeModal` when `processUsages` present.

- **Flow-node components:**
  - [`src/app/components/flow-node/FlowNodeModal.tsx`](../../src/app/components/flow-node/FlowNodeModal.tsx) (119L) — structured flow node dialog (process / external / non-`db` store). Accepts `nodeUsageIndex?` (token-keyed, from `buildFlowNodeUsageIndex`) to render `<ProcessesSection>` for external/store nodes (CP21). Body uses `.dict-entity-body` class for wiki-link style parity (CP13).
  - [`src/app/components/flow-node/FlowDocModal.tsx`](../../src/app/components/flow-node/FlowDocModal.tsx) — plain markdown doc dialog for unresolved wiki-links.
  - [`src/app/components/flow-node/ExternalCard.tsx`](../../src/app/components/flow-node/ExternalCard.tsx) — external node card rendered inside `FlowNodeModal`.
  - [`src/app/components/flow-node/StoreCard.tsx`](../../src/app/components/flow-node/StoreCard.tsx) — non-`db` store card rendered inside `FlowNodeModal`.

- **Findings:**
  - [`src/app/components/findings/FindingsPanel.tsx`](../../src/app/components/findings/FindingsPanel.tsx) (93L) — `<FindingsPanel>` renders only when `totalFindings > 0`; collapses to badge; present across all three views.

- **Views:**
  - [`src/app/views/graph/GraphView.tsx`](../../src/app/views/graph/GraphView.tsx) (842L) — exports `GraphView` (forwardRef) and `GraphViewHandle` + `LayoutMode` types. Owns full cy lifecycle, navigator lifecycle, zoom adapter, hash wiring, preset-layout cache-skip, ELK cost scaling. `GraphViewHandle` exposes: `navigateToEntity`, `panelNavigate`, `resetLayout`, `applyLayoutMode`, `zoomIn`, `zoomOut`, `setPercent`, `resetZoom`, `retheme`. Navigator lifecycle is gated on `isActive` to prevent the CP18 crash (ResizeObserver calling `cy.boundingBox()` on a destroyed core). `wheelSensitivity: 0.2` passed to cytoscape. 100% = fit-to-view baseline.
  - [`src/app/views/graph/organic-layout.ts`](../../src/app/views/graph/organic-layout.ts) — ELK thoroughness ladder constants (`LAYERED_THOROUGHNESS_TINY/SMALL/MEDIUM/LARGE`), organic iter constants, layout helpers (`fanSubtypeClusters`, `arrangeOrganic`, `deoverlapNodes`, etc.). ELK node-count tiers: `<50→full`, `50–100→20`, `100–200→14`, `200+→7`.
  - [`src/app/views/graph/navigator.ts`](../../src/app/views/graph/navigator.ts) — `mountNavigator` / `teardownNavigator` / `NavigatorInstance` — cytoscape-navigator lifecycle helpers extracted from GraphView.
  - [`src/app/views/graph/styles.ts`](../../src/app/views/graph/styles.ts) — `buildStyles(themeMode, semanticColors)` → cytoscape stylesheet array.
  - [`src/app/views/dict/DictionaryView.tsx`](../../src/app/views/dict/DictionaryView.tsx) (720L) — `DictionaryView` component. Keep-mounted via CSS `display:none`. Owns DD CSS Custom Highlight search (CP9), `beforeprint`/`afterprint` (CP10), DD sidebar process nesting with `compareDottedProcesses` (CP24), DD card endpoint clickability `externalIds`/`nonDbStoreNames` O(1) sets (CP25).
  - [`src/app/views/flow/FlowsView.tsx`](../../src/app/views/flow/FlowsView.tsx) (766L) — exports `FlowsView` (forwardRef) and `FlowsViewHandle` type. Owns `FlowChrome` chrome + imperative SVG renderer lifecycle. Calls `buildFlowDocResolver` + `buildAllFlowNodeIds` + `buildFlowNodeUsageIndex`. `FlowsViewHandle` exposes: `selectDiagramById`, `resetLayout`, `zoomIn`, `zoomOut`, `setPercent`, `resetZoom`, `openFlowToken`. DFD URL deep-link: `selectDiagramById` uses `findDiagramPath` to build the full breadcrumb stack (survives page refresh). Calls `onZoomPercentChange` for the shell's Flows ZoomControl (CP23). SVG wheel delta tamed to `0.95`/`1.05` per tick.
  - [`src/app/views/flow/LegendModal.tsx`](../../src/app/views/flow/LegendModal.tsx) (204L) — `LegendModal` component. Renders "Data store kinds" section when `view === 'flow'`. Accepts `kindPalette?: Record<FlowKindKey, FlowKindEntry>`; falls back to `resolveFlowKindPalette(themeMode)` when absent.

- **Globals:** [`src/app/globals.d.ts`](../../src/app/globals.d.ts) (46L) — `window.__MODEL__`, `window.__THEME_MODE__`, `window.__IGNATIUS_MODE__` ('live'|'static'), `window.__LAYOUT_KEY__`, `window.__FLOW_MODEL__`, `window.__FLOW_LAYOUT_KEYS__`, `window.__IGNATIUS_CY__`, `window.__IGNATIUS_CY_GEN__`, `window.__IGNATIUS_FLOW_READY__`, `window.__IGNATIUS_FLOW_GEN__`, `window.__IGNATIUS_ACTIVE_FLOW_DFD__`, `window.__IGNATIUS_PERF__`.

**View routing:** [`src/app/hash-router.ts`](../../src/app/hash-router.ts) exports `parseHash` / `serializeHash`. `HashState` carries `view?: 'graph' | 'dict' | 'flow'`, `entity?`, `zoom?`, `pan?`, and `dfd?`. Format: `#view=<graph|dict|flow>&entity=<id>&zoom=<n>&pan=<x>,<y>&dfd=<diagram-id>`. `useHashRoute` hook owns the popstate listener and hash write.

**`fromFlow` context flag (CP13):** `openEntityById(id, fromFlow = false)` in the shell accepts a second parameter. When `fromFlow = true`, `entityModalOpenedFromFlow` state is set; the modal's FK links, body `[[wiki-links]]`, and process-usage links stay in-place over the Flows view. The flag is preserved across chained entity-to-entity navigations via `openEntityById(id, true)` in `onNavigate`.

**Kind-colored stores/externals (CP15):** `FlowsView` calls `resolveFlowKindPalette(themeMode, themeConfig?.flowKinds)` and passes `kindPalette` into `FlowDiagramSvg`. The SVG renderer reads `extKind`/`storeKind` from `FlowElementData` node data and indexes `kindPalette` to set `bg`/`fg`/`border` fill colors.

**ModelIndex wiring:** `buildModelIndex(model)` is called once per Model in the shell (`App.tsx`) via `useMemo`. `modelIndexRef` mirrors the live value for cy-init closures. Per-click entity resolution, Dictionary `nodesByGroup` scans, cluster-wiring element lookup, and error-badge lookups all use index maps rather than `.find`/`.filter`/`.includes` over arrays.

**Preset-layout cache-skip (L1):** on a repeat graph load whose `layoutKey` matches a saved position set in `layout-store`, cy is constructed with `layout: { name: 'preset' }` and saved positions applied — ELK does not run. Implemented in `GraphView.tsx`.

**Graph node position persistence:** [`src/model/layout-fingerprint.ts`](../../src/model/layout-fingerprint.ts) exports `layoutFingerprint(model: Model): string` — FNV-1a 32-bit hash over sorted node ids + sorted `source>target` edge pairs. [`src/app/views/graph/layout-store.ts`](../../src/app/views/graph/layout-store.ts) exports `createLayoutStore(storage?, now?): LayoutStoreHandle` — single localStorage key `ignatius-layout-positions`; newest-10 pruning on `save`.

**Warning badges:** [`src/app/views/graph/markers.ts`](../../src/app/views/graph/markers.ts) exports `drawWarningBadges(cy, svg, entityIds: Set<string>)`. Called by `GraphView`.

**Node sizing + label wrapping:** `wrapEntityLabel` ([`src/app/views/graph/wrap-label.ts`](../../src/app/views/graph/wrap-label.ts)) — underscores → spaces; names longer than ~13 chars break at PascalCase/acronym/digit boundaries. Called by `GraphView`.

[`src/types/css-highlight.d.ts`](../../src/types/css-highlight.d.ts) — ambient declarations for CSS Custom Highlight API (`Highlight`, `HighlightRegistry`, `CSS.highlights`). Shadows `lib.dom` `CSS` global; remove once TypeScript ships native declarations (tracked at microsoft/TypeScript#53003).

[`src/app/styles.css`](../../src/app/styles.css) additions: `@media print` block for the Dictionary view (CP10), `::highlight(dd-search-highlight)` rule (CP9), `.dict-process-direction` / `.dict-process-direction--read/write/readwrite` direction badges, `--dd-search-highlight` + direction-badge theme vars, `.flow-minimap-wrapper` matched to `.minimap` (left: 16px when DFD nav hidden, matching DG minimap — CP19), `.zoom-control` + child rules for both view adapters (CP22/CP23).

### generators

[`src/generators/app.ts`](../../src/generators/app.ts) (121L) — the sole static HTML generator. `generateApp(model, flowModel, bundle, opts)` writes ONE unified SPA file. Injects the full union of globals: `window.__IGNATIUS_MODE__ = "static"`, `window.__MODEL__`, `window.__FLOW_MODEL__`, `window.__LAYOUT_KEY__`, `window.__FLOW_LAYOUT_KEYS__`, `window.__THEME_MODE__`. `escapeScriptClose` sanitizes injected HTML (flow body markdown can contain `</script>`). `loadBundleFromDir` is imported from `embedded-bundle.ts`. Old separate generators (`dict.ts`, `graph.ts`, `flow-graph.ts`, `flow-dict.ts`, `inline-asset.ts`, `theme-css.ts`) were removed when the SPA was unified.

[`src/generators/embedded-bundle.ts`](../../src/generators/embedded-bundle.ts) (119L) — imports `dist/static/index.html`, `dist/static/index.js`, `dist/static/index.css` as file imports (`with { type: 'file' }`). `loadEmbeddedBundle()` calls `Bun.file().exists()` on all three paths; throws a friendly error with "Run: bun run build:bundle" when missing. Exports `BundleContent` type and `loadBundleFromDir(dir)`.

### theme

[`src/theme/theme-defaults.ts`](../../src/theme/theme-defaults.ts) exports `defaultTheme: ThemeConfig`, `mergeTheme()`, `semanticColors`, `resolveFlowKindPalette()`, `defaultFlowKinds`, `FLOW_KIND_KEYS`, and the `ThemeConfig`/`ThemePalette`/`ThemeSpacing`/`FlowKindEntry`/`FlowKindKey` types. `semanticColors` maps classification names to `{ bg, fg }` pairs per mode. `mergeTheme()` deep-merges a partial user theme over the defaults including the `flowKinds` override map. The `ThemeConfig` type is re-exported from [`src/model/parse.ts`](../../src/model/parse.ts).

**Flow kind palette:** `FLOW_KIND_KEYS = ['db','cache','queue','file','doc','manual','other','external']`. `defaultFlowKinds` holds dark + light `FlowKindEntry = { bg, fg, border }` per kind. `ThemeConfig.flowKinds?: Partial<Record<FlowKindKey, Partial<{ dark: Partial<FlowKindEntry>; light: Partial<FlowKindEntry> }>>>` — user overrides from `ignatius.yml` `theme.flowKinds`. `resolveFlowKindPalette(mode, flowKinds?)` merges user overrides over defaults at the `FlowKindEntry` level (partial wins without wiping fg/border). Imported by [`src/app/views/flow/FlowsView.tsx`](../../src/app/views/flow/FlowsView.tsx) for `initFlowGraphCore`/`doRender`, and by [`src/app/views/flow/LegendModal.tsx`](../../src/app/views/flow/LegendModal.tsx) for `LegendModal`.

[`src/theme/branding-defaults.ts`](../../src/theme/branding-defaults.ts) — exports `Branding`, `LogoPair`, `CopyrightConfig` types and the default branding config. Imports [`assets/noorm-logo.svg`](../../assets/noorm-logo.svg) as a file reference. `Branding` holds `logo` (dark/light SVG paths), `title`, `subtitle`, `copyright`, and `poweredBy` flag.

### skill

[`skills/noorm-modeling/SKILL.md`](../../skills/noorm-modeling/SKILL.md) (~52L) — project-scoped Claude skill. Frontmatter: `name: noorm-modeling`, triggers on `/noorm-modeling`, `new entity`, `bootstrap a model`, `new ignatius model`, `add entity`. `canonical_sources` lists [`docs/spec/schema-lint-and-error-ux.md`](../../docs/spec/schema-lint-and-error-ux.md), [`docs/spec/derive-classification.md`](../../docs/spec/derive-classification.md), [`docs/spec/ignatius-project-config.md`](../../docs/spec/ignatius-project-config.md), [`docs/design/markdown-driven-erd.md`](../../docs/design/markdown-driven-erd.md).

Two modes: `entity` (add one entity file) and `model` (bootstrap a new model skeleton).

**Authoring convention axis** — detected once per session from existing model shape (key-inherited: composite PK with FK cols inside; orm-oriented: single surrogate `id` PK with FK cols outside). Never asks for `classification` or per-edge `identifying` — derived by the parser automatically.

**Entity flow (CP-1):** E0 locate model root → E1 entity id (PascalCase) → E2 group selection → E3 parent edges → E4 AK columns → E5 regular columns → E6 description → E7 write file → E8 verify with `ignatius validate`. AK step always offered, skippable.

**Model bootstrap flow (CP-2):** B0 model dir path → B1 model name/version/description → B2 first group → B3 write `ignatius.yml` + `_groups/<slug>.md` → B4 offer to run entity flow.

Skill writes real files and runs `ignatius validate <model-dir> 2>&1` to verify output; exits verify loop only when validate exits 0 or user aborts.

Coupling: references [`docs/spec/noorm-modeling-skill.md`](../../docs/spec/noorm-modeling-skill.md), [`docs/design/noorm-modeling-skill.md`](../../docs/design/noorm-modeling-skill.md), [`docs/spec/derive-classification.md`](../../docs/spec/derive-classification.md), [`docs/spec/ignatius-project-config.md`](../../docs/spec/ignatius-project-config.md), [`docs/spec/schema-lint-and-error-ux.md`](../../docs/spec/schema-lint-and-error-ux.md).

### docs

[`docs/design/app-tsx-decomposition.md`](../../docs/design/app-tsx-decomposition.md) (142L) — design doc for the `src/App.tsx` → [`src/app/`](../../src/app) decomposition: motivation, layer map, migration strategy, and file layout.
[`docs/design/src-root-organization.md`](../../docs/design/src-root-organization.md) (49L) — design doc for the [`src/`](../../src) top-level subdirectory split (app/, cli/, flows/, model/, server/, theme/, flow-view/, generators/, types/).
[`docs/design/bidirectional-predicates.md`](../../docs/design/bidirectional-predicates.md) — design doc for the bidirectional predicate feature.
[`docs/design/cli-and-outputs.md`](../../docs/design/cli-and-outputs.md) — design doc for CLI modes and static output approach.
[`docs/design/markdown-driven-erd.md`](../../docs/design/markdown-driven-erd.md) — design doc for markdown-driven entity file format.
[`docs/design/branding.md`](../../docs/design/branding.md) — design doc for branding system.
[`docs/design/dict-navigation.md`](../../docs/design/dict-navigation.md) — design doc for data dictionary navigation.
[`docs/design/viewer-fab-ux.md`](../../docs/design/viewer-fab-ux.md) — design doc for floating action button UX.
[`docs/design/ignatius-project-config.md`](../../docs/design/ignatius-project-config.md) — design doc for `ignatius.yml` config + model discovery.
[`docs/design/noorm-modeling-skill.md`](../../docs/design/noorm-modeling-skill.md) — design doc for the ignatius modeling skill.
[`docs/design/schema-lint-and-error-ux.md`](../../docs/design/schema-lint-and-error-ux.md) (205L) — design doc for schema lint + error UX.
[`docs/design/graph-position-persistence.md`](../../docs/design/graph-position-persistence.md) (118L) — design doc for graph node position persistence.
[`docs/design/wiki-entity-links.md`](../../docs/design/wiki-entity-links.md) (59L) — design doc for wiki-style `[[Entity]]` body links.
[`docs/design/process-flows.md`](../../docs/design/process-flows.md) (207L) — design doc for SSADM DFD subsystem.
[`docs/design/unified-app.md`](../../docs/design/unified-app.md) (152L) — design doc for unified SPA collapse (Graph + Dictionary + Flows in one app; `export` replaces `dict`/`graph`/`flow`).
[`docs/spec/app-tsx-decomposition.md`](../../docs/spec/app-tsx-decomposition.md) (244L) — implementation contract for the App.tsx decomposition: layer rules, module boundaries, component file list, and import direction constraints.
[`docs/spec/src-root-organization.md`](../../docs/spec/src-root-organization.md) (80L) — implementation contract for the [`src/`](../../src) directory split: canonical subdirectory → module mapping, cross-domain import rules.
[`docs/spec/cli-and-outputs.md`](../../docs/spec/cli-and-outputs.md) — implementation contract for CLI output modes and theme system.
[`docs/spec/branding.md`](../../docs/spec/branding.md) — implementation contract for branding.
[`docs/spec/dict-navigation.md`](../../docs/spec/dict-navigation.md) — implementation contract for dict side nav.
[`docs/spec/dict-polish.md`](../../docs/spec/dict-polish.md) — implementation contract for dict visual polish.
[`docs/spec/viewer-fab-ux.md`](../../docs/spec/viewer-fab-ux.md) — implementation contract for FAB UX.
[`docs/spec/ignatius-project-config.md`](../../docs/spec/ignatius-project-config.md) — implementation contract for `ignatius.yml` config loading + model discovery.
[`docs/spec/derive-classification.md`](../../docs/spec/derive-classification.md) — implementation contract for 5-rule classification derivation.
[`docs/spec/noorm-modeling-skill.md`](../../docs/spec/noorm-modeling-skill.md) — implementation contract for the ignatius modeling skill.
[`docs/spec/bidirectional-predicates.md`](../../docs/spec/bidirectional-predicates.md) — implementation contract for bidirectional predicates.
[`docs/spec/schema-lint-and-error-ux.md`](../../docs/spec/schema-lint-and-error-ux.md) (134L) — implementation contract for schema lint + error UX.
[`docs/spec/graph-position-persistence.md`](../../docs/spec/graph-position-persistence.md) (106L) — implementation contract for graph node position persistence.
[`docs/spec/wiki-entity-links.md`](../../docs/spec/wiki-entity-links.md) (79L) — implementation contract for wiki-entity links.
[`docs/spec/process-flows.md`](../../docs/spec/process-flows.md) (637L) — comprehensive implementation contract for SSADM DFD: parse, 11 `flow.*` rules, flow viewer, sub-DFD drill-down, `db:` store → rich entity dialog, non-entity store kinds, `title:` override, `titlelize`, entity↔process cross-reference, DFD URL navigability, process dictionary fused into Dictionary.
[`docs/spec/unified-app.md`](../../docs/spec/unified-app.md) (213L) — implementation contract for unified SPA: `export` replaces `dict`/`graph`/`flow`; fused searchable Dictionary; `db:` store → rich entity dialog; shared chrome + theme on DFDs.
[`docs/spec/dfd-polish-round4.md`](../../docs/spec/dfd-polish-round4.md) (156L) — implementation contract for CP24–26: DD sidebar hierarchical process nesting, DD card IO endpoint clickability for externals/stores, DD card process sample-data tables.
[`docs/spec/render-perf-indexing.md`](../../docs/spec/render-perf-indexing.md) (202L) — implementation contract for render-perf-indexing batch: L1 (preset-layout cache-skip when saved positions exist), L2 (ELK thoroughness/cost scaling by node count — `<50→30`, `50–100→20`, `100–200→14`, `200+→7`; organic scale + hard fallback), L3 (O(n²) element `.find` → id→element Map), L4 (ELK in Web Worker for first load), `buildModelIndex` 13-map O(1) index (build-on-consume, never serialized), flow O(n²) hot-spot indexing, Dictionary `nodesByGroup` computed via index, `errorsByEntityId`/`errorsByProcessId` as App-level `useMemo`s (not in ModelIndex), measurement harness (`gen-synthetic-model.ts` + `perf-harness.ts`). L5 (server-side layout precompute) dropped. Non-goals: changing ELK layout output, indexing cold one-shot lookups, serializing Maps.
[`docs/spec/unified-app-polish.md`](../../docs/spec/unified-app-polish.md) (191L) — implementation contract for CP1–CP13 unified-app-polish batch: minimap parity, per-view FAB, DFD URL navigability, external/store dedup body, fused dict + titlelize, db-store rich dialog, entity↔process cross-reference, process dialog entity links, DD search highlight, shared modal primitive, subprocess elevation, DD body links, external/store DD body parity + `fromFlow` in-place navigation. CP3 follow-up documented: sub-DFD deep links now survive refresh via `findDiagramPath` breadcrumb-stack rebuild on initial render; CP3 visual test cases G + G2 added.
[`docs/spec/dfd-polish-round2.md`](../../docs/spec/dfd-polish-round2.md) (166L) — implementation contract for CP14–17 DFD polish round 2: no text-select on DFD nodes (CP14), kind-colored stores/externals with YAML-overridable `theme.flowKinds` palette (CP15), per-process in/out data examples rendered as tables in process dialog (CP16), shared glossary [`docs/glossary.md`](../../docs/glossary.md) (CP17).
[`docs/spec/dfd-polish-round3.md`](../../docs/spec/dfd-polish-round3.md) (235L) — implementation contract for CP18–23 DFD polish round 3: navigator lifecycle teardown on view-switch (CP18), DFD minimap visual alignment to DG minimap (CP19), clickable IO table endpoints in process dialogs (CP20), Processes cross-reference section in external/store dialogs via `buildFlowNodeUsageIndex` (CP21), view-agnostic `ZoomControl` component wired to Graph via cytoscape adapter (CP22), ZoomControl wired to Flows view via `FlowDiagramSvg` imperative handles (CP23).
[`docs/glossary.md`](../../docs/glossary.md) (52L) — canonical vocabulary: DG (Data Graph), DD (Data Dictionary), DFD (Data Flow Diagram), DE (Data Entity), DS (Data Store), EE (External Entity), Process, Data Flow. States DS ⊃ DE (every `db:` store is a data entity; non-`db` stores are not). Lists all `kind:` values and their colors.

### scripts

[`scripts/stable-names.ts`](../../scripts/stable-names.ts) — post-build: copies `index-*.js` and `index-*.css` in `dist/static/` to stable names. Required step before `bun build --compile`.
[`scripts/convert-yaml-to-md.ts`](../../scripts/convert-yaml-to-md.ts) (257L) — one-time migration script.
[`scripts/probe.ts`](../../scripts/probe.ts) (95L) — ad-hoc diagnostic script.
[`scripts/screenshot.ts`](../../scripts/screenshot.ts) (82L) — Playwright screenshot helper.
[`scripts/gen-synthetic-model.ts`](../../scripts/gen-synthetic-model.ts) (427L) — synthetic IDEF1X model generator. CLI: `bun scripts/gen-synthetic-model.ts [--n 300] [--out tmp/my-model]`. Writes a valid `ignatius.yml` + `_groups/*.md` + ~N entity files across 6 groups (core/catalog/sales/finance/ops/reporting) with FK edges at ~1.4–1.8× edges/node and ≥2 subtype clusters. Default output: `tmp/synthetic-model-<n>/`. Used by `perf-harness.ts` as the default test fixture and by `test-synthetic-model.ts` as a parse-clean assertion.
[`scripts/perf-harness.ts`](../../scripts/perf-harness.ts) (215L) — Playwright-based render latency measurement harness. CLI: `bun scripts/perf-harness.ts [--model <dir>] [--n <count>] [--port <port>] [--runs <k>] [--mode organic|hierarchical]`. Measures: `parse-ms` (server-side parseModels duration), `time-to-layoutstop` (nav-start → ELK `layoutstop` via `window.__IGNATIUS_PERF__`), `time-to-interactive` (layoutstop + render settled), `node-count`, `edge-count`, `payload-bytes`. Default: generates a 300-node synthetic model, serves it, measures cold + warm rounds. Uses `playwright/chromium`. Not run by `bun run test` or CI — manual perf measurement only.

## Cross-cutting

- [`trash/`](../../trash) contains v1 components and engine code (YAML-driven), superseded by current markdown-driven implementation. Not imported anywhere in [`src/`](../../src).
- [`test/`](../../test) is exploratory tooling organized into `checks/` (CI-run assertions), `visual/` (Playwright, manual only), `fixtures/` (model roots + YAML data), `notes/` (markdown). Not a formal suite. [`test/checks/test-findings-panel.ts`](../../test/checks/test-findings-panel.ts) is a Playwright check in the `checks/` dir — CI will attempt to run it.
- [`models/`](../../models) is a container of four sibling model roots — `key-inherited/`, `orm-hybrid/`, `orm-pure/`, `broken-demo/` — each with its own `ignatius.yml`. `broken-demo/` is the deliberately-broken fixture (4 global + 8 entity = 12 total findings). `key-inherited/` carries demo DFDs under `flows/` (order-to-cash with sub-DFD + refund), including `_stores/gateway-log.md` (non-entity `file:` store). Reference/fixture data, not a domain.
- [`src/flows/titlelize.ts`](../../src/flows/titlelize.ts) — imported by [`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts) only. [`src/flows/flow-usage-index.ts`](../../src/flows/flow-usage-index.ts) — exports `buildEntityUsageIndex` and `buildFlowNodeUsageIndex`; `buildEntityUsageIndex` imported by [`src/app/App.tsx`](../../src/app/App.tsx); `buildFlowNodeUsageIndex` imported by [`src/app/views/flow/FlowsView.tsx`](../../src/app/views/flow/FlowsView.tsx). [`src/types/css-highlight.d.ts`](../../src/types/css-highlight.d.ts) — ambient declarations consumed globally.
- [`src/model/layout-fingerprint.ts`](../../src/model/layout-fingerprint.ts) imported by [`src/server/server.ts`](../../src/server/server.ts) (for `/api/model`), [`src/generators/app.ts`](../../src/generators/app.ts) (for static `__LAYOUT_KEY__` injection). [`src/app/views/graph/layout-store.ts`](../../src/app/views/graph/layout-store.ts) imported by [`src/app/views/graph/GraphView.tsx`](../../src/app/views/graph/GraphView.tsx) and [`src/app/views/flow/FlowsView.tsx`](../../src/app/views/flow/FlowsView.tsx). [`src/model/wikilink.ts`](../../src/model/wikilink.ts) imported by [`src/model/parse.ts`](../../src/model/parse.ts) and [`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts).
- [`src/cli/open-browser.ts`](../../src/cli/open-browser.ts) is dynamically imported by [`src/cli/cli.ts`](../../src/cli/cli.ts) only when `--open` is passed to `serve`.
- [`src/types/file-imports.d.ts`](../../src/types/file-imports.d.ts) — ambient module declarations for `*.html`, `*.css` imports. [`src/types/cytoscape-navigator.d.ts`](../../src/types/cytoscape-navigator.d.ts) — ambient declarations for `cytoscape-navigator`. [`bun-env.d.ts`](../../bun-env.d.ts) — ambient Bun type augmentations.
- [`src/model/parse.ts`](../../src/model/parse.ts) exports canonical model types (`Model`, `ModelNode`, `ModelEdge`, `SubtypeCluster`, `Cardinality`, `GroupConfig`, `ColumnDef`, `ModelMeta`, `Predicate`) and `ParseResult`, plus `normalizePredicate`. `ModelNode` carries `bodyLinks?: string[]`. [`src/model/validate.ts`](../../src/model/validate.ts) exports `ValidationResult`, `EntityError`, `GlobalError`, `RuleId`, `RuleEntry`, `RULES`. Both imported by [`src/app/App.tsx`](../../src/app/App.tsx) (shell), [`src/server/server.ts`](../../src/server/server.ts), and [`src/cli/cli.ts`](../../src/cli/cli.ts).
- Findings flow: `parse.ts` → `ParseResult.globalErrors` (parse-time) + `validateModel()` → `ValidationResult.globalErrors + .entityErrors` + optional `validateFlows()` → `FlowValidationResult.flowErrors` → merged by callers before rendering.
- CLI subcommand status: `serve` ✓ active; `validate` ✓ active; `export` ✓ active; `version` ✓ active; `update` ✓ active; `dict` ✗ removal stub; `graph` ✗ removal stub; `flow` ✗ removal stub.
- Binary name is `ignatius` (`dist/ignatius`); package.json `name` is `ignatius`. The repo *directory* `derek-db-generator/` is the only remaining `derek` reference — a known leftover.
- [`assets/noorm-logo.svg`](../../assets/noorm-logo.svg) — default branding logo, imported by [`src/theme/branding-defaults.ts`](../../src/theme/branding-defaults.ts) as a file reference.
- Deterministic substrate: [`.claude/project/deterministic-signals.md`](deterministic-signals.md)
