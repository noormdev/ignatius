# Project signals

## Framework & runtime

- Runtime: Bun (all scripts, server, test runner, binary compiler)
- Language: TypeScript (strict, ESM modules, `type: "module"` in package.json)
- Frontend: React 19, Cytoscape.js 3.31 + cytoscape-elk 2.2 + cytoscape-navigator 2.0, ELK layout engine
- Markdown parsing: markdown-it 14; YAML parsing: yaml 2.8
- CLI framework: citty 0.2 (`defineCommand` / `runMain`); interactive picker: @clack/prompts 1.5
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

- `test/checks/` — 23 raw assertion scripts (PASS/FAIL/throw). Run by `bun run test` and CI.
- `test/visual/` — 6 Playwright screenshot scripts for manual visual inspection. NOT run by `bun run test`.
- `test/fixtures/` — 3 YAML fixtures loaded by check scripts.
- `test/notes/` — 2 markdown dev notes.

No linter or formatter configured in package.json.

## Language breakdown

| Language | LOC | Files | % |
|----------|-----|-------|---|
| TypeScript | 9609 | 71 | 53% |
| Markdown | 6264 | 109 | 35% |
| YAML | 1238 | 10 | 6% |
| CSS | 609 | 2 | 3% |
| JSON | 92 | 4 | 0% |
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
| cli | src/cli.ts, src/discover.ts, src/resolve-model.ts | citty-based subcommand dispatch; model-root discovery + interactive picker | (below) |
| server | src/server.ts | Bun.serve with /dict + /api/model + /events SSE + fs.watch live-reload | (below) |
| parser | src/parse.ts | `ignatius.yml` config loading → Model: nodes, edges, cardinality + classification derivation | (below) |
| frontend | src/App.tsx, src/hash-router.ts, src/main.tsx, src/index.html, src/styles.css, src/markers.ts | React 19 Cytoscape.js graph viewer with ELK layout, hash router, expandable FAB, minimap toggle, crow's-foot SVG overlay, theme toggle | (below) |
| generators | src/generators/ | Static HTML output: dict (self-contained), graph (embeds React bundle), inline-asset inliner, theme CSS vars | (below) |
| theme | src/theme-defaults.ts, src/branding-defaults.ts, src/generators/theme-css.ts | ThemeConfig + Branding types, default palettes, dark/light merging, CSS var generation | (below) |
| docs | docs/ | Design docs, CLI spec, project-config spec, derive-classification spec | (below) |
| scripts | scripts/ | Build helpers: stable-names.ts, convert-yaml-to-md.ts, probe.ts, screenshot.ts | (below) |

## Domain detail

### cli

`src/cli.ts` is the binary entry point. Three subcommands (`serve`, `dict`, `graph`) built with `citty` `defineCommand`; registered on a root `main` command and dispatched via `runMain(main)`. The hand-rolled `parseArgs`/`ParsedArgs` is gone. Each subcommand accepts an optional positional `[path]` (search base, default: cwd) and a `--model <key>` flag for disambiguation. `--port` is a string flag on `serve`; validated with `isNaN` check, exits 1 on invalid. `graph` dynamic-imports `loadEmbeddedBundle` at runtime (same try/catch guard as before — prints "Run: bun run build:bundle" on failure).

`src/discover.ts` — pure model-root resolver. Exports `resolveModel(base, opts): Promise<ResolveResult>` and `ModelCandidate` / `ResolveResult` types. A model root is any directory containing `ignatius.yml`. Algorithm: (1) base itself has `ignatius.yml` → single; (2) search down (skipping `_*`, `node_modules`, `.git`, `dist`, `tmp`, `trash`, `.worktrees`, `.claude`); (3) if nothing found, walk up toward fs root (or optional `ceiling`); (4) exactly 1 found → single; (5) multiple + `--model` key → filter; (6) multiple + no key → many. No TTY, no clack imports — purely algorithmic. `ResolveResult` discriminated union: `single | many | no-match | none`.

`src/resolve-model.ts` — shared CLI helper. Exports `pickModel(base, modelKey): Promise<string>`. Calls `resolveModel`, handles all four result kinds: single → return dir; none → stderr + exit 1; no-match → stderr + exit 1; many + non-TTY → stderr key list + exit 2; many + TTY → `@clack/prompts` `select` picker (cancel → exit 130). This is the **only** file importing `@clack/prompts`.

### server

`src/server.ts` exports `serveCommand(modelsDir, opts)` returning `{ server, stop }`. Routes: `GET /` → bundled React HTML, `GET /dict` → server-rendered dict HTML (accepts `?theme=light|dark`), `GET /api/model` → `parseModels()` JSON, `GET /api/asset` → model-dir asset proxy (path traversal blocked), `GET /events` → SSE stream. SSE timeout disabled via `server.timeout(req, 0)`. `fs.watch` watches the models dir recursively; only `.md` and `.yaml` extensions trigger events. Debounce: 200ms coalesce. SSE event name: `model-changed`. `stop()` closes the watcher, clears debounce timer, clears SSE client set, stops Bun server.

### parser

`src/parse.ts` exports `parseModels(dir): Promise<Model>`. Config loading changed: reads a single `ignatius.yml` at the model root. Top-level keys `name`, `version`, `description`, `updated` populate `_meta`; a `theme:` block is deep-merged via `mergeTheme()`; a `branding:` block is merged via `mergeBranding()`. The old `_theme.yaml` / `_branding.yaml` / `_meta.yaml` loaders no longer exist. `Model` type: `{ groups, nodes, edges, subtypeClusters, theme, branding, _meta? }` — `branding` is now a first-class field. Entity classification is fully derived (5-rule order): Classifier (reference flag or legacy field) → Subtype (appears in a cluster) → Associative (≥2 identifying parents) → Dependent (≥1 identifying parent) → Independent. `identifying` per edge is also derived (all FK child cols in child PK). `deriveCardinality()` uses derived `identifying` + nullability + AK membership. Body markdown rendered to HTML via markdown-it at parse time.

### frontend

`src/App.tsx` (980L) is the single React component. Cytoscape.js initialized with `cytoscape-elk` layout and `cytoscape-navigator` plugin for the minimap. `window.__MODEL__` and `window.__THEME_MODE__` used as injection points for static graph output. `src/markers.ts` draws crow's-foot SVG overlays on a canvas element layered over the Cytoscape container. `src/main.tsx` bootstraps the React root. `src/index.html` is the HTML entry point imported by Bun.serve. `src/styles.css` uses CSS custom properties (`--color-*` vars) set by `applyThemeCssVars()` in App.tsx. Theme toggle persists to `localStorage` under key `ignatius-theme`. Minimap open/closed persists to `localStorage` under key `ignatius-minimap`. FAB button (`<button class="fab">`) expands an overlay menu (`fab-menu`) with items: Open Dict (links to `/dict`), Legend, Show/Hide minimap, Copy link. Minimap mounts into `<div id="minimap-panel">` via `cy.navigator({ container: '#minimap-panel' })`; destroyed and DOM-cleared on toggle off. `src/hash-router.ts` is a pure module (no side effects, no imports) — exports `parseHash(hash): HashState` and `serializeHash(state): string`. Hash format: `#entity=<id>&zoom=<n>&pan=<x>,<y>` (all params optional). App.tsx uses hash state to persist and restore viewport (zoom, pan) and selected entity across page loads and link-sharing; writes via `history.replaceState` with 200ms debounce; reads on `hashchange` with feedback-loop guard (`lastWrittenHash`). `App.tsx` imports `Model`, `ModelNode`, `ModelEdge`, `SubtypeCluster`, `GroupConfig` from `./parse` — no local type redeclarations. `src/types/cytoscape-navigator.d.ts` — ambient declarations for `cytoscape-navigator` (no `@types` package); augments `cytoscape.Core` with `navigator()` method.

### generators

`src/generators/dict.ts` (1045L) — generates self-contained data dictionary HTML with inline CSS, entity sections, attribute tables, FK links, relationship tables, rendered markdown body, group color coding. No external JS dependencies in output.

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
`docs/design/ignatius-project-config.md` — design doc for `ignatius.yml` as model-root marker + single config file; model discovery algorithm; citty + clack tooling rationale.
`docs/design/ignatius-modeling-skill.md` — design doc for the ignatius modeling skill.
`docs/design/schema-lint-and-error-ux.md` — design doc for schema lint and error UX.
`docs/spec/cli-and-outputs.md` — implementation contract for the three CLI output modes and theme system.
`docs/spec/branding.md` — implementation contract for branding in dict and graph outputs.
`docs/spec/dict-navigation.md` — implementation contract for dict side nav.
`docs/spec/dict-polish.md` — implementation contract for dict visual polish details.
`docs/spec/viewer-fab-ux.md` — implementation contract for FAB UX in graph viewer.
`docs/spec/ignatius-project-config.md` — implementation contract for `ignatius.yml` config loading, model discovery, CLI picker behavior, and citty/clack integration.
`docs/spec/derive-classification.md` — implementation contract for the 5-rule classification derivation algorithm (Classifier/Subtype/Associative/Dependent/Independent).
`docs/spec/ignatius-modeling-skill.md` — implementation contract for the ignatius modeling skill.
`docs/spec/schema-lint-and-error-ux.md` — implementation contract for schema lint and error UX.

### scripts

`scripts/stable-names.ts` — post-build: uses `Bun.Glob` to find `index-*.js` and `index-*.css` in `dist/static/`, then copies them to stable names via `Bun.write(Bun.file(...), Bun.file(...))`. Required step before `bun build --compile`. No `node:fs` imports.
`scripts/convert-yaml-to-md.ts` (257L) — one-time migration script converting old YAML-format model files to the current per-entity markdown frontmatter format.
`scripts/probe.ts` (95L) — ad-hoc diagnostic script.
`scripts/screenshot.ts` (82L) — Playwright screenshot helper.

## Cross-cutting

- `trash/` contains v1 components and engine code (YAML-driven), superseded by current markdown-driven implementation. Not imported anywhere in `src/`.
- `test/` is exploratory tooling organized into `checks/` (CI-run assertions), `visual/` (Playwright, manual only), `fixtures/` (YAML data), `notes/` (markdown). Not a formal suite.
- `models/` is a container of three sibling model roots — `key-inherited/`, `orm-hybrid/`, `orm-pure/` — each with its own `ignatius.yml`. Same data model, three key-ID techniques. Reference/fixture data, not a domain.
- `src/types/file-imports.d.ts` — ambient module declarations for `*.html`, `*.css` imports with `{ type: 'file' }` or plain import.
- `src/types/cytoscape-navigator.d.ts` — ambient declarations for `cytoscape-navigator` (no upstream `@types`); augments `cytoscape.Core` with `navigator(options?): NavigatorInstance`.
- `bun-env.d.ts` — ambient Bun type augmentations.
- `bunfig.toml` — Bun config (2L, minimal).
- `src/parse.ts` exports canonical model types (`Model`, `ModelNode`, `ModelEdge`, `SubtypeCluster`, `Cardinality`, `GroupConfig`, `ColumnDef`, `ModelMeta`). `src/App.tsx` imports these directly — no local type redeclarations.
- Binary name is `ignatius` (`dist/ignatius`); package.json `name` is `ignatius`. The repo *directory* `derek-db-generator/` is the only remaining `derek` reference — a known leftover, not an intentional identifier.
- `assets/noorm-logo.svg` — default branding logo, imported by `src/branding-defaults.ts` as a file reference.
- Deterministic substrate: `.claude/project/deterministic-signals.md`
