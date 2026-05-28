# CLI Tool & Output Modes — Spec


## Goal

A standalone CLI (`derek`) that takes a models directory and produces one of three outputs: interactive server, static data dictionary HTML, or static graph HTML. The CLI is a single compiled Bun binary with the bundled React app embedded — no external dependencies, no server, no browser automation. Visual properties (colors, spacings) are user-configurable via `_theme.yaml`. All surfaces support light and dark themes.


## Non-goals

- Package distribution (npm, homebrew)
- PDF output
- React SSR for static pages
- Pre-computing graph layout (the static graph runs ELK client-side on open)


## Success criteria

- [ ] `derek serve models/` starts the interactive server on the models dir
- [ ] `derek dict models/ -o dict.html` writes a self-contained data dictionary HTML file
- [ ] `derek graph models/ -o graph.html` writes a self-contained graph HTML file (open in any browser, ELK lays it out client-side, pan/zoom/click work)
- [ ] Interactive app has a light/dark mode toggle that persists to localStorage
- [ ] Data dictionary HTML has: entity sections with attributes tables, FK links as anchor jumps, relationships tables, rendered markdown body, group color coding
- [ ] All three surfaces respect `--theme light|dark` flag (static outputs) or toggle (interactive)
- [ ] `derek --help` prints usage
- [ ] `models/_theme.yaml` (optional) overrides default colors and spacings across all surfaces
- [ ] `serve` watches the models directory and pushes changes to the browser via SSE — the graph re-renders without manual refresh
- [ ] CLI ships as a single compiled binary with the bundled React app embedded at compile time (`bun build --compile`)


## Approach

The existing React app (Cytoscape + ELK + markers) already does all the rendering. The CLI doesn't need to recreate any of that. The pattern:

**At CLI build time:**

1. `bun build src/index.html` produces the bundled React app (HTML/JS/CSS) in `dist/static/`
2. `bun build --compile src/cli.ts` produces the `derek` binary, with the static bundle embedded via `import ... with { type: "file" }`

**At CLI runtime:**

- `serve`: spins up Bun.serve(), routes `/` to embedded static bundle, `/api/model` to a fresh `parseModels(dir)` call, watches the dir for changes
- `graph`: reads the embedded HTML template, injects the parsed Model as `window.__MODEL__`, writes one self-contained HTML file
- `dict`: ignores the React bundle; generates pure HTML string templates from the Model + theme

The graph output is the same React app, with the model baked in instead of fetched. ELK runs client-side when the user opens the file. ~3-4MB total (acceptable for a shareable artifact).


## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Theme config: parse `_theme.yaml` in `parseModels`, merge with defaults, pass through Model. Extract hardcoded colors in App.tsx/markers.ts/styles.css into CSS custom properties generated from the config. **MUST author an example `_theme.yaml` with distinctly non-default colors and screenshot against it — default-only rendering does not prove the theme system works.** | src/parse.ts, src/App.tsx, src/markers.ts, src/styles.css, models/_theme.yaml, tmp/test-theme.yaml | atomic-builder | ~5 | (1) Screenshot with default theme matches baseline. (2) Screenshot with custom test theme shows visibly different colors. (3) Grep for hex literals in src/ returns nothing but the theme defaults file. |
| 2 | Light/dark toggle: add toggle button to interactive app, switch `:root` class between `dark`/`light`, persist to localStorage, generate both theme palettes from config. **MUST screenshot in both light and dark modes — both must render the full graph without unstyled elements.** | src/App.tsx, src/styles.css | atomic-builder | 2 | (1) Dark mode screenshot matches checkpoint 1 baseline. (2) Light mode screenshot shows correct palette across nodes, edges, markers, modal, FAB, legend. (3) Toggle works; refresh preserves choice. |
| 3 | CLI entry point with `serve` subcommand: parameterize models dir, route static bundle from embedded files, parse and serve `/api/model` per request | src/cli.ts, src/server.ts (refactored as serveCommand), package.json | atomic-builder | 3 | `bun run src/cli.ts serve models/` starts server; graph renders; `--help` prints usage |
| 4 | Live reload: `fs.watch` on models dir in serve mode, SSE endpoint pushes change events, browser subscribes and refetches `/api/model` on change | src/server.ts, src/App.tsx | atomic-builder | 2 | Edit a `.md` file → graph updates without browser refresh; modal stays open if entity still exists |
| 5 | Data dictionary generator: reads Model, produces self-contained HTML with entity sections, attribute tables, FK anchor links, relationship tables, group headers, rendered markdown, theme CSS — pure string templates, no React | src/generators/dict.ts | atomic-builder | 1-2 | Generated HTML opens in browser; all 24 entities present; FK links navigate via anchors; group colors applied; respects `--theme` flag |
| 6 | Graph generator: build the React app bundle, embed it as a template at compile time, at runtime inject Model as `window.__MODEL__` and write to disk | src/generators/graph.ts, build script for stage 1 (`bun build src/index.html`) | atomic-builder | 1-2 | Generated HTML opens in any browser; ELK lays out client-side; graph renders with markers and modal; file is self-contained (no external requests); ~3-4MB |
| 7 | Wire generators into CLI: `dict` and `graph` subcommands with `-o` and `--theme` flags; produce compiled binary via `bun build --compile` | src/cli.ts, package.json | atomic-surgeon | 1 | `bun build --compile src/cli.ts -o derek` produces a binary; `./derek serve models/`, `./derek dict models/ -o dict.html`, `./derek graph models/ -o graph.html` all work |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Theme config surface area is large (colors in CSS, App.tsx, markers.ts) — easy to miss a hardcoded value | High | Checkpoint 1 audits all color references with grep. Test theme file forces visible diff. |
| `_theme.yaml` schema may grow unwieldy with many properties | Low | Start with two sections (dark/light palettes + spacing). Document the schema. Extend incrementally. |
| `fs.watch` fires multiple events for a single file save (editor-specific) | Medium | Debounce SSE notifications (200ms). One change → one notification. |
| Two-stage build coupling: CLI compile depends on static bundle existing | Medium | npm script `prebuild` or explicit ordering: run `bun build src/index.html` before `bun build --compile src/cli.ts`. Document in README. |
| Compiled binary size (~50-60MB with Bun runtime + bundle) | Low | Acceptable for a developer CLI. Document if it becomes a concern. |
| Light theme color choices need to actually work — not just be defined in the config | Medium | Checkpoint 2 screenshot proof in both modes catches this. |


## Change log

<!-- Populated on first amendment after approval. -->
