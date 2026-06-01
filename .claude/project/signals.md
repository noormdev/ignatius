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

`test/` is organized into subdirectories — not a formal test-framework suite:

- `test/checks/` — 46 raw assertion scripts (PASS/FAIL/throw). Run by `bun run test` and CI. Includes `test-validate-entity.ts` and `test-validate-refs.ts` which pin `key-inherited` as the clean baseline and `broken-demo` as the broken fixture. `test-validate-refs.ts` expects 4 global + 8 entity = 12 total findings (1 additional `body.unknown_link` from `broken-demo/Order.md`'s `[[Cart]]` link). `test-api-model.ts` asserts `layoutKey` field is present in `/api/model` response. `test-layout-fingerprint.ts` (255L) and `test-layout-store.ts` (157L) pin the fingerprint / localStorage helper. `test-layout-key-injection.ts` (132L) asserts `window.__LAYOUT_KEY__` in static graph HTML. `test-wikilink.ts` covers the `[[…]]` inline rule. `test-validate-body-links.ts` covers `body.unknown_link` emission. `test-open-browser.ts` covers `browserOpenCommand` argv mapping.
- `test/visual/` — 16 Playwright screenshot scripts for manual visual inspection. NOT run by `bun run test`. Includes `screenshot-position-persist.ts` (drag→reload→restore-all-nodes + reset→ELK).
- `test/fixtures/` — 3 YAML fixtures loaded by check scripts.
- `test/notes/` — 2 markdown dev notes.

No linter or formatter configured in package.json.

## Language breakdown

| Language | LOC | Files | % |
|----------|-----|-------|---|
| TypeScript | 17454 | 113 | 57% |
| Markdown | 10279 | 145 | 33% |
| YAML | 1318 | 10 | 4% |
| CSS | 1065 | 2 | 3% |
| Shell | 116 | 1 | 0% |
| JSON | 101 | 4 | 0% |
| HTML | 27 | 2 | 0% |
| TOML | 2 | 1 | 0% |

## DevOps & CI

- CI provider: GitHub Actions (`.github/workflows/ci.yml`). Triggers on all branch pushes and PRs to master/main.
- CI pipeline: install deps → cache Playwright → build bundle + stable-names → compile binary → run all `test/checks/*.ts` → typecheck (`continue-on-error: true`).
- Release pipeline: `.github/workflows/release-please.yml` (release-please driven; a `build` job gated on `release_created` compiles the 5 platform binaries + checksums and attaches them to the release in the same push-to-main run). `install.sh` (repo root) is the curl-able CLI installer that pulls those binaries from `releases/latest/download`.
- Binary is built locally or in CI via `bun run build:cli`; produces `dist/ignatius`.
- package.json `name` is `ignatius`. The repo *directory* is still named `derek-db-generator/` — the one remaining derek reference, a known leftover.

---

## Domains

| Domain | Repo paths | One-liner | Detail |
|--------|------------|-----------|--------|
| cli | src/cli.ts, src/discover.ts, src/resolve-model.ts, src/version.ts, src/update.ts, src/serve-port.ts, src/open-browser.ts | citty-based subcommand dispatch (serve/dict/graph/validate/version/update); model-root discovery + interactive picker; port fallback + browser open on serve; findings printed to stderr; self-update + version reporting | (below) |
| server | src/server.ts | Bun.serve with /dict + /api/model + /events SSE + fs.watch live-reload; /api/model returns parse+validate payload including layoutKey | (below) |
| parser | src/parse.ts, src/wikilink.ts | `ignatius.yml` config loading → ParseResult: {model, globalErrors}; nodes, edges, cardinality + classification derivation; wiki-link inline rule + two-pass body rendering with bodyLinks | (below) |
| validate | src/validate.ts | Pure model validator: 14 rules across 4 domains (parse/entity/body/edge/cluster), two severity tiers (A=warn, B=omit); coerces invalid pk/columns to safe defaults in cleanedModel | (below) |
| frontend | src/App.tsx, src/hash-router.ts, src/main.tsx, src/index.html, src/styles.css, src/markers.ts, src/wrap-label.ts, src/layout-fingerprint.ts, src/layout-store.ts | React 19 Cytoscape.js graph viewer; live/static mode flag; findings panel, global error banner, entity warning badges; label-sized nodes; graph node position persistence keyed by structural fingerprint | (below) |
| generators | src/generators/ | Static HTML output: dict (findings-aware), graph (embeds React bundle + mode flag + layoutKey injection), inline-asset inliner, theme CSS vars | (below) |
| theme | src/theme-defaults.ts, src/branding-defaults.ts, src/generators/theme-css.ts | ThemeConfig + Branding types, default palettes, dark/light merging, CSS var generation | (below) |
| skill | skills/noorm-modeling/ | Project-scoped Claude skill: Q&A-driven entity authoring + model bootstrap, convention-aware, writes files + verifies with `ignatius dict` | (below) |
| docs | docs/ | Design docs, CLI spec, project-config spec, derive-classification spec, schema-lint-and-error-ux spec, modeling-skill spec, bidirectional-predicates spec, graph-position-persistence spec, wiki-entity-links spec | (below) |
| scripts | scripts/ | Build helpers: stable-names.ts, convert-yaml-to-md.ts, probe.ts, screenshot.ts | (below) |

## Domain detail

### cli

`src/cli.ts` is the binary entry point. Six subcommands (`serve`, `dict`, `graph`, `validate`, `version`, `update`) built with `citty` `defineCommand`; dispatched via `runMain(main)`. The four model subcommands accept an optional positional `[path]` (search base, default: cwd) and a `--model <key>` flag. `serve` is also registered under the `server` alias key. Its port flag is `--port`/`-p` (string, `isNaN`-validated, exits 1 on invalid); `-p` carries `alias: 'p'` so `serve -p 3030` is parsed as the port, not swallowed as the positional path. `main` meta sets `version: VERSION`, so citty's builtin `--version`/`-v` flag prints it.

`serve` delegates binding to `serveWithPortFallback` in `src/serve-port.ts`. When the requested port is taken (`EADDRINUSE`), TTY runs prompt for a port via `@clack/prompts` `text` defaulting to the next free port (`findAvailablePort` probes upward); non-TTY runs auto-advance (`port+1`, retrying the real bind — no probe, no TOCTOU) and logs `Port N is in use — trying N+1.`. `serve-port.ts` exports `isAddrInUse`, `findAvailablePort`, `serveWithPortFallback`; `serveWithPortFallback` returns the port the server actually bound to. After binding, `serve` in `cli.ts` reads the returned port: when `args.open` is true (`-o`/`--open` boolean flag), it dynamically imports `src/open-browser.ts` and calls `openBrowser(`http://localhost:${boundPort}`)`.

`src/open-browser.ts` exports `browserOpenCommand(platform, url): string[]` (pure, maps platform to OS open argv — `open` on darwin, `cmd /c start "" url` on win32, `xdg-open` on other) and `openBrowser(url, platform?)` (fire-and-forget `Bun.spawn`, swallows errors so a missing opener never takes down the server). Dynamically imported by `cli.ts` only on `--open` to keep the dependency out of the hot path.

`src/version.ts` exports `VERSION` from a JSON import of `package.json` — Bun inlines it at `--compile` time, so the binary reports the release it was built from. `version` subcommand prints `VERSION`.

`src/update.ts` powers `update` (flags `--check`, `--yes`/`-y`). Exports pure helpers (`parseVersion`, `compareVersions`, `parseTagFromLocation`, `assetForPlatform`, `parseChecksums`, `checkForUpdate`) + `runUpdateCommand`. Resolves the latest tag via the `releases/latest` redirect Location header (no GitHub API → no rate limit), compares semver, and on consent downloads the platform asset, verifies sha256 against `checksums.txt`, and atomically renames it over `process.execPath`. Guards: dev runtime (execPath basename `bun`/`node`) → no self-replace; win32 → manual-download message; non-TTY without `--yes` → report-only; EACCES/EPERM → sudo/install-script hint. `@clack/prompts` `confirm` for the TTY prompt.

`dict` and `graph` subcommands: call `parseModels(dir)` → destructure `{ model, globalErrors: parseGlobalErrors }` → dynamic-import `{ validateModel, formatFindingsForStderr }` from `./validate` → merge `allGlobalErrors = [...parseGlobalErrors, ...validation.globalErrors]` → call `formatFindingsForStderr(allGlobalErrors, validation.entityErrors)` and write each line to `process.stderr` → write output HTML → `process.exit(allGlobalErrors.length > 0 ? 1 : 0)`. Exit code 1 when any global errors are present; 0 otherwise.

`dict` subcommand passes `renderModel = { ...model, nodes: validation.cleanedModel.nodes }` (coerced-safe node shapes, raw edges) to `generateDict` — raw edges are preserved so the dict can render `dict-link-missing` affordances for dangling FKs even when their targets are absent. `graph` subcommand passes the raw `model` to `generateGraph`.

`graph` dynamic-imports `loadEmbeddedBundle` at runtime with try/catch that prints "Run: bun run build:bundle" on failure.

`validate` subcommand: same `parseModels` → `validateModel` → `formatFindingsForStderr` → stderr flow as `dict`/`graph`, but writes no HTML output. Prints a one-line stdout summary (`✓ … valid` / `✗ … N error(s), M warning(s)`) and `process.exit(allGlobalErrors.length > 0 ? 1 : 0)`. The validate-only quality gate used by the noorm-modeling skill's verification loop.

`src/discover.ts` — pure model-root resolver. Exports `resolveModel(base, opts): Promise<ResolveResult>` and `ModelCandidate` / `ResolveResult` types. A model root is any directory containing `ignatius.yml`. Algorithm: (1) base itself has `ignatius.yml` → single; (2) search down (skipping `_*`, `node_modules`, `.git`, `dist`, `tmp`, `trash`, `.worktrees`, `.claude`); (3) if nothing found, walk up toward fs root (or optional `ceiling`); (4) exactly 1 found → single; (5) multiple + `--model` key → filter; (6) multiple + no key → many. `ResolveResult` discriminated union: `single | many | no-match | none`.

`src/resolve-model.ts` — shared CLI helper. Exports `pickModel(base, modelKey): Promise<string>`. Calls `resolveModel`, handles all four result kinds: single → return dir; none → stderr + exit 1; no-match → stderr + exit 1; many + non-TTY → stderr key list + exit 2; many + TTY → `@clack/prompts` `select` picker (cancel → exit 130). `@clack/prompts` is also imported by `serve-port.ts` (port prompt) and `update.ts` (confirm prompt).

### server

`src/server.ts` exports `serveCommand(modelsDir, opts)` returning `{ server, stop }`. Routes: `GET /` → bundled React HTML, `GET /dict` → server-rendered dict HTML (accepts `?theme=light|dark`), `GET /api/model` → JSON payload `{ model, parseGlobalErrors, validation, layoutKey }` where `validation = { entityErrors, globalErrors, cleanedModel }` and `layoutKey = layoutFingerprint(model)`, `GET /api/asset` → model-dir asset proxy (path traversal blocked), `GET /events` → SSE stream. The `/dict` handler calls `parseModels()` then `validateModel()`, constructs `renderModel = { ...model, nodes: validation.cleanedModel.nodes }` (coerced-safe nodes + raw edges), and passes it with merged findings and `{ modelsDir, graphHref: '/', surface: 'live' }` to `generateDict()` — `graphHref: '/'` wires the dict FAB's "Data Graph" link back to the graph viewer in live mode. The CLI `dict` subcommand omits `graphHref` so static exports have no "Data Graph" item. The `/api/model` handler imports `layoutFingerprint` from `./layout-fingerprint` and includes `layoutKey` in the JSON response. SSE timeout disabled via `server.timeout(req, 0)`. `fs.watch` watches the models dir recursively; only `.md` and `.yaml` extensions trigger events. Debounce: 200ms coalesce. SSE event name: `model-changed`. `stop()` closes the watcher, clears debounce timer, clears SSE client set, stops Bun server.

### parser

`src/parse.ts` exports `parseModels(dir): Promise<ParseResult>`. `ParseResult = { model: Model; globalErrors: GlobalError[] }` — the return type carries parse-time errors (`parse.invalid_yaml`, `parse.missing_id`, `parse.empty_frontmatter`) up to the caller. Config loading: reads a single `ignatius.yml` at the model root; top-level keys `name`, `version`, `description`, `updated` populate `_meta`; `theme:` block deep-merged via `mergeTheme()`; `branding:` block merged via `mergeBranding()`. `Model` type: `{ groups, nodes, edges, subtypeClusters, theme, branding, _meta? }`. Entity classification fully derived (5-rule order): Classifier → Subtype → Associative → Dependent → Independent. `identifying` per edge also derived. `deriveCardinality()` uses derived `identifying` + nullability + AK membership. Body markdown rendered to HTML via markdown-it at parse time.

**Wiki-links (two-pass body rendering):** `src/parse.ts` imports `wikiLinkPlugin` and `WikiLinkEnv` from `src/wikilink.ts` and calls `md.use(wikiLinkPlugin)` at module load. `ModelNode` carries `bodyLinks?: string[]` — entity ids referenced via `[[…]]`, in source order. Body rendering is deferred to a second pass after all entity ids are known: `const env = { knownIds: new Set(allNodeIds), links: [] }; bodyHtml = md.render(rawNode.body, env); bodyLinks = env.links`. Group descriptions are rendered without `env` (parsed before the id set is built) — their links render optimistically. `src/wikilink.ts` exports `WikiLinkEnv`, `splitWikiTarget(inner): { target, label }`, and `wikiLinkPlugin(md)`. The inline rule inserts before `'link'` in markdown-it's inline ruler. Valid links emit `<a class="entity-link" data-entity="…" href="#entity-…">…</a>`; unknown links emit `<span class="entity-link entity-link--missing" …>`. Targets and labels are escaped via `md.utils.escapeHtml`. Absent `knownIds` → optimistic (no missing mark).

**Predicates:** `Predicate = { fwd: string; rev: string }` and `normalizePredicate(raw): Predicate`. `ModelEdge.predicate` is always a normalized `Predicate`. `models/key-inherited/` uses object form; `models/orm-hybrid/` and `models/orm-pure/` use string form.

### validate

`src/validate.ts` — pure module with no Node/Bun I/O; imports only types from `./parse`. Browser-safe and unit-testable with plain Model literals.

Exports: `validateModel(model: Model): ValidationResult`, `formatFindingsForStderr(globalErrors, entityErrors): string[]`, `RULES: Record<RuleId, RuleEntry>`, types `RuleId`, `EntityError`, `GlobalError`, `ValidationResult`, `RuleEntry`.

`RuleId` union: 14 rules across 4 domains — parse (`parse.invalid_yaml`, `parse.missing_id`, `parse.empty_frontmatter`), entity (`entity.missing_pk`, `entity.missing_columns`, `entity.invalid_field_type`, `entity.unknown_group`, `entity.example_unknown_column`), body (`body.unknown_link`), edge (`edge.unknown_target`, `edge.dangling_fk_column`), cluster (`cluster.missing_basetype`, `cluster.missing_member`, `cluster.no_discriminator`).

`RuleEntry.class` field: `'A'` = render degraded + warning triangle (entity stays in model); `'B'` = omit + global banner (entity/edge/cluster stripped from cleanedModel). `RuleEntry.liveOnly?: boolean` — when true, `formatFindingsForStderr` omits the rule from CLI stderr and static dict findings; currently only `entity.example_unknown_column` carries this flag. `body.unknown_link` is Class A, not `liveOnly` — appears on all surfaces including CLI stderr.

`checkBodyLinks(node, nodeIds): EntityError[]` — one `body.unknown_link` warning per distinct unknown target in `node.bodyLinks`; `entityId` is the linking node.

`ValidationResult = { entityErrors: EntityError[]; globalErrors: GlobalError[]; cleanedModel: Model }`. `cleanedModel` has dangling edges and broken clusters removed, AND has nodes with invalid pk/columns shapes coerced to safe defaults (`pk → []`, `columns → {}`) so downstream render paths never crash on bad data.

`RULES` is a `Record<RuleId, RuleEntry>` — TypeScript compile-errors if any RuleId is missing an entry.

`formatFindingsForStderr` sorts rows: errors before warnings, ruleId alphabetical within severity, location alphabetical within ruleId. Format: `"<sev>  <ruleId>  <location>  <message>"`.

`checkMissingColumns` fires when `columns` is missing OR when the object exists but is empty (`Object.keys(...).length === 0`). `checkClusterNoDiscriminator` fires only on exclusive clusters (`cluster.exclusive === true`); inclusive clusters (`exclusive: false`) are exempt.

CP-1 (entity rules) is implemented; parse.* rules (CP-2) are defined in `RuleId` and `RULES` registry but emitted by `parse.ts`, not `validateModel`. `validateModel` receives an already-parsed `Model` — parse-time errors travel separately as `parseGlobalErrors`.

### frontend

`src/App.tsx` is the single React component. Cytoscape.js initialized with `cytoscape-elk` layout and `cytoscape-navigator` plugin for the minimap. `window.__MODEL__`, `window.__THEME_MODE__`, `window.__IGNATIUS_MODE__` ('live' | 'static'), and `window.__LAYOUT_KEY__` are injection points read at startup. `src/index.html` sets `window.__IGNATIUS_MODE__ = 'live'` via an inline script in `<body>`. `window.__IGNATIUS_CY__` is set to the Cytoscape instance on init and cleared to `undefined` on teardown — debug/test seam only, not part of the public API.

**Graph node position persistence:** `src/layout-fingerprint.ts` exports `layoutFingerprint(model: Model): string` — FNV-1a 32-bit hash over sorted node ids + sorted `source>target` edge pairs. Invariant to non-structural edits (predicates, columns, body, group, theme). Pure function; hand-rolled (not `Bun.hash`) so it is trivially unit-testable against `Model` literals. `src/layout-store.ts` exports `createLayoutStore(storage?, now?): LayoutStoreHandle` — single localStorage key `ignatius-layout-positions` holding `{[layoutKey]:{positions,savedAt}}`; newest-10 pruning on `save`; `storage` and `now` are dependency-injected for testing. `LayoutStoreHandle` exposes `load(layoutKey)`, `save(layoutKey, positions)`, `clear(layoutKey)`. In `App.tsx`: `layoutKeyRef` (`useRef<string>('')`) holds the live key — updated from `window.__LAYOUT_KEY__` in static mode, or from `/api/model` payload's `layoutKey` field in live mode (including after SSE rebuilds). On `free` node event: debounced 400ms `save` of all non-parent node positions (`!node.isParent()` skips compound parents so subtype-cluster children are not position-anchored independently). In `cy.one('layoutstop')` block: restores saved positions before fit when `layoutKeyRef.current` has a matching entry. "Reset layout" FAB item via `resetLayoutRef`: cancels pending save timer, calls `layoutStore.clear(layoutKeyRef.current)`, re-runs ELK from scratch with fit. `elkLayoutOpts` const extracted from the init block and reused by the reset path.

**Wiki-link click delegation:** the modal `.doc-body` div has an `onClick` handler that narrows `e.target` with `instanceof Element`, calls `closest('a[data-entity]')`, calls `preventDefault()`, then drives `onNavigate(id)` for the target entity — reusing the FK-link navigation path. No casts.

**Node sizing + label wrapping:** the `node` style sizes each box to its label (`width: 'label'`, `height: 'label'`, `padding`, `text-wrap: 'wrap'`, `text-max-width` safety net). Node labels pass through `wrapEntityLabel` (`src/wrap-label.ts`, pure + framework-free, unit-tested in `test/checks/test-wrap-label.ts`): underscores → spaces, names longer than ~13 chars break onto multiple lines at PascalCase/acronym/digit boundaries (greedy packing, no characters lost), keeping long entity names compact.

**Mode dispatch in App.tsx:** `useEffect` reads `window.__IGNATIUS_MODE__`. Static mode (`'static'`): reads `window.__MODEL__` and `window.__LAYOUT_KEY__`, calls `validateModel()` locally, sets findings from result. Live mode (default): fetches `/api/model`, reads `{ model, parseGlobalErrors, validation, layoutKey }` payload, merges `parseGlobalErrors + validation.globalErrors` as `allGlobal`, updates findings state and `layoutKeyRef`; also subscribes to SSE `model-changed` events for live reload.

**Findings panel:** `<FindingsPanel>` is a persistent `<aside class="findings-panel">` in the top-right corner. Renders only when `totalFindings > 0`. Collapses to a badge (`<button class="findings-panel-badge">`) on collapse click. Rows link entity-scoped findings to graph navigation (pan + select). `<header class="findings-panel-header">` contains title and `<button class="findings-panel-collapse">`. Row list is `<ul class="findings-panel-list">`.

**Global error banner:** `<div class="graph-global-banner">` rendered when `findings.globalErrors.length > 0` and `bannerDismissed` is false. Close button sets `bannerDismissed = true`. Banner is reset to visible on each fresh `/api/model` response.

**Warning badges:** `src/markers.ts` exports `drawWarningBadges(cy, svg, entityIds: Set<string>)` — draws ⚠ corner badges on Cytoscape nodes with findings. `updateMarkers` reads `edge.hasClass('faded')` per edge and passes it to `drawEndMarker`; `drawEndMarker` accepts a `faded: boolean` parameter and sets `opacity="0.3"` on the SVG `<g>` element when true. `updateMarkers` computes `scale = Math.min(Math.max(zoom, minScale), maxScale) * 0.5`. `drawEndMarker` for `'many'` cardinality does not apply `markerOffset` — the crow's-foot prongs start at the node boundary.

**Predicate edge labels + direction-aware arrows:** Cytoscape edge data carries `predicateFwd`, `predicateRev`, `edgeLabel` (active display label), and `predicateMode` ('fwd' | 'rev'). `applyArrow(edge, verb, dir)` computes screen-direction from source/target endpoints and wraps the verb with `→` or `←` so arrows always point toward the intended end even when Cytoscape's autorotate flips text 180°. `refreshArrows()` iterates all edges and re-applies `applyArrow` respecting the current `predicateMode`; it is bound to `layoutstop`, `position`, `drag`, and `free` node events. On `mouseover` node N: edges where `edge.target() === N` flip `predicateMode` to `'rev'` and call `applyArrow` with the rev verb. The kept (non-faded) set is built as the union of `N.closedNeighborhood()`, joiner-incoming elements, and the result of `collectLineage(N)`. `collectLineage` walks incoming `identifying = "true"` edges upward from N to the root(s), accumulating those edges and their source nodes; stops when no more identifying incomers exist (referential edges break the climb). All elements outside `keep.union(keep.ancestors())` receive the `.faded` CSS class; N receives `.hover-focus`. On `mouseout`: all edges restore to `'fwd'` mode, `.faded` and `.hover-focus` are removed from all elements, and `redrawMarkers()` is called.

**Cytoscape style selectors for hover:** `buildStyles` appends `.faded { opacity: 0.3 }` and `node.hover-focus { border-width: 3 }` to the stylesheet.

`src/hash-router.ts` — pure module, exports `parseHash(hash): HashState` and `serializeHash(state): string`. Hash format: `#entity=<id>&zoom=<n>&pan=<x>,<y>`. App.tsx uses hash state for viewport + entity persistence; writes via `history.replaceState` with 200ms debounce; reads on `hashchange` with `lastWrittenHash` guard. `App.tsx` imports model types from `./parse`, validate types/RULES from `./validate` — no local type redeclarations. `src/types/cytoscape-navigator.d.ts` — ambient declarations for `cytoscape-navigator`; augments `cytoscape.Core` with `navigator()` method.

### generators

`src/generators/dict.ts` — signature: `generateDict(model, findings, mode, opts)` where `opts` accepts `modelsDir`, `graphHref`, and `surface`. `graphHref`, when present, wires the FAB's "Data Graph" item; omitted in static CLI export, present in live server mode (`'/'`). Theme applied via `data-theme` attribute on `<html>`; dark and light CSS custom properties emitted under `:root[data-theme="dark"]` and `:root[data-theme="light"]`; initial theme restored from `localStorage` before paint to avoid flash. Entity body HTML includes wiki-link anchors (`<a class="entity-link" data-entity="…">`) and missing-link spans (`<span class="entity-link entity-link--missing">`); `.entity-link` and `.entity-link--missing` are styled in the dict's inline CSS (valid: link colour + underline border; missing: muted colour, `cursor: not-allowed`, dashed border).

**Dict theme toggle:** `.dict-theme-toggle` — fixed top-right, 36×36px circle. Persists to `localStorage` under `ignatius-theme`.

**Dict findings panel:** `<aside class="dict-findings-panel">` rendered top-right (below theme toggle at `top: 64px`) when `totalFindings > 0`. Collapses to `<button class="dict-findings-panel-badge">` on collapse. Lists global errors then entity errors; entity rows link to `#entity-<id>` anchors; `edge.unknown_target` rows link to `#missing-<id>` stubs. Collapse/expand driven by inline JS in generated HTML.

**Dict FAB:** `.dict-fab` — fixed bottom-right, 48px circle. Menu items: "Toggle sidebar" (opens/closes `.dict-nav-panel`), "Copy link", "Data Graph" (link to `graphHref`, rendered only when provided).

**Reader legend:** `<details class="reader-legend" open>` rendered before group sections. Sections: Groups, Classification, Predicate pills, Relationship type, Cardinality.

**Predicate pills in relationship table:** `renderRelationshipsTable` renders `.rel-table--predicates`. When `fwd !== rev`: `.predicate-pill--primary` (child's-perspective: `predicate.rev` + `→` arrow) and `.predicate-pill--inverse` (`←` arrow + `predicate.fwd`). When `fwd === rev`: single `.predicate-pill--shared`.

`src/generators/graph.ts` (125L) — signature: `generateGraph(model, mode, sourceOrDir)`. Imports `layoutFingerprint` from `../layout-fingerprint`. Injects `window.__IGNATIUS_MODE__ = "static"`, `window.__MODEL__`, `window.__THEME_MODE__`, and `window.__LAYOUT_KEY__ = ${JSON.stringify(layoutKey)}` as a synchronous `<script>` before the React module script. Strips the live-mode body script (`window.__IGNATIUS_MODE__ = 'live'`) so the static injection's `'static'` value wins. `layoutKey` is computed once via `layoutFingerprint(model)` inside `generateGraph`.

`src/generators/embedded-bundle.ts` — imports `dist/static/index.html`, `dist/static/index.js`, `dist/static/index.css` as file imports (`with { type: 'file' }`). These must be stable (non-hashed) names so `bun build --compile` can embed them. `loadEmbeddedBundle()` calls `Bun.file().exists()` on all three paths before reading; throws a friendly error message including "Run: bun run build:bundle" when any are missing. Used only by the `graph` subcommand via dynamic import in `src/cli.ts`.

`src/generators/inline-asset.ts` — converts local file paths (SVG, PNG, JPG, WebP, GIF) to inline `data:` URIs for embedding in static HTML output. Used by branding-aware generators.

`src/generators/theme-css.ts` — `buildThemeCssVars(theme, mode)` generates CSS custom property declarations as a string for embedding in static outputs.

### theme

`src/theme-defaults.ts` exports `defaultTheme: ThemeConfig`, `mergeTheme()`, `semanticColors`, and the `ThemeConfig`/`ThemePalette`/`ThemeSpacing` types. `semanticColors` maps classification names (e.g. `subtype`, `kernel`) to `{ bg, fg }` pairs. `mergeTheme()` deep-merges a partial user theme over the defaults. The `ThemeConfig` type is re-exported from `src/parse.ts`.

`src/branding-defaults.ts` — exports `Branding`, `LogoPair`, `CopyrightConfig` types and the default branding config. Imports `assets/noorm-logo.svg` as a file reference. `Branding` holds `logo` (dark/light SVG paths), `title`, `subtitle`, `copyright`, and `poweredBy` flag.

### skill

`skills/noorm-modeling/SKILL.md` (~52L) — project-scoped Claude skill. First (and only) entry in `skills/`. Frontmatter: `name: noorm-modeling`, triggers on `/noorm-modeling`, `new entity`, `bootstrap a model`, `new ignatius model`, `add entity`. `canonical_sources` lists `docs/spec/schema-lint-and-error-ux.md`, `docs/spec/derive-classification.md`, `docs/spec/ignatius-project-config.md`, `docs/design/markdown-driven-erd.md`.

Two modes dispatched from a positional arg: `entity` (add one entity file) and `model` (bootstrap a new model skeleton). Missing/unknown arg prompts the user to choose.

**Authoring convention axis** — detected once per session from existing model shape (key-inherited: composite PK with FK cols inside; orm-oriented: single surrogate `id` PK with FK cols outside). Never asks the user for `classification` or per-edge `identifying` — those are derived by the parser automatically.

**Entity flow (CP-1):** E0 locate model root → E1 entity id (PascalCase) → E2 group selection (with sub-flow E2a to create a missing group) → E3 parent edges (key-inherited only: PK ancestry; orm-oriented: FK columns) → E4 AK columns → E5 regular columns → E6 description → E7 write file → E8 verify with `ignatius dict`. AK step always offered, skippable.

**Model bootstrap flow (CP-2):** B0 model dir path → B1 model name/version/description → B2 first group → B3 write `ignatius.yml` + `_groups/<slug>.md` → B4 offer to run entity flow for first entity.

Skill writes real files and runs `ignatius dict <model-dir> 2>&1` to verify output; exits the verify loop only when dict exits 0 or the user aborts.

Coupling: references `docs/spec/noorm-modeling-skill.md`, `docs/design/noorm-modeling-skill.md`, `docs/spec/derive-classification.md`, `docs/spec/ignatius-project-config.md`, `docs/spec/schema-lint-and-error-ux.md`. Changes to any of those specs may require updating this skill's Q&A logic or verification steps.

### docs

`docs/design/bidirectional-predicates.md` — design doc for the bidirectional predicate feature: `{ fwd, rev }` shape, normalization rules, graph hover-swap UX, dict rendering.
`docs/design/cli-and-outputs.md` — design doc for CLI modes and static output approach.
`docs/design/markdown-driven-erd.md` — design doc for markdown-driven entity file format.
`docs/design/branding.md` — design doc for branding system (logo, title, copyright, poweredBy flag).
`docs/design/dict-navigation.md` — design doc for data dictionary navigation (side nav, anchors).
`docs/design/viewer-fab-ux.md` — design doc for floating action button UX in the graph viewer.
`docs/design/ignatius-project-config.md` — design doc for `ignatius.yml` as model-root marker + single config file; model discovery algorithm; citty + clack tooling rationale.
`docs/design/noorm-modeling-skill.md` — design doc for the ignatius modeling skill; includes entity-flow mermaid, knowledge-encoded section (ORM-vs-key-inherited axis, AK step, verification loop), Q&A redesign notes.
`docs/design/schema-lint-and-error-ux.md` (205L) — design doc for the schema lint and error UX feature: rule catalog, two-tier severity model (Class A warn/degrade vs Class B omit), findings surfaces, CP phasing.
`docs/design/graph-position-persistence.md` (118L) — design doc for graph node position persistence: structural fingerprint rationale (topology-only inputs table), backend-derives/frontend-persists split, localStorage vs IndexedDB decision, all-or-nothing restore guarantee, orphaned key pruning strategy.
`docs/design/wiki-entity-links.md` (59L) — design doc for wiki-style `[[Entity]]` body links: syntax, two-surface anchor design (`href` + `data-entity`), two-pass render rationale, `body.unknown_link` findings integration, rejected approaches.
`docs/spec/cli-and-outputs.md` — implementation contract for the three CLI output modes and theme system.
`docs/spec/branding.md` — implementation contract for branding in dict and graph outputs.
`docs/spec/dict-navigation.md` — implementation contract for dict side nav.
`docs/spec/dict-polish.md` — implementation contract for dict visual polish details.
`docs/spec/viewer-fab-ux.md` — implementation contract for FAB UX in graph viewer.
`docs/spec/ignatius-project-config.md` — implementation contract for `ignatius.yml` config loading, model discovery, CLI picker behavior, and citty/clack integration.
`docs/spec/derive-classification.md` — implementation contract for the 5-rule classification derivation algorithm (Classifier/Subtype/Associative/Dependent/Independent).
`docs/spec/noorm-modeling-skill.md` — implementation contract for the ignatius modeling skill; Q&A redesigned (no `classification` prompt), ORM-vs-key-inherited convention axis added, AK step ratified.
`docs/spec/bidirectional-predicates.md` — implementation contract for bidirectional predicates: `Predicate` type, `normalizePredicate` behavior, `ModelEdge.predicate` normalization at parse time, Cytoscape edge data keys, mouseover swap protocol, dict predicate-rev span.
`docs/spec/schema-lint-and-error-ux.md` (134L) — implementation contract for schema lint and error UX: `validateModel` API, `ValidationResult` shape, `generateDict` findings signature, `/api/model` payload shape, CLI stderr sort+format rules, `window.__IGNATIUS_MODE__` protocol, findings panel React component contract.
`docs/spec/graph-position-persistence.md` (106L) — implementation contract for graph node position persistence: `layoutFingerprint(model)` API, `layout-store.ts` shape (`createLayoutStore`, `LayoutStoreHandle`, `StorageLike`), `/api/model` payload `layoutKey` field, `window.__LAYOUT_KEY__` static injection, App.tsx save/restore/reset protocol, structural-vs-cosmetic fingerprint invariants.
`docs/spec/wiki-entity-links.md` (79L) — implementation contract for wiki-entity links: `wikiLinkPlugin` and `WikiLinkEnv` in `src/wikilink.ts`, `ModelNode.bodyLinks`, two-pass body rendering in `parse.ts`, `body.unknown_link` rule in `validate.ts`, graph click delegation in `App.tsx`, `.entity-link` / `.entity-link--missing` styling in both surfaces.

### scripts

`scripts/stable-names.ts` — post-build: uses `Bun.Glob` to find `index-*.js` and `index-*.css` in `dist/static/`, then copies them to stable names via `Bun.write(Bun.file(...), Bun.file(...))`. Required step before `bun build --compile`. No `node:fs` imports.
`scripts/convert-yaml-to-md.ts` (257L) — one-time migration script converting old YAML-format model files to the current per-entity markdown frontmatter format.
`scripts/probe.ts` (95L) — ad-hoc diagnostic script.
`scripts/screenshot.ts` (82L) — Playwright screenshot helper.

## Cross-cutting

- `trash/` contains v1 components and engine code (YAML-driven), superseded by current markdown-driven implementation. Not imported anywhere in `src/`.
- `test/` is exploratory tooling organized into `checks/` (CI-run assertions), `visual/` (Playwright, manual only), `fixtures/` (YAML data), `notes/` (markdown). Not a formal suite. `test/checks/test-findings-panel.ts` is a Playwright check in the `checks/` dir — CI will attempt to run it.
- `models/` is a container of four sibling model roots — `key-inherited/`, `orm-hybrid/`, `orm-pure/`, `broken-demo/` — each with its own `ignatius.yml`. `key-inherited/`, `orm-hybrid/`, `orm-pure/` are the same data model expressed with three key-ID techniques; each has per-variant dark/light theme palettes. `broken-demo/` is a deliberately-broken variant used as a live test fixture for dict banners, warning triangles, missing-link affordances, CLI stderr output, and the findings panel. `broken-demo/Order.md` contains an intentional broken wiki-link `[[Cart]]` which does not resolve. Test checks pin `key-inherited` as the clean baseline (0 findings) and `broken-demo` as the broken pin (4 global + 8 entity = 12 total findings). Reference/fixture data, not a domain.
- `src/layout-fingerprint.ts` and `src/layout-store.ts` are the two new persistence-support modules. `layout-fingerprint.ts` is imported by `src/server.ts` (for `/api/model`), `src/generators/graph.ts` (for static `__LAYOUT_KEY__` injection), and `src/App.tsx` is NOT one of its importers — the frontend reads the key from the payload/window global only. `layout-store.ts` is imported only by `src/App.tsx`.
- `src/wikilink.ts` is imported only by `src/parse.ts`.
- `src/open-browser.ts` is dynamically imported by `src/cli.ts` only when `--open` is passed to `serve`.
- `src/types/file-imports.d.ts` — ambient module declarations for `*.html`, `*.css` imports with `{ type: 'file' }` or plain import.
- `src/types/cytoscape-navigator.d.ts` — ambient declarations for `cytoscape-navigator` (no upstream `@types`); augments `cytoscape.Core` with `navigator(options?): NavigatorInstance`.
- `bun-env.d.ts` — ambient Bun type augmentations.
- `bunfig.toml` — Bun config (2L, minimal).
- `src/parse.ts` exports canonical model types (`Model`, `ModelNode`, `ModelEdge`, `SubtypeCluster`, `Cardinality`, `GroupConfig`, `ColumnDef`, `ModelMeta`, `Predicate`) and `ParseResult`, plus helper `normalizePredicate`. `ModelNode` now also carries `bodyLinks?: string[]`. `src/validate.ts` exports `ValidationResult`, `EntityError`, `GlobalError`, `RuleId`, `RuleEntry`, `RULES`. Both are imported by `src/App.tsx`, `src/generators/dict.ts`, `src/server.ts`, and `src/cli.ts` — no local type redeclarations.
- Findings flow: `parse.ts` → `ParseResult.globalErrors` (parse-time) + `validateModel()` → `ValidationResult.globalErrors + .entityErrors` → merged by callers (server, cli, frontend) before rendering.
- Binary name is `ignatius` (`dist/ignatius`); package.json `name` is `ignatius`. The repo *directory* `derek-db-generator/` is the only remaining `derek` reference — a known leftover, not an intentional identifier.
- `assets/noorm-logo.svg` — default branding logo, imported by `src/branding-defaults.ts` as a file reference.
- Deterministic substrate: `.claude/project/deterministic-signals.md`
