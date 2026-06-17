# CLI Tool & Output Modes — Design Document


## Problem

The tool currently requires running `bun --hot src/server.ts` and opening a browser. There's no way to:

- Generate a static, shareable artifact (HTML page) from the model
- View the data dictionary without the graph
- Run the tool on an arbitrary folder without modifying `server.ts`
- Toggle between light and dark themes
- Customize colors without editing source code

Users want to point the tool at any folder of entity markdown files and get output — interactive server, static graph, or data dictionary — without touching source code.


## Goals

- Standalone CLI: `ignatius <models-dir>` serves the interactive app
- `ignatius <models-dir> --dict` generates a self-contained data dictionary HTML file
- `ignatius <models-dir> --graph` generates a self-contained graph HTML file
- Light/dark mode toggle in the interactive app
- All three surfaces respect the theme
- Colors and spacings configurable via `_theme.yaml`
- Live reload — editing markdown updates the graph without browser refresh
- CLI ships as a single compiled binary (no Node/Bun runtime dependency)


## Non-goals

- npm/homebrew distribution (just a local Bun binary for now)
- PDF output
- SQL DDL generation
- Pre-computing the graph layout server-side


## Approach

**Embed the bundled React app at compile time. Inject the model JSON at runtime.**

The existing React app does all the rendering — Cytoscape, ELK, markers, modal, FAB. Nothing about the static graph requires recreating that. Two-stage build:

**Stage 1 — Bundle the React app:**

```
bun build src/index.html --outdir=dist/static
```

This produces standalone HTML/JS/CSS with everything inlined or referenced.

**Stage 2 — Compile the CLI with the bundle embedded:**

```
bun build --compile src/cli.ts -o ignatius
```

The CLI source imports the bundled files with `import bundle from "./dist/static/index.html" with { type: "file" }`. Bun bakes them into the binary at compile time.

**At runtime:**

- `serve` — `Bun.serve()` routes `/` to the embedded bundle, `/api/model` to a fresh `parseModels(dir)` call. Watches the dir for changes and pushes SSE events to the client.
- `graph` — Reads the embedded HTML template, injects the Model as `window.__MODEL__`, writes to disk. User opens the file in any browser; ELK runs client-side and lays out the graph once. Then it's interactive.
- `dict` — Generates pure HTML string templates from the Model + theme. No React, no Cytoscape — just tables and anchor links.

### Why this beats pre-computing positions

The earlier idea was to use a headless browser (webview-bun or Playwright) to render the graph server-side, extract Cytoscape positions, and write a lighter static HTML with pre-computed coordinates. Three problems:

- **webview-bun isn't headless** — it's a GUI library. Pops up a visible window on every render.
- **Playwright works but ships a 190MB+ browser binary** — the CLI either bundles it (huge download) or asks users to install it separately (friction).
- **The pre-computed approach still needs Cytoscape core (~300KB) in the output for pan/zoom interaction.** So the "lighter" output isn't dramatically lighter, and the build pipeline is dramatically more complex.

Letting ELK run client-side on file open costs ~3MB of bundle but eliminates the entire headless-rendering layer. One-time cost when the user opens the file. For a shareable schema artifact, that's fine.

### Why a single compiled binary

`bun build --compile` produces a self-contained executable with the Bun runtime + your code + embedded assets. Users get one file (~50-60MB) — no `bun install`, no Node, no Playwright, no browser binary. Run it on any Mac/Linux/Windows machine.

### User-configurable theme

Colors and spacings should not be hardcoded. A `_theme.yaml` at the models root defines visual properties — the same pattern as `groups/`. The parser reads it and passes it through to the renderer.

```yaml
dark:
  background: "#0e1116"
  surface: "#161b22"
  border: "#30363d"
  text: "#e6edf3"
  textMuted: "#8b949e"
  edgeIdentifying: "#8b949e"
  edgeReferential: "#3d424a"
  pastelMix: 0.3

light:
  background: "#ffffff"
  surface: "#f6f8fa"
  border: "#d0d7de"
  text: "#1f2328"
  textMuted: "#656d76"
  edgeIdentifying: "#656d76"
  edgeReferential: "#b0b8c1"
  pastelMix: 0.15

spacing:
  nodeSep: 60
  markerOffset: 10
  markerScale: [0.5, 2.5]
```

The app reads this config, generates CSS custom properties from it, and all three surfaces consume the same variables. Defaults embedded in the app for when no `_theme.yaml` exists.


## Architecture

```
ignatius (compiled binary)
  │
  ├─ Bun runtime (embedded)
  ├─ CLI logic (src/cli.ts)
  ├─ React app bundle (dist/static/, embedded via with { type: "file" })
  └─ Default theme config (embedded)

Subcommands:
  ├─ serve <dir>        → Bun.serve() + embedded bundle + SSE file watcher
  ├─ dict <dir> -o out  → string-template HTML generator (no React)
  └─ graph <dir> -o out → embedded bundle + injected window.__MODEL__
```

All three call `parseModels(dir)` and consume the same `Model` type.


## Open questions

- CLI name (`ignatius` — settled, honoring the project mentor)
- Should `_theme.yaml` schema also configure node sizes, font sizes, edge thickness? Or keep the schema minimal for v1 and expand later?
