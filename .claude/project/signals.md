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
| Dev server (hot reload) | `bun run dev` | package.json → src/server.ts |
| Dev CLI (hot reload) | `bun run dev:cli` | package.json → src/cli.ts serve models/key-inherited |
| Run all assertion checks | `bun run test` | package.json globs `test/checks/*.ts` |
| Run a single check | `bun test/checks/test-<name>.ts` | test/checks/ |
| Typecheck | `bun run typecheck` | package.json → `bunx tsc --noEmit` |

`build:cli` sequence: `build:bundle` → `build:stable-names` → `bun build --compile src/cli.ts --outfile dist/ignatius`

`bun run test` runs a shell loop over `test/checks/*.ts` in order; exits 1 on first failure. CI (.github/workflows/ci.yml) runs every `test/checks/*.ts` via a loop (same set as `bun run test`) after building the binary.

[`test/`](../../test) is organized into subdirectories — not a formal test-framework suite:

- [`test/checks/`](../../test/checks) — 52 raw assertion scripts (PASS/FAIL/throw). Run by `bun run test` and CI. Includes `test-validate-entity.ts` and `test-validate-refs.ts` which pin `key-inherited` as the clean baseline and `broken-demo` as the broken fixture. `test-validate-refs.ts` expects 4 global + 8 entity = 12 total findings (1 additional `body.unknown_link` from `broken-demo/Order.md`'s `[[Cart]]` link). `test-api-model.ts` asserts `layoutKey` field is present in `/api/model` response. `test-layout-fingerprint.ts` (255L) and `test-layout-store.ts` (157L) pin the fingerprint / localStorage helper. `test-layout-key-injection.ts` (132L) asserts `window.__LAYOUT_KEY__` in static graph HTML. `test-wikilink.ts` covers the `[[…]]` inline rule. `test-validate-body-links.ts` covers `body.unknown_link` emission. `test-open-browser.ts` covers `browserOpenCommand` argv mapping. `test-titlelize.ts` (83L) covers `titlelize()`. `test-entity-usage-index.ts` (190L) covers `buildEntityUsageIndex()`. `test-cp5-title-override.ts` (106L) covers `title:` frontmatter override on flow externals/stores. `test-cp15-flow-kind-palette.ts` (105L) covers `resolveFlowKindPalette` defaults + YAML overrides. `test-cp16-process-examples.ts` (186L) covers `parseProcessExamples` and `FlowProcess.examples` parse round-trip. `test-cp21-flow-node-usage-index.ts` (234L) covers `buildFlowNodeUsageIndex` token-keyed map (ext:, file:, db: endpoint dedup + direction).
- [`test/visual/`](../../test/visual) — 53 Playwright screenshot scripts for manual visual inspection. NOT run by `bun run test`. Includes `screenshot-position-persist.ts` (drag→reload→restore-all-nodes + reset→ELK) and CP1–CP26 visual test scripts. `test-cp3-dfd-url-navigability.ts` (381L) covers cases A–G2. `test-cp13-external-store-parity.ts` (354L) covers external/store DD section body parity and `fromFlow` in-place navigation. `test-cp14-no-text-select.ts` (231L) covers `user-select: none` on DFD node groups. `test-cp15-kind-colors.ts` (186L) covers kind-colored store/external fills in dark + light. `test-cp16-process-examples.ts` (233L) covers process dialog example tables. `test-cp18-navigator-crash.ts` (262L) covers navigator lifecycle teardown on view-switch (CP18). `test-cp19-minimap-parity.ts` (415L) covers DFD minimap visual alignment to DG minimap (CP19). `test-cp20-io-endpoint-links.ts` (311L) covers clickable IO table endpoints in process dialogs (CP20). `test-cp21-flow-node-processes.ts` (352L) covers Processes section in external/store dialogs (CP21). `test-cp22-zoom-control.ts` (365L) covers ZoomControl on Graph view (CP22). `test-cp23-flow-zoom-control.ts` (409L) covers ZoomControl on Flows view (CP23). `test-cp24-sidebar-nesting.ts` (236L) covers hierarchical dotted-number sort + depth indent for processes in the DD sidebar (CP24). `test-cp25-dd-endpoint-links.ts` (328L) covers external/store IO endpoint links in the DD process card (CP25). `test-cp26-process-examples-in-dd.ts` (202L) covers per-process sample-data tables in the DD card (CP26).
- [`test/fixtures/`](../../test/fixtures) — YAML fixtures and fixture model roots loaded by check scripts.
- [`test/notes/`](../../test/notes) — 2 markdown dev notes.

No linter or formatter configured in package.json.

## Language breakdown

| Language | LOC | Files | % |
|----------|-----|-------|---|
| TypeScript | 36731 | 162 | 67% |
| Markdown | 13795 | 195 | 25% |
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
| cli | [`src/cli.ts`](../../src/cli.ts), [`src/discover.ts`](../../src/discover.ts), [`src/resolve-model.ts`](../../src/resolve-model.ts), [`src/version.ts`](../../src/version.ts), [`src/update.ts`](../../src/update.ts), [`src/serve-port.ts`](../../src/serve-port.ts), [`src/open-browser.ts`](../../src/open-browser.ts) | citty-based subcommand dispatch (serve/validate/export/version/update); `dict`/`graph`/`flow` are removal stubs; model-root discovery + interactive picker; port fallback + browser open on serve; self-update + version reporting | (below) |
| server | [`src/server.ts`](../../src/server.ts) | Bun.serve with `/api/model` + `/api/flow` + `/events` SSE + fs.watch live-reload; `/dict` and `/flow` redirect to unified SPA hash routes; `/flow-dict` redirects to `/#view=dict` | (below) |
| parser | [`src/parse.ts`](../../src/parse.ts), [`src/wikilink.ts`](../../src/wikilink.ts) | `ignatius.yml` config loading → ParseResult: {model, globalErrors}; nodes, edges, cardinality + classification derivation; wiki-link inline rule + two-pass body rendering with bodyLinks | (below) |
| validate | [`src/validate.ts`](../../src/validate.ts) | Pure model validator: RuleIds across 5 domains, two severity tiers (A=warn, B=omit); coerces invalid pk/columns to safe defaults in cleanedModel | (below) |
| flows | [`src/flow-parse.ts`](../../src/flow-parse.ts), [`src/flow-validate.ts`](../../src/flow-validate.ts), [`src/flow-fingerprint.ts`](../../src/flow-fingerprint.ts), [`src/flow-usage-index.ts`](../../src/flow-usage-index.ts), [`src/titlelize.ts`](../../src/titlelize.ts), [`src/flow-view/flow-layout.ts`](../../src/flow-view/flow-layout.ts) | SSADM data flow diagrams: `parseFlows` (recursive sub-DFDs, `_externals/`/`_stores/` with `kind:`+`title:` frontmatter, `displayName`, `titlelize`), `parseProcessExamples` (in/out example tables), `validateFlows` (11 `flow.*` rules), `buildFlowLayoutKeys`, `buildEntityUsageIndex` (entity↔process cross-reference); `extKind`/`storeKind` on layout node data for kind-colored fills; `ignatius flow` is a removal stub. See [`docs/spec/process-flows.md`](../../docs/spec/process-flows.md). | (below) |
| frontend | [`src/App.tsx`](../../src/App.tsx), [`src/hash-router.ts`](../../src/hash-router.ts), [`src/main.tsx`](../../src/main.tsx), [`src/index.html`](../../src/index.html), [`src/styles.css`](../../src/styles.css), [`src/markers.ts`](../../src/markers.ts), [`src/wrap-label.ts`](../../src/wrap-label.ts), [`src/layout-fingerprint.ts`](../../src/layout-fingerprint.ts), [`src/layout-store.ts`](../../src/layout-store.ts) | React 19 unified SPA (Graph/Dictionary/Flows views); per-view FAB menus; DFD URL deep-link (`dfd=` hash param); entity↔process Processes section; DD CSS Custom Highlight search; DD print (beforeprint/afterprint); shared `resolveBodyClick` for DD body refs; subprocess elevated shadow in flow SVG | (below) |
| generators | [`src/generators/`](../../src/generators) | Unified static HTML export via `generateApp` (single file — graph + dict + flows); [`src/generators/app.ts`](../../src/generators/app.ts) is the sole static generator; [`src/generators/embedded-bundle.ts`](../../src/generators/embedded-bundle.ts) loads the React bundle. Separate `dict.ts`, `graph.ts`, `flow-graph.ts`, `flow-dict.ts`, `inline-asset.ts`, `theme-css.ts` were removed when the SPA was unified. | (below) |
| theme | [`src/theme-defaults.ts`](../../src/theme-defaults.ts), [`src/branding-defaults.ts`](../../src/branding-defaults.ts) | ThemeConfig + Branding types, default palettes, dark/light merging | (below) |
| skill | [`skills/noorm-modeling/`](../../skills/noorm-modeling) | Project-scoped Claude skill: Q&A-driven entity authoring + model bootstrap, convention-aware, writes files + verifies with `ignatius validate` | (below) |
| docs | [`docs/`](../../docs) | Design docs, specs, guides, glossary. Includes [`docs/spec/unified-app-polish.md`](../../docs/spec/unified-app-polish.md) (CP1–CP13 batch spec), [`docs/spec/dfd-polish-round2.md`](../../docs/spec/dfd-polish-round2.md) (CP14–17 batch spec), [`docs/spec/dfd-polish-round3.md`](../../docs/spec/dfd-polish-round3.md) (CP18–23 batch spec), [`docs/spec/process-flows.md`](../../docs/spec/process-flows.md) (637L comprehensive flow spec), and [`docs/glossary.md`](../../docs/glossary.md) (canonical DG/DD/DFD/DE/DS/EE vocabulary). | (below) |
| scripts | [`scripts/`](../../scripts) | Build helpers: stable-names.ts, convert-yaml-to-md.ts, probe.ts, screenshot.ts | (below) |

## Domain detail

### cli

[`src/cli.ts`](../../src/cli.ts) is the binary entry point. Eight subcommands registered: `serve`, `server` (alias for serve), `dict`, `graph`, `validate`, `flow`, `export`, `version`, `update`. `dict`, `graph`, and `flow` are removal stubs — each prints "Removed — use: ignatius export -o model.html" to stderr and exits 1. Active model subcommands: `serve`, `validate`, `export`.

`serve` accepts optional positional `[path]` and `--port`/`-p`, `--model`, `--open`/`-o` flags. Delegates binding to `serveWithPortFallback` in [`src/serve-port.ts`](../../src/serve-port.ts). When the requested port is taken (`EADDRINUSE`), TTY prompts via `@clack/prompts` text defaulting to the next free port; non-TTY auto-advances. After binding, `--open` dynamically imports [`src/open-browser.ts`](../../src/open-browser.ts) and calls `openBrowser`.

`export` subcommand: parses entity model via `parseModels()`, validates with `validateModel()`, then parses flows via `parseFlows()` if a `flows/` directory exists, validates with `validateFlows()`. Loads the embedded React bundle via `loadEmbeddedBundle()`, calls `generateApp(model, flowModel, bundle, { themeMode })` from [`src/generators/app.ts`](../../src/generators/app.ts), writes a single HTML file. Exit code 1 when any entity global errors OR flow Class-B errors are present.

`validate` subcommand: same `parseModels` → `validateModel` → optional `parseFlows` + `validateFlows` flow, prints findings to stderr, prints a one-line stdout summary (`✓`/`✗`). Exit code 1 on errors.

[`src/open-browser.ts`](../../src/open-browser.ts) exports `browserOpenCommand(platform, url): string[]` (pure) and `openBrowser(url, platform?)` (fire-and-forget `Bun.spawn`). Dynamically imported only on `--open`.

[`src/version.ts`](../../src/version.ts) exports `VERSION` from a JSON import of [`package.json`](../../package.json) — Bun inlines it at `--compile` time.

[`src/update.ts`](../../src/update.ts) powers `update` (flags `--check`, `--yes`/`-y`). Resolves latest tag via `releases/latest` redirect Location header, compares semver, on consent downloads + verifies sha256, atomically renames over `process.execPath`. Guards: dev runtime → no self-replace; win32 → manual-download message; non-TTY without `--yes` → report-only.

[`src/discover.ts`](../../src/discover.ts) — pure model-root resolver. Exports `resolveModel(base, opts): Promise<ResolveResult>` and `ModelCandidate` / `ResolveResult` types. Algorithm: (1) base itself has `ignatius.yml` → single; (2) search down (skipping `_*`, `node_modules`, `.git`, `dist`, `tmp`, [`trash`](../../trash), `.worktrees`, [`.claude`](..)); (3) walk up; (4) exactly 1 → single; (5) multiple + `--model` → filter; (6) multiple + no key → many. `ResolveResult` discriminated union: `single | many | no-match | none`.

[`src/resolve-model.ts`](../../src/resolve-model.ts) — exports `pickModel(base, modelKey): Promise<string>`. Handles all four result kinds: single → return dir; none/no-match → stderr + exit 1; many + non-TTY → stderr key list + exit 2; many + TTY → `@clack/prompts` select picker (cancel → exit 130).

### server

[`src/server.ts`](../../src/server.ts) exports `serveCommand(modelsDir, opts)` returning `{ server, stop }`. Routes:

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

[`src/parse.ts`](../../src/parse.ts) exports `parseModels(dir): Promise<ParseResult>`. `ParseResult = { model: Model; globalErrors: GlobalError[] }`. Config loading: reads `ignatius.yml`; top-level keys populate `_meta`; `theme:` deep-merged via `mergeTheme()`; `branding:` merged via `mergeBranding()`. `Model` type: `{ groups, nodes, edges, subtypeClusters, theme, branding, _meta? }`. Entity classification fully derived (5-rule order): Classifier → Subtype → Associative → Dependent → Independent. `identifying` per edge also derived. `deriveCardinality()` uses derived `identifying` + nullability + AK membership. Body markdown rendered to HTML via markdown-it at parse time.

**Wiki-links (two-pass body rendering):** `ModelNode` carries `bodyLinks?: string[]`. Body rendering deferred to a second pass after all entity ids are known. [`src/wikilink.ts`](../../src/wikilink.ts) exports `WikiLinkEnv`, `splitWikiTarget`, and `wikiLinkPlugin(md)`. Valid links emit `<a class="entity-link" data-entity="…">…</a>`; unknown links emit `<span class="entity-link entity-link--missing" …>`. Absent `knownIds` → optimistic.

**Predicates:** `Predicate = { fwd: string; rev: string }` and `normalizePredicate(raw): Predicate`. `ModelEdge.predicate` is always a normalized `Predicate`.

### validate

[`src/validate.ts`](../../src/validate.ts) — pure module with no Node/Bun I/O; imports only types from `./parse`. Browser-safe and unit-testable with plain Model literals.

Exports: `validateModel(model: Model): ValidationResult`, `formatFindingsForStderr(globalErrors, entityErrors, flowErrors?): string[]`, `RULES: Record<RuleId, RuleEntry>`, types `RuleId`, `EntityError`, `GlobalError`, `ValidationResult`, `RuleEntry`.

`RuleId` union: 14 rules across 4 domains — parse (`parse.invalid_yaml`, `parse.missing_id`, `parse.empty_frontmatter`), entity (`entity.missing_pk`, `entity.missing_columns`, `entity.invalid_field_type`, `entity.unknown_group`, `entity.example_unknown_column`), body (`body.unknown_link`), edge (`edge.unknown_target`, `edge.dangling_fk_column`), cluster (`cluster.missing_basetype`, `cluster.missing_member`, `cluster.no_discriminator`).

`RuleEntry.class`: `'A'` = render degraded + warning triangle; `'B'` = omit + global banner. `RuleEntry.liveOnly?: boolean` — only `entity.example_unknown_column` carries this flag. `body.unknown_link` is Class A, not `liveOnly`.

`ValidationResult = { entityErrors: EntityError[]; globalErrors: GlobalError[]; cleanedModel: Model }`. `cleanedModel` has dangling edges and broken clusters removed, AND nodes with invalid pk/columns coerced to safe defaults.

`RULES` is a `Record<RuleId, RuleEntry>` — TypeScript compile-errors if any RuleId is missing an entry.

`formatFindingsForStderr` accepts optional `flowErrors` third param so CLI callers can pass combined entity + flow findings in a single call. Sorts rows: errors before warnings, ruleId alphabetical, location alphabetical.

### flows

[`src/flow-parse.ts`](../../src/flow-parse.ts) (755L) — SSADM data flow diagram parser. Exports `parseFlows(dir): Promise<FlowParseResult>`, `parseProcessExamples()`, types `FlowModel`, `FlowDiagram`, `FlowProcess`, `FlowExternal`, `FlowStoreRef`, `FlowEdge`, `FlowEndpoint`, `FlowExample`, `FlowExampleRow`, `FlowParseResult`.

`FlowStoreRef.displayName` — human-readable display label resolved as: `title:` frontmatter override → `titlelize(name)` from [`src/titlelize.ts`](../../src/titlelize.ts). `FlowExternal` display label similarly resolved: `title:` frontmatter → `external:` value → `titlelize(id)`.

`FlowExternal.kind?: FlowStoreRef['kind']` — optional `kind:` from `_externals/*.md` frontmatter. Absent → conventional green (no visual regression). Present → kind-colored fill in `FlowDiagramSvg`.

`FlowProcess.examples?: { in: FlowExample[]; out: FlowExample[] }` — optional per-process in/out data examples parsed from `examples:` frontmatter. `FlowExample = { from?, to?, label?, rows: FlowExampleRow[] }`. `FlowExampleRow = Record<string, string | number | boolean>`. `parseProcessExamples(raw)` is an exported pure function (used by tests directly and called internally during process file parsing).

`FlowDiagram.title` — always `titlelize(id)` at parse time; `id` is the stable routing key. Non-entity stores carry `kind:` frontmatter (`cache`, `queue`, `file`, `doc`, `manual`, `other`); `_stores/*.md` files read `kind:` and `title:` from frontmatter.

[`src/flow-parse.ts`](../../src/flow-parse.ts) imports `titlelize` from [`src/titlelize.ts`](../../src/titlelize.ts) and `wikiLinkPlugin` from [`src/wikilink.ts`](../../src/wikilink.ts). Flow markdown bodies (`[[Target]]` links) are rendered optimistically — every target becomes a navigable anchor, resolved at click time.

[`src/titlelize.ts`](../../src/titlelize.ts) — exports `titlelize(slug: string): string`. Pure, framework-free. Rules: split on hyphens/underscores, then split within segments at camelCase/ACRONYM/digit boundaries, title-case each word, join with spaces. Example: `order-to-cash` → `"Order To Cash"`, `HTTPRequest` → `"HTTP Request"`.

[`src/flow-usage-index.ts`](../../src/flow-usage-index.ts) — two exports. `buildEntityUsageIndex(diagrams: FlowDiagram[]): Map<string, ProcessUsage[]>` — unchanged; maps bare entity id → `ProcessUsage[]`; only `db:` endpoints count; used by `SelectedEntityModal`'s Processes section. `buildFlowNodeUsageIndex(diagrams: FlowDiagram[]): Map<string, ProcessUsage[]>` (CP21) — token-keyed superset; maps `"kind:name"` token (e.g. `"ext:Customer"`, `"file:gateway-log"`, `"db:Payment"`) → `ProcessUsage[]`; covers ALL non-`proc` endpoint kinds; same dedup + direction logic. Both walk diagrams recursively including sub-DFDs. `ProcessUsage` carries `processId`, `processLabel`, `dottedNumber`, `dfdId`, `dfdTitle`, `direction`. Both imported by [`src/App.tsx`](../../src/App.tsx).

[`src/flow-view/flow-layout.ts`](../../src/flow-view/flow-layout.ts) (475L) — `FlowElementData` node variant carries `extKind?: FlowKindKey` (for externals with optional kind) and `storeKind?: FlowKindKey` (for all store-kind nodes). These fields are read by `FlowDiagramSvg` to select the kind-colored fill from `kindPalette`.

[`src/flow-view/FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx) (1422L) — accepts two new props: `onZoomChange?: (scale: number) => void` (fires on every scale state change via `useEffect`) and `onRegisterZoomControl?: (ctrl: { zoomTo(scale: number): void; resetFit(): void } | null) => void` (fires after first render with imperative handles, fires with `null` on unmount). Wheel zoom delta tamed to `0.95`/`1.05` per tick (previously `0.9`/`1.1` — CP23).

[`src/flow-view/FlowChrome.tsx`](../../src/flow-view/FlowChrome.tsx) (409L) — `.flow-minimap-wrapper` left offset aligned to 16px (matching DG `.minimap` left offset when DFD nav is hidden); minimap label removed from DOM (CP19). `FlowChromeHandle` and `FlowChromeProps` types unchanged.

[`src/flow-validate.ts`](../../src/flow-validate.ts) (640L) — exports `validateFlows(flowModel, model, config): FlowValidationResult`. 11 `flow.*` rules including recursive data-level balancing. `FlowError` type.

[`src/flow-fingerprint.ts`](../../src/flow-fingerprint.ts) (90L) — exports `buildFlowLayoutKeys(flowModel): Record<string, string>`. Returns a map of diagram id → structural fingerprint for every diagram in the tree (top-level and sub-DFDs). Used by server `/api/flow` and `generateApp`.

[`models/key-inherited/flows/order-to-cash/_stores/gateway-log.md`](../../models/key-inherited/flows/order-to-cash/_stores/gateway-log.md) — demo non-entity store with `kind: file` and `title: Payment Gateway Log` frontmatter; used to exercise non-`db` store parsing and display.

### frontend

[`src/App.tsx`](../../src/App.tsx) (5241L) is the single React component hosting all three views: Graph (Cytoscape.js), Dictionary (server-rendered or client-driven), and Flows (`FlowDiagramSvg` SVG renderer). `window.__MODEL__`, `window.__THEME_MODE__`, `window.__IGNATIUS_MODE__` ('live' | 'static'), `window.__LAYOUT_KEY__`, `window.__FLOW_MODEL__`, `window.__FLOW_LAYOUT_KEYS__` are injection points.

**View routing:** [`src/hash-router.ts`](../../src/hash-router.ts) exports `parseHash` / `serializeHash`. `HashState` carries `view?: 'graph' | 'dict' | 'flow'`, `entity?`, `zoom?`, `pan?`, and `dfd?` (active flow diagram id — only meaningful when `view === 'flow'`). Format: `#view=<graph|dict|flow>&entity=<id>&zoom=<n>&pan=<x>,<y>&dfd=<diagram-id>`. App.tsx reads `hashchange` events and restores view + DFD on back/forward navigation via `selectDiagramById`.

**Per-view FAB menus:** the FAB in Graph view shows graph-specific items (Reset layout, Layout mode toggle, etc.); Dictionary view shows dict-specific items; Flows view shows flow-specific items. Items not relevant to the active view are not rendered.

**DFD URL deep-link (`dfd=` hash param):** `selectDiagramById(id)` resolves a diagram by id whether it is top-level or a sub-DFD, then updates the breadcrumb stack, calls `onActiveDiagramChange` to write `dfd=<id>` into the URL hash. Back/forward navigation restores the active DFD client-side without a reload. `findDiagramPath(id)` recursively searches `allDiagrams` (and their `subDfds` trees) and returns the ancestor path from root to the target diagram; `selectDiagramById` and the initial-render seed both use it so a deep-linked sub-DFD id resolves and the full breadcrumb chain is established on first load (survives page refresh).

**Entity↔process cross-reference (`ProcessesSection`):** `SelectedEntityModal` receives `processUsages?: ProcessUsage[]` from `buildEntityUsageIndex`. When present, a `<ProcessesSection>` table renders below the body showing process name, DFD title, and direction badge (`.dict-process-direction--read/write/readwrite`). `onNavigateToProcess` switches to the Flows view and navigates to the process.

**Dictionary CSS Custom Highlight search (CP9):** `useEffect` on committed search term calls `CSS.highlights` API to mark `dd-search-highlight` ranges across all `.dict-entity-section` elements. [`src/types/css-highlight.d.ts`](../../src/types/css-highlight.d.ts) provides ambient `Highlight` / `HighlightRegistry` declarations (not yet in `lib.dom.d.ts` as of TS 5.x). `::highlight(dd-search-highlight)` styled in [`src/styles.css`](../../src/styles.css) using `--dd-search-highlight` CSS var set per-mode by `applyThemeCssVars`.

**Dictionary print (CP10 beforeprint/afterprint):** `window.addEventListener('beforeprint')` clears the active search term so the full dictionary renders on print; `window.addEventListener('afterprint')` restores the prior term. The saved term is stored in a `useRef` (not `let`) because `beforeprint` triggers a state update before `afterprint` fires.

**Shared `resolveBodyClick`:** module-level function used by both the entity modal body and the Dictionary body `onClick` handlers. Intercepts clicks on `a[data-entity]` (entity links), `a[data-section]` (section scroll anchors), and `a[href^="#entity-"]` (legacy dict anchors). Delegates navigation to `onScrollToSection` callback.

**Subprocess elevation (CP11):** `FlowDiagramSvg.tsx` renders subprocess nodes (processes with sub-DFDs) with a stacked-shadow affordance. `FlowPalette` carries `procElevation` color: `'#0a2d6b'` in `DARK_PALETTE`, `'#93c5fd'` in `LIGHT_PALETTE`. Shadow rectangles use `fill={c.procElevation}`.

**No text-select on DFD nodes (CP14):** [`src/styles.css`](../../src/styles.css) adds `user-select: none` applied to DFD node SVG groups so drag and click interactions are not interrupted by text selection. The rule is scoped to the node-type group elements inside `FlowDiagramSvg`.

**Kind-colored stores/externals (CP15):** `initFlowGraphCore` and `doRender` call `resolveFlowKindPalette(themeMode, themeConfig?.flowKinds)` and pass the resolved `kindPalette: Record<FlowKindKey, FlowKindEntry>` as a prop into `FlowDiagramSvg`. The SVG renderer reads `extKind`/`storeKind` from `FlowElementData` node data and indexes `kindPalette` to set `bg`/`fg`/`border` fill colors. `LegendModal` (line 3255 of `App.tsx`) renders a "Data store kinds" section when `view === 'flow'`, enumerating each kind with its palette color swatch. `LegendModal` accepts `kindPalette?: Record<FlowKindKey, FlowKindEntry>` and falls back to `resolveFlowKindPalette(themeMode)` when absent.

**Per-process examples (CP16):** `FlowProcessExamplesSection` (line 1581 of `App.tsx`) — renders inside `FlowNodeModal` process branch. Accepts `examples: FlowProcess['examples']`. When present, renders one table per in/out flow entry (titled by `from`/`to` + `label`), with `rows` as a small table — symmetric with entity sample rows section. Absent `examples` → section not rendered.

**Navigator lifecycle gating on view (CP18):** the `useEffect` that mounts/tears down `cytoscape-navigator` has `view` in its deps. When `view !== 'graph'`, it calls `teardownNavigator` and nulls `navRef.current` before returning. This prevents the navigator's `cy 'resize'` subscription from surviving a view-switch — eliminating a crash where a trailing `ResizeObserver` called `cy.boundingBox()` on a destroyed cytoscape core after graph→flow→graph navigation.

**Clickable IO table endpoints (CP20):** `FlowIoTable` accepts optional `onOpenToken?: (token: string) => void` and `canOpenToken?: (token: string) => boolean`. When `canOpenToken(epToken)` returns true, the non-`db` endpoint cell renders as `<a class="entity-link">` that calls `onOpenToken(epToken)` on click. Callers supply `canOpenToken={(tok) => resolveDoc(tok) !== null}` to gate on whether the flow doc resolver can map the token.

**External/store Processes section (CP21):** `FlowNodeModal` accepts `nodeUsageIndex?: ReadonlyMap<string, ProcessUsage[]>` (token-keyed, from `buildFlowNodeUsageIndex`). In the `FlowStoreRef` and `FlowExternal` branches, the modal looks up `nodeUsageIndex?.get(storeToken)` / `nodeUsageIndex?.get(extToken)` and renders `<ProcessesSection>` when usages are present — matching the cross-reference table already in `SelectedEntityModal` for ERD entities.

**External/store DD body parity (CP13):** `FlowNodeModal` body container and the flow-flow-opened `SelectedEntityModal` body both use `.dict-entity-body` class (matching the main Dictionary) so wiki-link styling is consistent across all surfaces. `upgradeMissingLinksInContainer` runs inside `FlowNodeModal` (after body render) and inside the flow-opened `SelectedEntityModal` (via `useEffect`) using the full `allFlowNodeIds` set — so external/store/process `[[wiki-links]]` render as live `.entity-link` anchors rather than `.entity-link--missing` spans.

**`buildAllFlowNodeIds`:** exported pure helper (line 2332 of `App.tsx`) that merges flow node ids (process, external, store ids from all diagrams including sub-DFDs) with ERD entity ids into a single `Set<string>`. Used by `FlowNodeModal` and the flow-opened `SelectedEntityModal`'s upgrade pass. Also computed at the app level (`appAllFlowNodeIds`, line 4476) for the top-level flow-opened entity modal path.

**`fromFlow` context flag (CP13):** `openEntityById(id, fromFlow = false)` (line 3422) accepts a second parameter. When `fromFlow = true`, `entityModalOpenedFromFlow` state is set; the modal's FK links, body `[[wiki-links]]`, and process-usage links all call `openEntityById` with `fromFlow = true` so chained navigation stays in place over the Flows view rather than switching to the Dictionary or Graph. The `fromFlow` flag is preserved across chained entity-to-entity navigations (line 4728).

**Flow doc resolver (`buildFlowDocResolver`):** maps doc tokens (kind-qualified `proc:`, `ext:`, `db:`, `cache:`, etc. or bare wiki-link names) to discriminated `FlowDocResult`: `entity` (open `SelectedEntityModal`), `node` (open `FlowNodeModal`), or `doc` (plain markdown dialog). Resolver is keyed by stable id/slug — `title:` overrides on externals/stores do not break `[[wiki-link]]` resolution.

**ZoomControl component (CP22/CP23):** `ZoomControl` (line 3538 of `App.tsx`) is view-agnostic — props: `percent`, `onZoomIn`, `onZoomOut`, `onSetPercent(pct)`, `onReset`. Clicking the readout opens an inline text input (commit on Enter/blur, cancel on Escape). CSS class `.zoom-control` with `.zoom-control-btn`, `.zoom-control-readout`, `.zoom-control-input`, `.zoom-control-reset`. Rendered only when the relevant view is active.

**Graph ZoomControl adapter (CP22):** `cyZoomInRef`, `cyZoomOutRef`, `cySetPercentRef`, `cyZoomResetRef` are wired in the cy-init `useEffect`. `wheelSensitivity: 0.2` passed to cytoscape to tame scroll zoom. 100% = fit-to-view baseline (not cytoscape internal `zoom === 1`). `zoomPercent` state updated by cytoscape's `zoom` event: `Math.round((cy.zoom() / fitZoomRef.current) * 100)`.

**Flows ZoomControl adapter (CP23):** `FlowDiagramSvg` accepts `onZoomChange?: (scale: number) => void` and `onRegisterZoomControl?: (ctrl: { zoomTo, resetFit } | null) => void`. The SVG renderer calls `onZoomChange` on every scale change and calls `onRegisterZoomControl` with imperative handles after first render. `App.tsx` stores scale in `flowScaleRef` and handles in `flowZoomToRef`/`flowResetFitRef`. `flowZoomPercent` state reflects current scale as `Math.round(scale * 100)`. SVG wheel delta tamed to `0.95`/`1.05` per wheel tick (previously `0.9`/`1.1`).

**Graph node position persistence:** [`src/layout-fingerprint.ts`](../../src/layout-fingerprint.ts) exports `layoutFingerprint(model: Model): string` — FNV-1a 32-bit hash over sorted node ids + sorted `source>target` edge pairs. [`src/layout-store.ts`](../../src/layout-store.ts) exports `createLayoutStore(storage?, now?): LayoutStoreHandle` — single localStorage key `ignatius-layout-positions`; newest-10 pruning on `save`.

**DD sidebar process nesting (CP24):** `parseDottedNumber(dn: string): number[]` and `compareDottedProcesses(a, b): number` are module-scope functions (line 2352–2368 of `App.tsx`). `DictionaryView` sorts the process nav list with `[...visibleProcs].sort(compareDottedProcesses)` so processes appear in hierarchical dotted-number order (`1 → 1.1 → 1.2 → 2 → 3`). Depth is derived as `p.dottedNumber.split('.').length - 1`; sub-processes are indented with inline `paddingLeft: calc(1rem + ${depth}rem)` + `fontSize: '0.78rem'`.

**DD card endpoint clickability (CP25):** `DictProcessSection` now accepts `externalIds: Record<string, true>` and `nonDbStoreNames: Record<string, true>` — O(1) membership sets built in `DictionaryView` from `allExternals`/`allNonDbStores`. `canOpenToken(token)` checks whether the name after the colon exists in either set; `onOpenToken(token)` calls `onScrollToSection(name)`. Both are passed to the inner `FlowIoTable` so non-db endpoints that have a DD section become clickable links in the DD card. Endpoints with no DD section stay plain text (no dead link).

**DD card process examples (CP26):** `DictProcessSection` renders `<FlowProcessExamplesSection examples={process.examples} />` after the body, bringing the DD card to parity with the process dialog for CP16 sample-data tables. A process without `examples:` renders nothing.

**Findings panel (shared across views):** `<FindingsPanel>` renders only when `totalFindings > 0`; collapses to badge; present across all three views.

**Warning badges:** [`src/markers.ts`](../../src/markers.ts) exports `drawWarningBadges(cy, svg, entityIds: Set<string>)`.

**Node sizing + label wrapping:** `wrapEntityLabel` ([`src/wrap-label.ts`](../../src/wrap-label.ts)) — underscores → spaces; names longer than ~13 chars break at PascalCase/acronym/digit boundaries.

[`src/types/css-highlight.d.ts`](../../src/types/css-highlight.d.ts) — ambient declarations for CSS Custom Highlight API (`Highlight`, `HighlightRegistry`, `CSS.highlights`). Shadows `lib.dom` `CSS` global; remove once TypeScript ships native declarations (tracked at microsoft/TypeScript#53003).

[`src/styles.css`](../../src/styles.css) additions: `@media print` block for the Dictionary view (CP10), `::highlight(dd-search-highlight)` rule (CP9), `.dict-process-direction` / `.dict-process-direction--read/write/readwrite` direction badges, `--dd-search-highlight` + direction-badge theme vars, `.flow-minimap-wrapper` matched to `.minimap` (left: 16px when DFD nav hidden, matching DG minimap — CP19), `.zoom-control` + child rules for both view adapters (CP22/CP23).

### generators

[`src/generators/app.ts`](../../src/generators/app.ts) (121L) — the sole static HTML generator. `generateApp(model, flowModel, bundle, opts)` writes ONE unified SPA file. Injects the full union of globals: `window.__IGNATIUS_MODE__ = "static"`, `window.__MODEL__`, `window.__FLOW_MODEL__`, `window.__LAYOUT_KEY__`, `window.__FLOW_LAYOUT_KEYS__`, `window.__THEME_MODE__`. `escapeScriptClose` sanitizes injected HTML (flow body markdown can contain `</script>`). `loadBundleFromDir` is imported from `embedded-bundle.ts`. Old separate generators (`dict.ts`, `graph.ts`, `flow-graph.ts`, `flow-dict.ts`, `inline-asset.ts`, `theme-css.ts`) were removed when the SPA was unified.

[`src/generators/embedded-bundle.ts`](../../src/generators/embedded-bundle.ts) (119L) — imports `dist/static/index.html`, `dist/static/index.js`, `dist/static/index.css` as file imports (`with { type: 'file' }`). `loadEmbeddedBundle()` calls `Bun.file().exists()` on all three paths; throws a friendly error with "Run: bun run build:bundle" when missing. Exports `BundleContent` type and `loadBundleFromDir(dir)`.

### theme

[`src/theme-defaults.ts`](../../src/theme-defaults.ts) exports `defaultTheme: ThemeConfig`, `mergeTheme()`, `semanticColors`, `resolveFlowKindPalette()`, `defaultFlowKinds`, `FLOW_KIND_KEYS`, and the `ThemeConfig`/`ThemePalette`/`ThemeSpacing`/`FlowKindEntry`/`FlowKindKey` types. `semanticColors` maps classification names to `{ bg, fg }` pairs per mode. `mergeTheme()` deep-merges a partial user theme over the defaults including the `flowKinds` override map. The `ThemeConfig` type is re-exported from [`src/parse.ts`](../../src/parse.ts).

**Flow kind palette:** `FLOW_KIND_KEYS = ['db','cache','queue','file','doc','manual','other','external']`. `defaultFlowKinds` holds dark + light `FlowKindEntry = { bg, fg, border }` per kind. `ThemeConfig.flowKinds?: Partial<Record<FlowKindKey, Partial<{ dark: Partial<FlowKindEntry>; light: Partial<FlowKindEntry> }>>>` — user overrides from `ignatius.yml` `theme.flowKinds`. `resolveFlowKindPalette(mode, flowKinds?)` merges user overrides over defaults at the `FlowKindEntry` level (partial wins without wiping fg/border). Imported by [`src/App.tsx`](../../src/App.tsx) for `initFlowGraphCore`, `doRender`, and `LegendModal`.

[`src/branding-defaults.ts`](../../src/branding-defaults.ts) — exports `Branding`, `LogoPair`, `CopyrightConfig` types and the default branding config. Imports [`assets/noorm-logo.svg`](../../assets/noorm-logo.svg) as a file reference. `Branding` holds `logo` (dark/light SVG paths), `title`, `subtitle`, `copyright`, and `poweredBy` flag.

### skill

[`skills/noorm-modeling/SKILL.md`](../../skills/noorm-modeling/SKILL.md) (~52L) — project-scoped Claude skill. Frontmatter: `name: noorm-modeling`, triggers on `/noorm-modeling`, `new entity`, `bootstrap a model`, `new ignatius model`, `add entity`. `canonical_sources` lists [`docs/spec/schema-lint-and-error-ux.md`](../../docs/spec/schema-lint-and-error-ux.md), [`docs/spec/derive-classification.md`](../../docs/spec/derive-classification.md), [`docs/spec/ignatius-project-config.md`](../../docs/spec/ignatius-project-config.md), [`docs/design/markdown-driven-erd.md`](../../docs/design/markdown-driven-erd.md).

Two modes: `entity` (add one entity file) and `model` (bootstrap a new model skeleton).

**Authoring convention axis** — detected once per session from existing model shape (key-inherited: composite PK with FK cols inside; orm-oriented: single surrogate `id` PK with FK cols outside). Never asks for `classification` or per-edge `identifying` — derived by the parser automatically.

**Entity flow (CP-1):** E0 locate model root → E1 entity id (PascalCase) → E2 group selection → E3 parent edges → E4 AK columns → E5 regular columns → E6 description → E7 write file → E8 verify with `ignatius validate`. AK step always offered, skippable.

**Model bootstrap flow (CP-2):** B0 model dir path → B1 model name/version/description → B2 first group → B3 write `ignatius.yml` + `_groups/<slug>.md` → B4 offer to run entity flow.

Skill writes real files and runs `ignatius validate <model-dir> 2>&1` to verify output; exits verify loop only when validate exits 0 or user aborts.

Coupling: references [`docs/spec/noorm-modeling-skill.md`](../../docs/spec/noorm-modeling-skill.md), [`docs/design/noorm-modeling-skill.md`](../../docs/design/noorm-modeling-skill.md), [`docs/spec/derive-classification.md`](../../docs/spec/derive-classification.md), [`docs/spec/ignatius-project-config.md`](../../docs/spec/ignatius-project-config.md), [`docs/spec/schema-lint-and-error-ux.md`](../../docs/spec/schema-lint-and-error-ux.md).

### docs

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
[`docs/spec/unified-app-polish.md`](../../docs/spec/unified-app-polish.md) (191L) — implementation contract for CP1–CP13 unified-app-polish batch: minimap parity, per-view FAB, DFD URL navigability, external/store dedup body, fused dict + titlelize, db-store rich dialog, entity↔process cross-reference, process dialog entity links, DD search highlight, shared modal primitive, subprocess elevation, DD body links, external/store DD body parity + `fromFlow` in-place navigation. CP3 follow-up documented: sub-DFD deep links now survive refresh via `findDiagramPath` breadcrumb-stack rebuild on initial render; CP3 visual test cases G + G2 added.
[`docs/spec/dfd-polish-round2.md`](../../docs/spec/dfd-polish-round2.md) (166L) — implementation contract for CP14–17 DFD polish round 2: no text-select on DFD nodes (CP14), kind-colored stores/externals with YAML-overridable `theme.flowKinds` palette (CP15), per-process in/out data examples rendered as tables in process dialog (CP16), shared glossary [`docs/glossary.md`](../../docs/glossary.md) (CP17).
[`docs/spec/dfd-polish-round3.md`](../../docs/spec/dfd-polish-round3.md) (235L) — implementation contract for CP18–23 DFD polish round 3: navigator lifecycle teardown on view-switch (CP18), DFD minimap visual alignment to DG minimap (CP19), clickable IO table endpoints in process dialogs (CP20), Processes cross-reference section in external/store dialogs via `buildFlowNodeUsageIndex` (CP21), view-agnostic `ZoomControl` component wired to Graph via cytoscape adapter (CP22), ZoomControl wired to Flows view via `FlowDiagramSvg` imperative handles (CP23).
[`docs/glossary.md`](../../docs/glossary.md) (52L) — canonical vocabulary: DG (Data Graph), DD (Data Dictionary), DFD (Data Flow Diagram), DE (Data Entity), DS (Data Store), EE (External Entity), Process, Data Flow. States DS ⊃ DE (every `db:` store is a data entity; non-`db` stores are not). Lists all `kind:` values and their colors.

### scripts

[`scripts/stable-names.ts`](../../scripts/stable-names.ts) — post-build: copies `index-*.js` and `index-*.css` in `dist/static/` to stable names. Required step before `bun build --compile`.
[`scripts/convert-yaml-to-md.ts`](../../scripts/convert-yaml-to-md.ts) (257L) — one-time migration script.
[`scripts/probe.ts`](../../scripts/probe.ts) (95L) — ad-hoc diagnostic script.
[`scripts/screenshot.ts`](../../scripts/screenshot.ts) (82L) — Playwright screenshot helper.

## Cross-cutting

- [`trash/`](../../trash) contains v1 components and engine code (YAML-driven), superseded by current markdown-driven implementation. Not imported anywhere in [`src/`](../../src).
- [`test/`](../../test) is exploratory tooling organized into `checks/` (CI-run assertions), `visual/` (Playwright, manual only), `fixtures/` (model roots + YAML data), `notes/` (markdown). Not a formal suite. [`test/checks/test-findings-panel.ts`](../../test/checks/test-findings-panel.ts) is a Playwright check in the `checks/` dir — CI will attempt to run it.
- [`models/`](../../models) is a container of four sibling model roots — `key-inherited/`, `orm-hybrid/`, `orm-pure/`, `broken-demo/` — each with its own `ignatius.yml`. `broken-demo/` is the deliberately-broken fixture (4 global + 8 entity = 12 total findings). `key-inherited/` carries demo DFDs under `flows/` (order-to-cash with sub-DFD + refund), including `_stores/gateway-log.md` (non-entity `file:` store). Reference/fixture data, not a domain.
- [`src/titlelize.ts`](../../src/titlelize.ts) — imported by [`src/flow-parse.ts`](../../src/flow-parse.ts) only. [`src/flow-usage-index.ts`](../../src/flow-usage-index.ts) — exports `buildEntityUsageIndex` and `buildFlowNodeUsageIndex`; imported by [`src/App.tsx`](../../src/App.tsx) only. [`src/types/css-highlight.d.ts`](../../src/types/css-highlight.d.ts) — ambient declarations consumed globally.
- [`src/layout-fingerprint.ts`](../../src/layout-fingerprint.ts) imported by [`src/server.ts`](../../src/server.ts) (for `/api/model`), [`src/generators/app.ts`](../../src/generators/app.ts) (for static `__LAYOUT_KEY__` injection). [`src/layout-store.ts`](../../src/layout-store.ts) imported only by [`src/App.tsx`](../../src/App.tsx). [`src/wikilink.ts`](../../src/wikilink.ts) imported by [`src/parse.ts`](../../src/parse.ts) and [`src/flow-parse.ts`](../../src/flow-parse.ts).
- [`src/open-browser.ts`](../../src/open-browser.ts) is dynamically imported by [`src/cli.ts`](../../src/cli.ts) only when `--open` is passed to `serve`.
- [`src/types/file-imports.d.ts`](../../src/types/file-imports.d.ts) — ambient module declarations for `*.html`, `*.css` imports. [`src/types/cytoscape-navigator.d.ts`](../../src/types/cytoscape-navigator.d.ts) — ambient declarations for `cytoscape-navigator`. [`bun-env.d.ts`](../../bun-env.d.ts) — ambient Bun type augmentations.
- [`src/parse.ts`](../../src/parse.ts) exports canonical model types (`Model`, `ModelNode`, `ModelEdge`, `SubtypeCluster`, `Cardinality`, `GroupConfig`, `ColumnDef`, `ModelMeta`, `Predicate`) and `ParseResult`, plus `normalizePredicate`. `ModelNode` carries `bodyLinks?: string[]`. [`src/validate.ts`](../../src/validate.ts) exports `ValidationResult`, `EntityError`, `GlobalError`, `RuleId`, `RuleEntry`, `RULES`. Both imported by [`src/App.tsx`](../../src/App.tsx), [`src/server.ts`](../../src/server.ts), and [`src/cli.ts`](../../src/cli.ts).
- Findings flow: `parse.ts` → `ParseResult.globalErrors` (parse-time) + `validateModel()` → `ValidationResult.globalErrors + .entityErrors` + optional `validateFlows()` → `FlowValidationResult.flowErrors` → merged by callers before rendering.
- CLI subcommand status: `serve` ✓ active; `validate` ✓ active; `export` ✓ active; `version` ✓ active; `update` ✓ active; `dict` ✗ removal stub; `graph` ✗ removal stub; `flow` ✗ removal stub.
- Binary name is `ignatius` (`dist/ignatius`); package.json `name` is `ignatius`. The repo *directory* `derek-db-generator/` is the only remaining `derek` reference — a known leftover.
- [`assets/noorm-logo.svg`](../../assets/noorm-logo.svg) — default branding logo, imported by [`src/branding-defaults.ts`](../../src/branding-defaults.ts) as a file reference.
- Deterministic substrate: [`.claude/project/deterministic-signals.md`](deterministic-signals.md)
