# Project signals

## Framework & runtime

- Runtime: Bun (all scripts, server, test runner, binary compiler)
- Language: TypeScript (strict, ESM modules, `type: "module"` in package.json)
- Frontend: React 19, Cytoscape.js 3.31 + cytoscape-elk 2.2, ELK layout engine
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
| Run a test script | `bun tmp/test-<name>.ts` | tmp/ directory |

`build:cli` sequence: `build:bundle` → `build:stable-names` → `bun build --compile src/cli.ts --outfile dist/ignatius`

Tests are raw assertion scripts in `tmp/`, not a test framework. Run individually via `bun tmp/test-*.ts`. Six scripts cover: CLI binary, parse, dict gen, graph gen, SSE live reload, theme parse.

No linter or formatter configured in package.json.

## Language breakdown

| Language | LOC | Files | % |
|----------|-----|-------|---|
| JavaScript | 140413 | 1 | 89% |
| TypeScript | 5567 | 46 | 3% |
| HTML | 5215 | 7 | 3% |
| Markdown | 3044 | 36 | 1% |
| YAML | 1088 | 3 | 0% |
| CSS | 714 | 3 | 0% |

## DevOps & CI

No CI configuration detected. No deploy pipeline. Binary is built locally via `bun run build:cli` and produces `dist/ignatius`. package.json `name` field remains `derek-db-generator` (project identifier, intentionally unchanged).

---

## Domains

| Domain | Repo paths | One-liner | Detail |
|--------|------------|-----------|--------|
| cli | src/cli.ts | Arg parsing + subcommand dispatch for `serve`, `dict`, `graph` | (below) |
| server | src/server.ts | Bun.serve with /api/model + /events SSE + fs.watch live-reload | (below) |
| parser | src/parse.ts | Markdown frontmatter → Model: nodes, edges, cardinality derivation, theme loading | (below) |
| frontend | src/App.tsx, src/main.tsx, src/index.html, src/styles.css, src/markers.ts | React 19 Cytoscape.js graph viewer with ELK layout, crow's-foot SVG overlay, theme toggle | (below) |
| generators | src/generators/ | Static HTML output: dict (self-contained), graph (embeds React bundle), theme CSS vars | (below) |
| theme | src/theme-defaults.ts, src/generators/theme-css.ts | ThemeConfig type, default palette, dark/light merging, CSS var generation | (below) |
| models | models/ | Sample IDEF1X entity files used as the reference data set | (below) |
| docs | docs/, spec/spec.md | Design docs, CLI spec, IDEF1X grammar spec | (below) |
| scripts | scripts/ | Build helpers: stable-names.ts, convert-yaml-to-md.ts, probe.ts, screenshot.ts | (below) |

## Domain detail

### cli

`src/cli.ts` is the binary entry point (`import.meta.main` guard at line 252). `parseArgs()` tokenizes `process.argv` into `ParsedArgs` with subcommand + positional + flags. `main()` dispatches to `serveCommand()`, `generateDict()`, or `generateGraph()`. `--port` missing-value sets `NaN`; `main()` detects `isNaN` and exits 1. Subcommand-scoped `--help` prints per-subcommand usage. Three subcommands: `serve` (interactive), `dict` (static HTML), `graph` (static HTML). Default port: 3000. Usage strings reference `ignatius` as the binary name. The `graph` subcommand dynamic-imports `loadEmbeddedBundle` at runtime (not at module load), wrapped in try/catch that prints "Run: bun run build:bundle" on failure — so `dict` and `serve` work without a prior bundle build.

### server

`src/server.ts` exports `serveCommand(modelsDir, opts)` returning `{ server, stop }`. Routes: `GET /` → bundled React HTML, `GET /api/model` → `parseModels()` JSON, `GET /events` → SSE stream. SSE timeout disabled via `server.timeout(req, 0)`. `fs.watch` watches the models dir recursively; only `.md` and `.yaml` extensions trigger events. Debounce: 200ms coalesce. SSE event name: `model-changed`. `stop()` closes the watcher, clears debounce timer, clears SSE client set, stops Bun server.

### parser

`src/parse.ts` exports `parseModels(dir): Promise<Model>`. Reads `_theme.yaml` (optional), `_groups/*.md`, then all `**/*.md` (skipping `_`-prefixed path segments). Each entity file has YAML frontmatter + markdown body. `Model` type: `{ groups, nodes, edges, subtypeClusters, theme, _meta? }`. Cardinality is derived (not declared) from FK columns vs PK, nullability, and AK membership — logic in `deriveCardinality()`. Body markdown rendered to HTML via markdown-it at parse time. `_meta.yaml` (optional) supplies model-level display metadata.

### frontend

`src/App.tsx` (640L) is the single React component. Cytoscape.js initialized with `cytoscape-elk` layout. `window.__MODEL__` and `window.__THEME_MODE__` used as injection points for static graph output. `src/markers.ts` draws crow's-foot SVG overlays on a canvas element layered over the Cytoscape container. `src/main.tsx` bootstraps the React root. `src/index.html` is the HTML entry point imported by Bun.serve. `src/styles.css` uses CSS custom properties (`--color-*` vars) set by `applyThemeCssVars()` in App.tsx. Theme toggle persists to `localStorage` under the key `ignatius-theme`. `App.tsx` imports `Model`, `ModelNode`, `ModelEdge`, `SubtypeCluster`, `GroupConfig` from `./parse` — no local type redeclarations.

### generators

`src/generators/dict.ts` (380L) — generates self-contained data dictionary HTML with inline CSS, entity sections, attribute tables, FK links, relationship tables, rendered markdown body, group color coding. No external JS dependencies in output.

`src/generators/graph.ts` — generates self-contained graph HTML by inlining the React bundle (JS + CSS) and injecting `window.__MODEL__` and `window.__THEME_MODE__` as a script tag. Calls `loadBundleFromDir()` (dev) or the caller passes content from `loadEmbeddedBundle()` (compiled binary).

`src/generators/embedded-bundle.ts` — imports `dist/static/index.html`, `dist/static/index.js`, `dist/static/index.css` as file imports (`with { type: 'file' }`). These must be stable (non-hashed) names so `bun build --compile` can embed them. `loadEmbeddedBundle()` calls `Bun.file().exists()` on all three paths before reading; throws a friendly error message including "Run: bun run build:bundle" when any are missing. Used only by the `graph` subcommand via dynamic import in `src/cli.ts`.

`src/generators/theme-css.ts` — `buildThemeCssVars(theme, mode)` generates CSS custom property declarations as a string for embedding in static outputs.

### theme

`src/theme-defaults.ts` exports `defaultTheme: ThemeConfig`, `mergeTheme()`, `semanticColors`, and the `ThemeConfig`/`ThemePalette`/`ThemeSpacing` types. `semanticColors` maps classification names (e.g. `subtype`, `kernel`) to `{ bg, fg }` pairs. `mergeTheme()` deep-merges a partial user theme over the defaults. The `ThemeConfig` type is re-exported from `src/parse.ts`.

### models

`models/` is the reference data set. Four entity groups: `catalog/`, `identity/`, `reference/`, `transactional/`. Group configs in `models/_groups/*.md`. Optional `_theme.yaml` at the models root. No `_meta.yaml` present. 24 entity files total. Used as the default models dir in `dev:cli` script and in `src/server.ts` direct-run fallback.

### docs

`docs/design/cli-and-outputs.md` — design doc for CLI modes and static output approach.
`docs/design/markdown-driven-erd.md` — design doc for markdown-driven entity file format.
`docs/spec/cli-and-outputs.md` — implementation contract for the three CLI output modes and theme system.
`spec/spec.md` (464L) — IDEF1X grammar spec; carries a `⚠ HISTORICAL — superseded` banner at the top (line 3) pointing to `docs/design/markdown-driven-erd.md` and `docs/spec/cli-and-outputs.md`. Kept for historical reference; derivation rules (cardinality, classification, subtypes) still apply but §2 YAML grammar describes the old single-file format, not the current per-entity markdown format.

### scripts

`scripts/stable-names.ts` — post-build: uses `Bun.Glob` to find `index-*.js` and `index-*.css` in `dist/static/`, then copies them to stable names via `Bun.write(Bun.file(...), Bun.file(...))`. Required step before `bun build --compile`. No `node:fs` imports.
`scripts/convert-yaml-to-md.ts` (257L) — one-time migration script converting old YAML-format model files to the current per-entity markdown frontmatter format.
`scripts/probe.ts` (95L) — ad-hoc diagnostic script.
`scripts/screenshot.ts` (82L) — Playwright screenshot helper.

## Cross-cutting

- `trash/` contains v1 components and engine code (YAML-driven), superseded by current markdown-driven implementation. Not imported anywhere in `src/`.
- `tmp/` holds test scripts, sample output HTML files, and screenshots. Tests run via `bun tmp/test-*.ts` — no test framework.
- `src/types/file-imports.d.ts` — ambient module declarations for `*.html`, `*.css` imports with `{ type: 'file' }` or plain import.
- `bun-env.d.ts` — ambient Bun type augmentations (e.g. `Bun.Glob` scan, `Bun.file`).
- `bunfig.toml` — Bun config (2L, minimal).
- `src/parse.ts` exports canonical model types (`Model`, `ModelNode`, `ModelEdge`, `SubtypeCluster`, `Cardinality`, `GroupConfig`, `ColumnDef`). `src/App.tsx` imports these directly — no local type redeclarations.
- Binary name is `ignatius` (`dist/ignatius`); package.json `name` field is `derek-db-generator` (project identifier, unchanged by design).
- Deterministic substrate: `.claude/project/deterministic-signals.md`
