# CLI Tool & Output Modes — Spec


## Goal

A standalone CLI (`ignatius`) that takes a models directory and produces one of three outputs: interactive server, static data dictionary HTML, or static graph HTML. The CLI is a single compiled Bun binary with the bundled React app embedded — no external dependencies, no server, no browser automation. Visual properties (colors, spacings) are user-configurable via `_theme.yaml`. All surfaces support light and dark themes.


## Non-goals

- Package distribution (npm, homebrew)
- PDF output
- React SSR for static pages
- Pre-computing graph layout (the static graph runs ELK client-side on open)


## Success criteria

- [ ] `ignatius serve models/` starts the interactive server on the models dir
- [ ] `ignatius dict models/ -o dict.html` writes a self-contained data dictionary HTML file
- [ ] `ignatius graph models/ -o graph.html` writes a self-contained graph HTML file (open in any browser, ELK lays it out client-side, pan/zoom/click work)
- [x] `ignatius validate models/` validates the model and reports findings to stderr without writing any output; exits 1 on global errors, 0 otherwise
- [ ] Interactive app has a light/dark mode toggle that persists to localStorage
- [ ] Data dictionary HTML has: entity sections with attributes tables, FK links as anchor jumps, relationships tables, rendered markdown body, group color coding
- [ ] All three surfaces respect `--theme light|dark` flag (static outputs) or toggle (interactive)
- [ ] `ignatius --help` prints usage
- [ ] `models/_theme.yaml` (optional) overrides default colors and spacings across all surfaces
- [ ] `serve` watches the models directory and pushes changes to the browser via SSE — the graph re-renders without manual refresh
- [ ] CLI ships as a single compiled binary with the bundled React app embedded at compile time (`bun build --compile`)


## Approach

The existing React app (Cytoscape + ELK + markers) already does all the rendering. The CLI doesn't need to recreate any of that. The pattern:

**At CLI build time:**

1. `bun build src/index.html` produces the bundled React app (HTML/JS/CSS) in `dist/static/`
2. `bun build --compile src/cli.ts` produces the `ignatius` binary, with the static bundle embedded via `import ... with { type: "file" }`

**At CLI runtime:**

- `serve`: spins up Bun.serve(), routes `/` to embedded static bundle, `/api/model` to a fresh `parseModels(dir)` call, watches the dir for changes
- `graph`: reads the embedded HTML template, injects the parsed Model as `window.__MODEL__`, writes one self-contained HTML file
- `dict`: ignores the React bundle; generates pure HTML string templates from the Model + theme
- `validate`: parses + validates only; prints findings to stderr and a one-line summary to stdout, writes no file (no `-o`, no generator import) — the fast quality gate

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
| 7 | Wire generators into CLI: `dict` and `graph` subcommands with `-o` and `--theme` flags; produce compiled binary via `bun build --compile` | src/cli.ts, package.json | atomic-surgeon | 1 | `bun build --compile src/cli.ts -o ignatius` produces a binary; `./ignatius serve models/`, `./ignatius dict models/ -o dict.html`, `./ignatius graph models/ -o graph.html` all work |


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

### 2026-05-31 — Add `validate` subcommand

**What changed:** New `validate` subcommand: parses + validates a model and prints findings to stderr (same `<sev>  <ruleId>  <location>  <message>` format as `dict`/`graph`) plus a one-line stdout summary, writing no HTML. No `-o` flag. Exit code matches the other commands (1 on global errors, 0 otherwise). Added to the success criteria and approach.

**Why:** A validate-only path is a fast quality gate for authoring loops (no bundle, no file written) — adopted by the noorm-modeling skill's verification loop in place of generating a throwaway dict HTML purely to lint.

### 2026-05-28 — Rename CLI from `derek` to `ignatius`

**What changed:** Bulk rename across CLI binary, usage text, localStorage key, package.json scripts, settings.local.json permissions, scripts, tests, and doc sections.

**Why:** Honors the project mentor's middle name.

**Superseded:** The shipped binary path is now `dist/ignatius` (was `dist/derek`). No backwards compatibility — pre-rename builds had not been distributed.

**Not touched:** The repo directory name (`derek-db-generator`) and the `package.json` `name` field stay as the project identifier. The CP-3 line in the Implementation log retains the historical name to keep the commit-message audit trail accurate.

### 2026-05-29 — Finish the rename: `package.json` name → `ignatius`

**What changed:** `package.json` `name` field `derek-db-generator` → `ignatius`. `src/index.html` `<title>` `Derek DB Generator` → `Ignatius`.

**Why:** The tool's name is Ignatius. The 2026-05-28 carve-out left the package name and the user-facing browser title as `derek`, which read as a stale leftover, not an intentional identifier — including in a user-facing `<title>`.

**Superseded:** The 2026-05-28 "Not touched" decision is reversed for the `package.json` `name` field — it is now `ignatius`. The repo directory name (`derek-db-generator/`) is still not renamed (renaming a checked-out working directory is disruptive and out of scope here). The CP-3 audit-trail line below is unchanged.


## Implementation log

### v0.1 — 2026-05-28

Built across 8 iterations of `/subagent-implementation` (7 spec checkpoints + 1 polish pass). All reviewer verdicts PASS on first attempt — no CHANGES_REQUESTED roundtrips. Commits (chronological):

- `7a83fc9` — CP-1: theme config + `_theme.yaml` + CSS custom property extraction
- `3b377bf` — CP-2: light/dark mode toggle with localStorage persistence
- `a17698d` — CP-3: CLI entry (originally `derek`, later renamed — see Change log) + `serve` subcommand + native arg parser
- `2524115` — CP-4: live reload via SSE + `fs.watch` + 200ms debounce
- `d45979f` — CP-5: data dictionary HTML generator (`src/generators/dict.ts`)
- `95177ba` — CP-6: static graph HTML generator with embedded model
- `9ca278d` — CP-7: wire CLI subcommands + compile binary via `bun build --compile`
- `974d797` — Polish: closed all 19 reviewer follow-ups in one pass

**Out-of-scope work performed during this build:**

- `import.meta.path === Bun.main` guard in `src/server.ts` was always-true in compiled binaries (all `$bunfs/` modules share the same path). Replaced with `import.meta.main` during CP-7 — a real bug surfaced by `bun build --compile`, not foreseen in the spec.
- Stable-name post-build script (`scripts/stable-names.ts`) added during CP-7 to rename content-hashed bundle outputs to `index.js`/`index.css` so the compile-time `import x with { type: "file" }` paths are deterministic.
- `_meta.yaml` parsing added during the polish pass to back F-14 (the dict generator was reading `_meta` off `Model` via a cast). The spec didn't mention `_meta`; it's a small forward-compatible extension.

**Unforeseens — surprises that emerged during implementation:**

- Minified bundle injection in CP-6 needed two protections the spec didn't flag: callback-form `String.replace` to avoid `$&`/`$'`/`` $` `` substitution from bundle content, and `</script>` → `<\/script>` escaping to prevent HTML tag-close detection breaking the document. Handled inline.
- `webview-bun` (devDep from a prior session) was NOT used — pressure-test established it isn't headless; the static graph just embeds the React app and lets ELK run client-side at open time. Saved a ~190MB browser dependency.

**Deferred items still open:**

None. All 19 follow-ups from CP-1 through CP-7 reviewers were closed in the polish pass. Two new low-severity 🔵 nits from the polish reviewer (vacuous eslint-disable in `file-imports.d.ts`, narrowing cast in dict semantic colors) were judged acceptable; left in place.

**Merged into master as `4a562eb` — 2026-05-28.**
