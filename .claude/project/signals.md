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

`bun run test` runs a shell loop over `test/checks/*.ts` in order; exits 1 on first failure. CI (.github/workflows/ci.yml) runs `test/checks/` scripts individually (not via `bun run test`) after building the binary.

`test/` is organized into subdirectories — not a formal test-framework suite:

- `test/checks/` — 33 raw assertion scripts (PASS/FAIL/throw). Run by `bun run test` and CI. Includes `test-validate-entity.ts` and `test-validate-refs.ts` which pin `key-inherited` as the clean baseline and `broken-demo` as the broken fixture (4 global + 7 entity = 11 total expected findings). `test-parse-predicate.ts` covers `Predicate` type normalization and `ModelEdge.predicate` shape.
- `test/visual/` — 12 Playwright screenshot scripts for manual visual inspection. NOT run by `bun run test`. Includes `screenshot-predicate-hover.ts` (assertions check verb + arrow presence on hover) and `screenshot-hover-fade.ts` (verifies `.faded` class application + element count via `window.__IGNATIUS_CY__`).
- `test/fixtures/` — 3 YAML fixtures loaded by check scripts.
- `test/notes/` — 2 markdown dev notes.

No linter or formatter configured in package.json.

## Language breakdown

| Language | LOC | Files | % |
|----------|-----|-------|---|
| TypeScript | 13135 | 87 | 55% |
| Markdown | 7989 | 125 | 33% |
| YAML | 1318 | 11 | 5% |
| CSS | 984 | 2 | 4% |
| JSON | 92 | 4 | 0% |
| HTML | 27 | 2 | 0% |

## DevOps & CI

- CI provider: GitHub Actions (`.github/workflows/ci.yml`). Triggers on all branch pushes and PRs to master/main.
- CI pipeline: install deps → cache Playwright → build bundle + stable-names → compile binary → run `test/checks/` scripts individually → typecheck (`continue-on-error: true`).
- Release pipeline: `.github/workflows/release-please.yml` + `.github/workflows/release.yml` (release-please driven).
- Binary is built locally or in CI via `bun run build:cli`; produces `dist/ignatius`.
- package.json `name` is `ignatius`. The repo *directory* is still named `derek-db-generator/` — the one remaining derek reference, a known leftover.

---

## Domains

| Domain | Repo paths | One-liner | Detail |
|--------|------------|-----------|--------|
| cli | src/cli.ts, src/discover.ts, src/resolve-model.ts | citty-based subcommand dispatch; model-root discovery + interactive picker; findings printed to stderr | (below) |
| server | src/server.ts | Bun.serve with /dict + /api/model + /events SSE + fs.watch live-reload; /api/model returns parse+validate payload | (below) |
| parser | src/parse.ts | `ignatius.yml` config loading → ParseResult: {model, globalErrors}; nodes, edges, cardinality + classification derivation | (below) |
| validate | src/validate.ts | Pure model validator: 13 rules across 3 domains (entity/edge/cluster), two severity tiers (A=warn, B=omit); coerces invalid pk/columns to safe defaults in cleanedModel | (below) |
| frontend | src/App.tsx, src/hash-router.ts, src/main.tsx, src/index.html, src/styles.css, src/markers.ts | React 19 Cytoscape.js graph viewer; live/static mode flag; findings panel, global error banner, entity warning badges | (below) |
| generators | src/generators/ | Static HTML output: dict (findings-aware), graph (embeds React bundle + mode flag), inline-asset inliner, theme CSS vars | (below) |
| theme | src/theme-defaults.ts, src/branding-defaults.ts, src/generators/theme-css.ts | ThemeConfig + Branding types, default palettes, dark/light merging, CSS var generation | (below) |
| skill | .claude/skills/ignatius-modeling/ | Project-scoped Claude skill: Q&A-driven entity authoring + model bootstrap, convention-aware, writes files + verifies with `ignatius dict` | (below) |
| docs | docs/ | Design docs, CLI spec, project-config spec, derive-classification spec, schema-lint-and-error-ux spec, modeling-skill spec, bidirectional-predicates spec | (below) |
| scripts | scripts/ | Build helpers: stable-names.ts, convert-yaml-to-md.ts, probe.ts, screenshot.ts | (below) |

## Domain detail

### cli

`src/cli.ts` is the binary entry point. Three subcommands (`serve`, `dict`, `graph`) built with `citty` `defineCommand`; dispatched via `runMain(main)`. Each subcommand accepts an optional positional `[path]` (search base, default: cwd) and a `--model <key>` flag. `--port` is a string flag on `serve`; validated with `isNaN` check, exits 1 on invalid.

`dict` and `graph` subcommands: call `parseModels(dir)` → destructure `{ model, globalErrors: parseGlobalErrors }` → dynamic-import `{ validateModel, formatFindingsForStderr }` from `./validate` → merge `allGlobalErrors = [...parseGlobalErrors, ...validation.globalErrors]` → call `formatFindingsForStderr(allGlobalErrors, validation.entityErrors)` and write each line to `process.stderr` → write output HTML → `process.exit(allGlobalErrors.length > 0 ? 1 : 0)`. Exit code 1 when any global errors are present; 0 otherwise.

`dict` subcommand passes `renderModel = { ...model, nodes: validation.cleanedModel.nodes }` (coerced-safe node shapes, raw edges) to `generateDict` — raw edges are preserved so the dict can render `dict-link-missing` affordances for dangling FKs even when their targets are absent. `graph` subcommand passes the raw `model` to `generateGraph` (graph output does not render missing-target affordances, so cleanedModel is not needed there).

`graph` dynamic-imports `loadEmbeddedBundle` at runtime with try/catch that prints "Run: bun run build:bundle" on failure.

`src/discover.ts` — pure model-root resolver. Exports `resolveModel(base, opts): Promise<ResolveResult>` and `ModelCandidate` / `ResolveResult` types. A model root is any directory containing `ignatius.yml`. Algorithm: (1) base itself has `ignatius.yml` → single; (2) search down (skipping `_*`, `node_modules`, `.git`, `dist`, `tmp`, `trash`, `.worktrees`, `.claude`); (3) if nothing found, walk up toward fs root (or optional `ceiling`); (4) exactly 1 found → single; (5) multiple + `--model` key → filter; (6) multiple + no key → many. No TTY, no clack imports — purely algorithmic. `ResolveResult` discriminated union: `single | many | no-match | none`.

`src/resolve-model.ts` — shared CLI helper. Exports `pickModel(base, modelKey): Promise<string>`. Calls `resolveModel`, handles all four result kinds: single → return dir; none → stderr + exit 1; no-match → stderr + exit 1; many + non-TTY → stderr key list + exit 2; many + TTY → `@clack/prompts` `select` picker (cancel → exit 130). This is the **only** file importing `@clack/prompts`.

### server

`src/server.ts` exports `serveCommand(modelsDir, opts)` returning `{ server, stop }`. Routes: `GET /` → bundled React HTML, `GET /dict` → server-rendered dict HTML (accepts `?theme=light|dark`), `GET /api/model` → JSON payload `{ model, parseGlobalErrors, validation }` where `validation = { entityErrors, globalErrors, cleanedModel }`, `GET /api/asset` → model-dir asset proxy (path traversal blocked), `GET /events` → SSE stream. The `/dict` handler calls `parseModels()` then `validateModel()`, constructs `renderModel = { ...model, nodes: validation.cleanedModel.nodes }` (coerced-safe nodes + raw edges), and passes it with merged findings to `generateDict()`. The `/api/model` handler does the same and returns the full validation payload (raw model + parseGlobalErrors + full ValidationResult including cleanedModel). SSE timeout disabled via `server.timeout(req, 0)`. `fs.watch` watches the models dir recursively; only `.md` and `.yaml` extensions trigger events. Debounce: 200ms coalesce. SSE event name: `model-changed`. `stop()` closes the watcher, clears debounce timer, clears SSE client set, stops Bun server.

### parser

`src/parse.ts` exports `parseModels(dir): Promise<ParseResult>`. `ParseResult = { model: Model; globalErrors: GlobalError[] }` — the return type changed from `Promise<Model>` to `Promise<ParseResult>` to carry parse-time errors (CP-2 rule violations: `parse.invalid_yaml`, `parse.missing_id`, `parse.empty_frontmatter`) up to the caller. `GlobalError` type is imported from `./validate`. Config loading: reads a single `ignatius.yml` at the model root; top-level keys `name`, `version`, `description`, `updated` populate `_meta`; `theme:` block deep-merged via `mergeTheme()`; `branding:` block merged via `mergeBranding()`. The old `_theme.yaml` / `_branding.yaml` / `_meta.yaml` loaders no longer exist. `Model` type: `{ groups, nodes, edges, subtypeClusters, theme, branding, _meta? }`. Entity classification fully derived (5-rule order): Classifier (reference flag or legacy field) → Subtype (appears in a cluster) → Associative (≥2 identifying parents) → Dependent (≥1 identifying parent) → Independent. `identifying` per edge also derived. `deriveCardinality()` uses derived `identifying` + nullability + AK membership. Body markdown rendered to HTML via markdown-it at parse time.

**Predicates:** `src/parse.ts` exports `Predicate = { fwd: string; rev: string }` and `normalizePredicate(raw: string | { fwd?: string; rev?: string } | null | undefined): Predicate`. Normalization: string input → `{ fwd: s, rev: s }`; object input → fills missing keys with `''`; null/undefined → `{ fwd: '', rev: '' }`. `Frontmatter.relationships[].predicate` accepts `string | { fwd?; rev? }`. `ModelEdge.predicate` is always a normalized `Predicate` — callers never receive the raw input form. `models/key-inherited/` uses object form (`{ fwd: '...', rev: '...' }`); `models/orm-hybrid/` and `models/orm-pure/` use string form.

### validate

`src/validate.ts` — pure module with no Node/Bun I/O; imports only types from `./parse`. Browser-safe and unit-testable with plain Model literals.

Exports: `validateModel(model: Model): ValidationResult`, `formatFindingsForStderr(globalErrors, entityErrors): string[]`, `RULES: Record<RuleId, RuleEntry>`, types `RuleId`, `EntityError`, `GlobalError`, `ValidationResult`, `RuleEntry`.

`RuleId` union: 13 rules across 3 domains — parse (`parse.invalid_yaml`, `parse.missing_id`, `parse.empty_frontmatter`), entity (`entity.missing_pk`, `entity.missing_columns`, `entity.invalid_field_type`, `entity.unknown_group`), edge (`edge.unknown_target`, `edge.dangling_fk_column`), cluster (`cluster.missing_basetype`, `cluster.missing_member`, `cluster.no_discriminator`).

`RuleEntry.class` field: `'A'` = render degraded + warning triangle (entity stays in model); `'B'` = omit + global banner (entity/edge/cluster stripped from cleanedModel). `EntityError` severity is always `'warning'`; `GlobalError` severity is always `'error'`.

`ValidationResult = { entityErrors: EntityError[]; globalErrors: GlobalError[]; cleanedModel: Model }`. `cleanedModel` has dangling edges and broken clusters removed, AND has nodes with invalid pk/columns shapes coerced to safe defaults (`pk → []`, `columns → {}`) so downstream render paths never crash on bad data.

`RULES` is a `Record<RuleId, RuleEntry>` — TypeScript compile-errors if any RuleId is missing an entry.

`formatFindingsForStderr` sorts rows: errors before warnings, ruleId alphabetical within severity, location alphabetical within ruleId. Format: `"<sev>  <ruleId>  <location>  <message>"` (sev is `error` or `warn`).

`checkMissingColumns` fires when `columns` is missing OR when the object exists but is empty (`Object.keys(...).length === 0`). `checkClusterNoDiscriminator` fires only on exclusive clusters (`cluster.exclusive === true`); inclusive clusters (`exclusive: false`) are exempt — flagging them was a false positive since multiple subtypes can coexist per basetype row.

CP-1 (entity rules) is implemented; parse.* rules (CP-2) are defined in `RuleId` and `RULES` registry but emitted by `parse.ts`, not `validateModel`. `validateModel` receives an already-parsed `Model` — parse-time errors travel separately as `parseGlobalErrors`.

### frontend

`src/App.tsx` is the single React component. Cytoscape.js initialized with `cytoscape-elk` layout and `cytoscape-navigator` plugin for the minimap. `window.__MODEL__`, `window.__THEME_MODE__`, and `window.__IGNATIUS_MODE__` ('live' | 'static') are injection points read at startup. `src/index.html` sets `window.__IGNATIUS_MODE__ = 'live'` via an inline script in `<body>`. `window.__IGNATIUS_CY__` is set to the Cytoscape instance on init and cleared to `undefined` on teardown — debug/test seam only, not part of the public API.

**Mode dispatch in App.tsx:** `useEffect` reads `window.__IGNATIUS_MODE__`. Static mode (`'static'`): reads `window.__MODEL__`, calls `validateModel()` locally, sets findings from result. Live mode (default): fetches `/api/model`, reads `{ model, parseGlobalErrors, validation }` payload, merges `parseGlobalErrors + validation.globalErrors` as `allGlobal`, updates findings state; also subscribes to SSE `model-changed` events for live reload.

**Findings panel:** `<FindingsPanel>` is a persistent `<aside class="findings-panel">` in the top-right corner. Renders only when `totalFindings > 0`. Collapses to a badge (`<button class="findings-panel-badge">`) on collapse click. Rows link entity-scoped findings to graph navigation (pan + select). `<header class="findings-panel-header">` contains title and `<button class="findings-panel-collapse">`. Row list is `<ul class="findings-panel-list">`.

**Global error banner:** `<div class="graph-global-banner">` rendered when `findings.globalErrors.length > 0` and `bannerDismissed` is false. Close button sets `bannerDismissed = true`. Banner is reset to visible on each fresh `/api/model` response.

**Warning badges:** `src/markers.ts` exports `drawWarningBadges(cy, svg, entityIds: Set<string>)` — draws ⚠ corner badges on Cytoscape nodes with findings. Called after crow's-foot marker drawing. Badge set read from `findingsRef` (a ref, not state dep) to avoid graph rebuild on live updates. `updateMarkers` reads `edge.hasClass('faded')` per edge and passes it to `drawEndMarker`; `drawEndMarker` accepts a `faded: boolean` parameter and sets `opacity="0.3"` on the SVG `<g>` element when true, so faded edges' crow's-foot markers match the Cytoscape element opacity.

**Predicate edge labels + direction-aware arrows:** Cytoscape edge data carries `predicateFwd`, `predicateRev`, `edgeLabel` (active display label), and `predicateMode` ('fwd' | 'rev'). `applyArrow(edge, verb, dir)` computes screen-direction from source/target endpoints and wraps the verb with `→` or `←` so arrows always point toward the intended end even when Cytoscape's autorotate flips text 180°. `refreshArrows()` iterates all edges and re-applies `applyArrow` respecting the current `predicateMode`; it is bound to `layoutstop`, `position`, `drag`, and `free` node events. On `mouseover` node N: edges where `edge.target() === N` flip `predicateMode` to `'rev'` and call `applyArrow` with the rev verb; all elements outside `N.closedNeighborhood()` (plus joiner-incoming ancestors) receive the `.faded` CSS class; N receives `.hover-focus`. On `mouseout`: all edges restore to `'fwd'` mode, `.faded` and `.hover-focus` are removed from all elements, and `redrawMarkers()` is called.

**Cytoscape style selectors for hover:** `buildStyles` appends `.faded { opacity: 0.3 }` and `node.hover-focus { border-width: 3 }` to the stylesheet. These are the only selectors governing fade and focus ring — no inline style manipulation.

`src/markers.ts` also exports `createMarkerOverlay`, `updateMarkers` (crow's-foot SVG overlays). `src/main.tsx` bootstraps the React root. `src/styles.css` uses CSS custom properties (`--color-*` vars). `.findings-panel` is `position: fixed; top: 64px` (clears the theme toggle which sits at `top: 16px` with 36px height + 12px gap). Theme toggle z-index is 50. Theme toggle persists to `localStorage` under key `ignatius-theme`. Minimap open/closed persists to `localStorage` under key `ignatius-minimap`. FAB button (`<button class="fab">`) expands an overlay menu (`fab-menu`) with items: Open Dict, Legend, Show/Hide minimap, Copy link. Minimap mounts into `<div id="minimap-panel">` via `cy.navigator({ container: '#minimap-panel' })`; destroyed and DOM-cleared on toggle off. `src/hash-router.ts` — pure module, exports `parseHash(hash): HashState` and `serializeHash(state): string`. Hash format: `#entity=<id>&zoom=<n>&pan=<x>,<y>`. App.tsx uses hash state for viewport + entity persistence; writes via `history.replaceState` with 200ms debounce; reads on `hashchange` with `lastWrittenHash` guard. `App.tsx` imports model types from `./parse`, validate types/RULES from `./validate` — no local type redeclarations. `src/types/cytoscape-navigator.d.ts` — ambient declarations for `cytoscape-navigator`; augments `cytoscape.Core` with `navigator()` method.

### generators

`src/generators/dict.ts` (1185L) — signature: `generateDict(model, findings, mode, opts)` where `findings = { globalErrors: GlobalError[]; entityErrors: EntityError[] }`. Renders a global error banner (`<div class="dict-global-banner">`) when `globalErrors.length > 0`. Each entity section renders a `<details class="dict-entity-warning">` disclosure when that entity has `entityErrors`. FK links to missing targets render as `<a class="dict-link-missing">` with amber styling. Missing-target entities get placeholder `<section class="dict-missing-section">` stubs. `RULES` imported from `../validate` for human-readable rule titles. No external JS dependencies in output. Relationship rows render `edge.predicate.fwd` as primary label; when `rev !== fwd`, appends `<span class="predicate-rev">` with the reverse predicate.

`src/generators/graph.ts` (124L) — signature: `generateGraph(model, mode, sourceOrDir)`. Injects `window.__IGNATIUS_MODE__ = "static"`, `window.__MODEL__`, and `window.__THEME_MODE__` as a synchronous `<script>` before the React module script. Also strips the live-mode body script (`window.__IGNATIUS_MODE__ = 'live'`) that Bun bundles from `src/index.html` into `dist/static/index.html`, so the static injection's `'static'` value wins. Calls `loadBundleFromDir()` (dev) or accepts `BundleContent` directly (compiled binary).

`src/generators/embedded-bundle.ts` — imports `dist/static/index.html`, `dist/static/index.js`, `dist/static/index.css` as file imports (`with { type: 'file' }`). These must be stable (non-hashed) names so `bun build --compile` can embed them. `loadEmbeddedBundle()` calls `Bun.file().exists()` on all three paths before reading; throws a friendly error message including "Run: bun run build:bundle" when any are missing. Used only by the `graph` subcommand via dynamic import in `src/cli.ts`.

`src/generators/inline-asset.ts` — converts local file paths (SVG, PNG, JPG, WebP, GIF) to inline `data:` URIs for embedding in static HTML output. Used by branding-aware generators.

`src/generators/theme-css.ts` — `buildThemeCssVars(theme, mode)` generates CSS custom property declarations as a string for embedding in static outputs.

### theme

`src/theme-defaults.ts` exports `defaultTheme: ThemeConfig`, `mergeTheme()`, `semanticColors`, and the `ThemeConfig`/`ThemePalette`/`ThemeSpacing` types. `semanticColors` maps classification names (e.g. `subtype`, `kernel`) to `{ bg, fg }` pairs. `mergeTheme()` deep-merges a partial user theme over the defaults. The `ThemeConfig` type is re-exported from `src/parse.ts`.

`src/branding-defaults.ts` — exports `Branding`, `LogoPair`, `CopyrightConfig` types and the default branding config. Imports `assets/noorm-logo.svg` as a file reference. `Branding` holds `logo` (dark/light SVG paths), `title`, `subtitle`, `copyright`, and `poweredBy` flag.

### skill

`.claude/skills/ignatius-modeling/SKILL.md` (~573L) — project-scoped Claude skill. First (and only) entry in `.claude/skills/`. Frontmatter: `name: ignatius-modeling`, triggers on `/ignatius-modeling`, `new entity`, `bootstrap a model`, `new ignatius model`, `add entity`. `canonical_sources` lists `docs/spec/schema-lint-and-error-ux.md`, `docs/spec/derive-classification.md`, `docs/spec/ignatius-project-config.md`, `docs/design/markdown-driven-erd.md`.

Two modes dispatched from a positional arg: `entity` (add one entity file) and `model` (bootstrap a new model skeleton). Missing/unknown arg prompts the user to choose.

**Authoring convention axis** — detected once per session from existing model shape (key-inherited: composite PK with FK cols inside; orm-oriented: single surrogate `id` PK with FK cols outside). Never asks the user for `classification` or per-edge `identifying` — those are derived by the parser automatically.

**Entity flow (CP-1):** E0 locate model root → E1 entity id (PascalCase) → E2 group selection (with sub-flow E2a to create a missing group) → E3 parent edges (key-inherited only: PK ancestry; orm-oriented: FK columns) → E4 AK columns → E5 regular columns → E6 description → E7 write file → E8 verify with `ignatius dict`. AK step always offered, skippable.

**Model bootstrap flow (CP-2):** B0 model dir path → B1 model name/version/description → B2 first group → B3 write `ignatius.yml` + `_groups/<slug>.md` → B4 offer to run entity flow for first entity.

Skill writes real files and runs `ignatius dict <model-dir> 2>&1` to verify output; exits the verify loop only when dict exits 0 or the user aborts.

Coupling: references `docs/spec/ignatius-modeling-skill.md` (implementation contract), `docs/design/ignatius-modeling-skill.md` (entity-flow mermaid, knowledge-encoded section), `docs/spec/derive-classification.md` (classification rules), `docs/spec/ignatius-project-config.md` (model discovery), `docs/spec/schema-lint-and-error-ux.md` (rule catalog). Changes to any of those specs may require updating this skill's Q&A logic or verification steps.

### docs

`docs/design/bidirectional-predicates.md` — design doc for the bidirectional predicate feature: `{ fwd, rev }` shape, normalization rules, graph hover-swap UX, dict rendering.
`docs/design/cli-and-outputs.md` — design doc for CLI modes and static output approach.
`docs/design/markdown-driven-erd.md` — design doc for markdown-driven entity file format.
`docs/design/branding.md` — design doc for branding system (logo, title, copyright, poweredBy flag).
`docs/design/dict-navigation.md` — design doc for data dictionary navigation (side nav, anchors).
`docs/design/viewer-fab-ux.md` — design doc for floating action button UX in the graph viewer.
`docs/design/ignatius-project-config.md` — design doc for `ignatius.yml` as model-root marker + single config file; model discovery algorithm; citty + clack tooling rationale.
`docs/design/ignatius-modeling-skill.md` — design doc for the ignatius modeling skill; includes entity-flow mermaid, knowledge-encoded section (ORM-vs-key-inherited axis, AK step, verification loop), Q&A redesign notes (no `classification` prompt).
`docs/design/schema-lint-and-error-ux.md` (205L) — design doc for the schema lint and error UX feature: rule catalog, two-tier severity model (Class A warn/degrade vs Class B omit), findings surfaces (CLI stderr, dict banners, graph viewer panel), CP phasing.
`docs/spec/cli-and-outputs.md` — implementation contract for the three CLI output modes and theme system.
`docs/spec/branding.md` — implementation contract for branding in dict and graph outputs.
`docs/spec/dict-navigation.md` — implementation contract for dict side nav.
`docs/spec/dict-polish.md` — implementation contract for dict visual polish details.
`docs/spec/viewer-fab-ux.md` — implementation contract for FAB UX in graph viewer.
`docs/spec/ignatius-project-config.md` — implementation contract for `ignatius.yml` config loading, model discovery, CLI picker behavior, and citty/clack integration.
`docs/spec/derive-classification.md` — implementation contract for the 5-rule classification derivation algorithm (Classifier/Subtype/Associative/Dependent/Independent).
`docs/spec/ignatius-modeling-skill.md` — implementation contract for the ignatius modeling skill; Q&A redesigned (no `classification` prompt), ORM-vs-key-inherited convention axis added, AK step ratified, full implementation log.
`docs/spec/bidirectional-predicates.md` — implementation contract for bidirectional predicates: `Predicate` type, `normalizePredicate` behavior, `ModelEdge.predicate` normalization at parse time, Cytoscape edge data keys (`predicateFwd`, `predicateRev`, `edgeLabel`), mouseover swap protocol, dict `predicate-rev` span, `models/key-inherited/` object form vs string form in other roots.
`docs/spec/schema-lint-and-error-ux.md` (103L) — implementation contract for schema lint and error UX: `validateModel` API, `ValidationResult` shape, `generateDict` findings signature, `/api/model` payload shape, CLI stderr sort+format rules, `window.__IGNATIUS_MODE__` protocol, findings panel React component contract.

### scripts

`scripts/stable-names.ts` — post-build: uses `Bun.Glob` to find `index-*.js` and `index-*.css` in `dist/static/`, then copies them to stable names via `Bun.write(Bun.file(...), Bun.file(...))`. Required step before `bun build --compile`. No `node:fs` imports.
`scripts/convert-yaml-to-md.ts` (257L) — one-time migration script converting old YAML-format model files to the current per-entity markdown frontmatter format.
`scripts/probe.ts` (95L) — ad-hoc diagnostic script.
`scripts/screenshot.ts` (82L) — Playwright screenshot helper.

## Cross-cutting

- `trash/` contains v1 components and engine code (YAML-driven), superseded by current markdown-driven implementation. Not imported anywhere in `src/`.
- `test/` is exploratory tooling organized into `checks/` (CI-run assertions), `visual/` (Playwright, manual only), `fixtures/` (YAML data), `notes/` (markdown). Not a formal suite. `test/checks/test-findings-panel.ts` is a Playwright check in the `checks/` dir — CI will attempt to run it.
- `models/` is a container of four sibling model roots — `key-inherited/`, `orm-hybrid/`, `orm-pure/`, `broken-demo/` — each with its own `ignatius.yml`. `key-inherited/`, `orm-hybrid/`, `orm-pure/` are the same data model expressed with three key-ID techniques; each has per-variant dark/light theme palettes. `broken-demo/` is a deliberately-broken 11-entity variant (Customer, Order, OrderItem, Product, Discount, Tag, User, Admin, Guest, bad-yaml, no-entity-id, empty-frontmatter + `_groups/core.md`) whose files each trigger one or more validator rules — used as a live test fixture for dict banners, warning triangles, missing-link affordances, CLI stderr output, and the findings panel. Test checks pin `key-inherited` as the clean baseline (0 findings) and `broken-demo` as the broken pin (4 global + 7 entity = 11 total findings). Reference/fixture data, not a domain.
- `src/types/file-imports.d.ts` — ambient module declarations for `*.html`, `*.css` imports with `{ type: 'file' }` or plain import.
- `src/types/cytoscape-navigator.d.ts` — ambient declarations for `cytoscape-navigator` (no upstream `@types`); augments `cytoscape.Core` with `navigator(options?): NavigatorInstance`.
- `bun-env.d.ts` — ambient Bun type augmentations.
- `bunfig.toml` — Bun config (2L, minimal).
- `src/parse.ts` exports canonical model types (`Model`, `ModelNode`, `ModelEdge`, `SubtypeCluster`, `Cardinality`, `GroupConfig`, `ColumnDef`, `ModelMeta`, `Predicate`) and `ParseResult`, plus helper `normalizePredicate`. `src/validate.ts` exports `ValidationResult`, `EntityError`, `GlobalError`, `RuleId`, `RuleEntry`, `RULES`. Both are imported by `src/App.tsx`, `src/generators/dict.ts`, `src/server.ts`, and `src/cli.ts` — no local type redeclarations.
- Findings flow: `parse.ts` → `ParseResult.globalErrors` (parse-time) + `validateModel()` → `ValidationResult.globalErrors + .entityErrors` → merged by callers (server, cli, frontend) before rendering.
- Binary name is `ignatius` (`dist/ignatius`); package.json `name` is `ignatius`. The repo *directory* `derek-db-generator/` is the only remaining `derek` reference — a known leftover, not an intentional identifier.
- `assets/noorm-logo.svg` — default branding logo, imported by `src/branding-defaults.ts` as a file reference.
- Deterministic substrate: `.claude/project/deterministic-signals.md`
