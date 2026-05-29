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
| Dev CLI (hot reload) | `bun run dev:cli` | package.json → src/cli.ts serve models/ |
| Run all assertion checks | `bun run test` | package.json globs `test/checks/*.ts` |
| Run a single check | `bun test/checks/test-<name>.ts` | test/checks/ |
| Typecheck | `bun run typecheck` | package.json → `bunx tsc --noEmit` |

`build:cli` sequence: `build:bundle` → `build:stable-names` → `bun build --compile src/cli.ts --outfile dist/ignatius`

`bun run test` runs a shell loop over `test/checks/*.ts` in order; exits 1 on first failure. CI (.github/workflows/ci.yml) runs `test/checks/` scripts individually (not via `bun run test`) after building the binary.

`test/` is organized into subdirectories — not a formal test-framework suite:

- `test/checks/` — 20 raw assertion scripts (PASS/FAIL/throw). Run by `bun run test` and CI.
- `test/visual/` — 6 Playwright screenshot scripts for manual visual inspection. NOT run by `bun run test`.
- `test/fixtures/` — 3 YAML fixtures loaded by check scripts.
- `test/notes/` — 2 markdown dev notes.

No linter or formatter configured in package.json.

## Language breakdown

| Language | LOC | Files | % |
|----------|-----|-------|---|
| TypeScript | ~8240 | 65 | 57% |
| Markdown | 4091 | 46 | 29% |
| YAML | 1235 | 7 | 8% |
| CSS | 497 | 2 | 3% |
| JSON | 89 | 4 | 0% |
| HTML | 26 | 2 | 0% |

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
| cli | src/cli.ts | Arg parsing + subcommand dispatch for `serve`, `dict`, `graph` | (below) |
| server | src/server.ts | Bun.serve with /dict + /api/model + /events SSE + fs.watch live-reload | (below) |
| parser | src/parse.ts | Markdown frontmatter → Model: nodes, edges, cardinality derivation, theme loading | (below) |
| frontend | src/App.tsx, src/hash-router.ts, src/main.tsx, src/index.html, src/styles.css, src/markers.ts | React 19 Cytoscape.js graph viewer with ELK layout, hash router, expandable FAB, minimap toggle, crow's-foot SVG overlay, theme toggle | (below) |
| generators | src/generators/ | Static HTML output: dict (self-contained), graph (embeds React bundle), inline-asset inliner, theme CSS vars | (below) |
| theme | src/theme-defaults.ts, src/branding-defaults.ts, src/generators/theme-css.ts | ThemeConfig + Branding types, default palettes, dark/light merging, CSS var generation | (below) |
| docs | docs/, spec/spec.md | Design docs, CLI spec, IDEF1X grammar spec | (below) |
| scripts | scripts/ | Build helpers: stable-names.ts, convert-yaml-to-md.ts, probe.ts, screenshot.ts | (below) |

## Domain detail

### cli

`src/cli.ts` is the binary entry point (`import.meta.main` guard). `parseArgs()` tokenizes `process.argv` into `ParsedArgs` with subcommand + positional + flags. `main()` dispatches to `serveCommand()`, `generateDict()`, or `generateGraph()`. `--port` missing-value sets `NaN`; `main()` detects `isNaN` and exits 1. Subcommand-scoped `--help` prints per-subcommand usage. Three subcommands: `serve` (interactive), `dict` (static HTML), `graph` (static HTML). Default port: 3000. Usage strings reference `ignatius` as the binary name. The `graph` subcommand dynamic-imports `loadEmbeddedBundle` at runtime, wrapped in try/catch that prints "Run: bun run build:bundle" on failure — so `dict` and `serve` work without a prior bundle build.

### server

`src/server.ts` exports `serveCommand(modelsDir, opts)` returning `{ server, stop }`. Routes: `GET /` → bundled React HTML, `GET /dict` → server-rendered dict HTML (accepts `?theme=light|dark`), `GET /api/model` → `parseModels()` JSON, `GET /api/asset` → model-dir asset proxy (path traversal blocked), `GET /events` → SSE stream. SSE timeout disabled via `server.timeout(req, 0)`. `fs.watch` watches the models dir recursively; only `.md` and `.yaml` extensions trigger events. Debounce: 200ms coalesce. SSE event name: `model-changed`. `stop()` closes the watcher, clears debounce timer, clears SSE client set, stops Bun server.

### parser

`src/parse.ts` exports `parseModels(dir): Promise<Model>`. Reads `_theme.yaml` (optional), `_groups/*.md`, then all `**/*.md` (skipping `_`-prefixed path segments). Each entity file has YAML frontmatter + markdown body. `Model` type: `{ groups, nodes, edges, subtypeClusters, theme, _meta? }`. Cardinality is derived (not declared) from FK columns vs PK, nullability, and AK membership — logic in `deriveCardinality()`. Body markdown rendered to HTML via markdown-it at parse time. `_meta.yaml` (optional) supplies model-level display metadata.

### frontend

`src/App.tsx` (921L) is the single React component. Cytoscape.js initialized with `cytoscape-elk` layout and `cytoscape-navigator` plugin for the minimap. `window.__MODEL__` and `window.__THEME_MODE__` used as injection points for static graph output. `src/markers.ts` draws crow's-foot SVG overlays on a canvas element layered over the Cytoscape container. `src/main.tsx` bootstraps the React root. `src/index.html` is the HTML entry point imported by Bun.serve. `src/styles.css` uses CSS custom properties (`--color-*` vars) set by `applyThemeCssVars()` in App.tsx. Theme toggle persists to `localStorage` under key `ignatius-theme`. Minimap open/closed persists to `localStorage` under key `ignatius-minimap`. FAB button (`<button class="fab">`) expands an overlay menu (`fab-menu`) with items: Open Dict (links to `/dict`), Legend, Show/Hide minimap, Copy link. Minimap mounts into `<div id="minimap-panel">` via `cy.navigator({ container: '#minimap-panel' })`; destroyed and DOM-cleared on toggle off. `src/hash-router.ts` is a pure module (no side effects, no imports) — exports `parseHash(hash): HashState` and `serializeHash(state): string`. Hash format: `#entity=<id>&zoom=<n>&pan=<x>,<y>` (all params optional). App.tsx uses hash state to persist and restore viewport (zoom, pan) and selected entity across page loads and link-sharing; writes via `history.replaceState` with 200ms debounce; reads on `hashchange` with feedback-loop guard (`lastWrittenHash`). `App.tsx` imports `Model`, `ModelNode`, `ModelEdge`, `SubtypeCluster`, `GroupConfig` from `./parse` — no local type redeclarations. `src/types/cytoscape-navigator.d.ts` — ambient declarations for `cytoscape-navigator` (no `@types` package); augments `cytoscape.Core` with `navigator()` method.

### generators

`src/generators/dict.ts` (967L) — generates self-contained data dictionary HTML with inline CSS, entity sections, attribute tables, FK links, relationship tables, rendered markdown body, group color coding. No external JS dependencies in output.

`src/generators/graph.ts` — generates self-contained graph HTML by inlining the React bundle (JS + CSS) and injecting `window.__MODEL__` and `window.__THEME_MODE__` as a script tag. Calls `loadBundleFromDir()` (dev) or the caller passes content from `loadEmbeddedBundle()` (compiled binary).

`src/generators/embedded-bundle.ts` — imports `dist/static/index.html`, `dist/static/index.js`, `dist/static/index.css` as file imports (`with { type: 'file' }`). These must be stable (non-hashed) names so `bun build --compile` can embed them. `loadEmbeddedBundle()` calls `Bun.file().exists()` on all three paths before reading; throws a friendly error message including "Run: bun run build:bundle" when any are missing. Used only by the `graph` subcommand via dynamic import in `src/cli.ts`.

`src/generators/inline-asset.ts` — converts local file paths (SVG, PNG, JPG, WebP, GIF) to inline `data:` URIs for embedding in static HTML output. Used by branding-aware generators.

`src/generators/theme-css.ts` — `buildThemeCssVars(theme, mode)` generates CSS custom property declarations as a string for embedding in static outputs.

### theme

`src/theme-defaults.ts` exports `defaultTheme: ThemeConfig`, `mergeTheme()`, `semanticColors`, and the `ThemeConfig`/`ThemePalette`/`ThemeSpacing` types. `semanticColors` maps classification names (e.g. `subtype`, `kernel`) to `{ bg, fg }` pairs. `mergeTheme()` deep-merges a partial user theme over the defaults. The `ThemeConfig` type is re-exported from `src/parse.ts`.

`src/branding-defaults.ts` — exports `Branding`, `LogoPair`, `CopyrightConfig` types and the default branding config. Imports `assets/noorm-logo.svg` as a file reference. `Branding` holds `logo` (dark/light SVG paths), `title`, `subtitle`, `copyright`, and `poweredBy` flag.

### docs

`docs/design/cli-and-outputs.md` — design doc for CLI modes and static output approach.
`docs/design/markdown-driven-erd.md` — design doc for markdown-driven entity file format.
`docs/design/branding.md` — design doc for branding system (logo, title, copyright, poweredBy flag).
`docs/design/dict-navigation.md` — design doc for data dictionary navigation (side nav, anchors).
`docs/design/viewer-fab-ux.md` — design doc for floating action button UX in the graph viewer.
`docs/spec/cli-and-outputs.md` — implementation contract for the three CLI output modes and theme system.
`docs/spec/branding.md` — implementation contract for branding in dict and graph outputs.
`docs/spec/dict-navigation.md` — implementation contract for dict side nav.
`docs/spec/dict-polish.md` — implementation contract for dict visual polish details.
`docs/spec/viewer-fab-ux.md` — implementation contract for FAB UX in graph viewer.
`spec/spec.md` (464L) — IDEF1X grammar spec; carries a `⚠ HISTORICAL — superseded` banner at line 3. Kept for historical reference; derivation rules still apply but §2 YAML grammar describes the old single-file format.

### scripts

`scripts/stable-names.ts` — post-build: uses `Bun.Glob` to find `index-*.js` and `index-*.css` in `dist/static/`, then copies them to stable names via `Bun.write(Bun.file(...), Bun.file(...))`. Required step before `bun build --compile`. No `node:fs` imports.
`scripts/convert-yaml-to-md.ts` (257L) — one-time migration script converting old YAML-format model files to the current per-entity markdown frontmatter format.
`scripts/probe.ts` (95L) — ad-hoc diagnostic script.
`scripts/screenshot.ts` (82L) — Playwright screenshot helper.

## Cross-cutting

- `trash/` contains v1 components and engine code (YAML-driven), superseded by current markdown-driven implementation. Not imported anywhere in `src/`.
- `test/` is exploratory tooling organized into `checks/` (CI-run assertions), `visual/` (Playwright, manual only), `fixtures/` (YAML data), `notes/` (markdown). Not a formal suite.
- `src/types/file-imports.d.ts` — ambient module declarations for `*.html`, `*.css` imports with `{ type: 'file' }` or plain import.
- `src/types/cytoscape-navigator.d.ts` — ambient declarations for `cytoscape-navigator` (no upstream `@types`); augments `cytoscape.Core` with `navigator(options?): NavigatorInstance`.
- `bun-env.d.ts` — ambient Bun type augmentations.
- `bunfig.toml` — Bun config (2L, minimal).
- `src/parse.ts` exports canonical model types (`Model`, `ModelNode`, `ModelEdge`, `SubtypeCluster`, `Cardinality`, `GroupConfig`, `ColumnDef`). `src/App.tsx` imports these directly — no local type redeclarations.
- Binary name is `ignatius` (`dist/ignatius`); package.json `name` is `ignatius`. The repo *directory* `derek-db-generator/` is the only remaining `derek` reference — a known leftover, not an intentional identifier.
- `assets/noorm-logo.svg` — default branding logo, imported by `src/branding-defaults.ts` as a file reference.
- Deterministic substrate: `.claude/project/deterministic-signals.md`
