---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

<atomic-signals>

## Project signals (auto-loaded)


@.claude/project/signals.md

</atomic-signals>


Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.


## Visual changes


When visual changes are made (UI, layout, graph rendering, theming), take Playwright screenshots via the existing harness at `scripts/screenshot.ts` and `test/visual/`. Never claim a visual change works without seeing it. Don't build a new capture path — extend the existing harness instead.


## Feature ↔ documentation ↔ skill map


**Rule: a feature is not done until every surface that covers it is consistent.** When you add or change functionality, update its row below — the design doc (the *why*), the spec (the *contract*), the user guide (the *how*), and the skill section that authors or verifies it. If a change has no row, add one; if it touches a surface not yet listed, add the surface. Drift between these is a reliability bug — the skill teaches one thing, the spec contracts another, the guide documents a third.

Paths are relative to `docs/design/`, `docs/spec/`, `docs/guides/`, and `skills/noorm-modeling/`. This map is the human-facing complement to `.claude/project/signals.md` (which maps domains → source code).

| Feature | Design | Spec | Guide | Skill |
|---------|--------|------|-------|-------|
| Folder model (`data/` entities + `flows/` DFDs; `groups/` `externals/` `stores/` at root; no `_*`; #16) | folder-model | folder-model | folder-format, flows | entity-flow + model-flow + dfd-authoring |
| Markdown entity / folder format | markdown-driven-erd | — | folder-format | entity-flow E1/E2/E7/E10, templates |
| Classification + cardinality derivation | markdown-driven-erd | derive-classification | derivation | conventions (derivation tables) |
| Two-path convention (key-inherited vs orm) | noorm-modeling-skill | noorm-modeling-skill | derivation, modeling-skill | SKILL core rules, entity-flow E3 + E5 nudge, model-flow M3 |
| Subtype clusters | markdown-driven-erd | derive-classification, schema-lint-and-error-ux | derivation | entity-flow E5a, templates (subtype example) |
| Bidirectional predicates | bidirectional-predicates | bidirectional-predicates | predicates | entity-flow E5 |
| Schema lint + error UX (findings) | schema-lint-and-error-ux | schema-lint-and-error-ux | validation | verification (rule table + loop) |
| Alternate keys (AK): cardinality derivation, dict/graph key-cell marker, `ak_unknown_column` validation | derive-classification (cardinality) | derive-classification, schema-lint-and-error-ux | derivation | entity-flow E4 |
| CLI subcommands (`serve` SPA + `export` unified static + `validate`) — `dict`/`graph`/`flow` removed | cli-and-outputs, unified-app | cli-and-outputs, unified-app | commands, building-from-source, getting-started | verification (runs `ignatius validate`) |
| CLI version + self-update (`version`/`--version`, `update`) | — | — | commands, getting-started | — |
| Project config + model discovery (`ignatius.yml`) | ignatius-project-config | ignatius-project-config | getting-started, folder-format | entity-flow E0, model-flow M1–M8, templates |
| Themes | cli-and-outputs | cli-and-outputs | themes-and-branding | model-flow M4 |
| Branding | branding | branding | themes-and-branding | model-flow M5 |
| Dict navigation + polish | dict-navigation | dict-navigation, dict-polish | — | — |
| DD browse lens: spotlight grid (entity + flow-node cards, hover/pin spotlight; solid FK predicate lines + dashed cross-domain data-flow lines; hover-reveal labels; off-screen chips; facing-edge anchoring; focus/isolate mode for scale) | dd-spotlight-grid | dd-spotlight-grid | — | — |
| Graph viewer FAB UX | viewer-fab-ux | viewer-fab-ux | — | — |
| Keyboard navigation shortcuts (g/d/f view switch, l DG layout, b DD lens; pure resolver + global hook; editable/modifier guards) | keyboard-nav-shortcuts | keyboard-nav-shortcuts | commands | — |
| Graph node position persistence (drag-to-save, reset) | graph-position-persistence | graph-position-persistence | — | — |
| Business-narrative body + existence/cascade rules | markdown-driven-erd | noorm-modeling-skill | modeling-skill | entity-flow E9, templates (body sections) |
| Entity body wiki-links `[[Entity]]` | wiki-entity-links | wiki-entity-links, schema-lint-and-error-ux | folder-format | entity-flow E9 (body authoring) |
| The modeling skill itself | noorm-modeling-skill | noorm-modeling-skill | modeling-skill | SKILL + all references |
| Skill `flow` + `discover` modes (DFD authoring; Socratic business→model discovery, five gates, generates entities + flows; reverse-engineering from existing DB/code/schema in the IDEF1X spirit) | noorm-flow-discovery | noorm-flow-discovery | modeling-skill, flows | SKILL (4-mode router), dfd-authoring, flow-templates, discover-flow, reverse-engineering |
| Example / sample instance tables | example-instance-tables | example-instance-tables | folder-format (example rows) | entity-flow E7b (`examples:` frontmatter) + templates |
| SSADM process flows (DFD): parse, 11 `flow.*` rules, in-app Flows view (unified SPA), recursive data-level balancing, client-side drill-down, separate-key persistence, per-node ⓘ dialog + `[[wiki-link]]` routing; `db:` store opens rich entity dialog; process dictionary fused into Dictionary view ◆ | process-flows | process-flows (+ research `ssadm-dfd-rules`) | flows | — |
| Unified SPA collapse (Graph / Dictionary / Flows in one app; `export` replaces `dict`/`graph`/`flow`; fused searchable Dictionary; `db:` store → rich entity dialog; shared chrome + theme on DFDs) | unified-app | unified-app | commands, building-from-source | — |
| DFD polish round 2: no text-select on nodes (CP14); store/external coloring by `kind` (theme-aware, `theme.flowKinds` override) (CP15); per-process in/out data example tables (CP16) | — | dfd-polish-round2, process-flows (examples) | themes-and-branding (kind colors) | — |
| DFD edge-hover data reveal (styled fixed-position tooltip lists full data items passed across an edge, source → target header; legible at any zoom; replaces native `<title>`; gated `db:` column lists no longer need a click) | dfd-edge-hover-data | dfd-edge-hover-data | flows | — |
| Arbitrary DFD nesting depth (dotted process numbers preserve the full ancestor chain at any depth — renumberLeaf recurses + prefixes the full relative number; skill F8 authors decompositions recursively, no depth cap) | dfd-nesting-depth | dfd-nesting-depth | flows | dfd-authoring (F8) |
| HTML title from model name (#1; `document.title` = `model._meta.name` else `Ignatius`; SPA runtime effect in `App.tsx` for live + static; `generateApp` rewrites `<title>` with HTML-escaped name on export) | viewer-ux-polish | viewer-ux-polish | — | — |
| Entity-modal history + URL sync (#6/#8; `entity=<id>` in the hash is the single source of truth for "which modal is open"; `useHashRoute` owns the history lifecycle — `openEntity` pushState/dedup, `closeEntity` replaceState-drop, `onEntityChange` popstate reconcile; shell `App.tsx` is the single writer — graph tap / dict click / FK hop / flow `db:` store / findings-panel row all route through it; GraphView no longer writes `entity=`, only viewport zoom/pan with flush-time entity re-merge; Back steps the modal stack, close clears the URL) | viewer-ux-polish | viewer-ux-polish | — | — |
| Zoom 100% = native 1:1 (#3; `100%` = 1 diagram unit → 1 CSS px, model-size-independent; initial view + Home still fit-to-screen but the readout shows the true percent; pure `src/flow-view/zoom-scale.ts` helper maps `internalScale × fitScale`; DFD viewBox stays = world box so drag/minimap/pan untouched; graph readout = `cy.zoom()*100`) | viewer-ux-polish | viewer-ux-polish | — | — |
| Pinch + keyboard zoom → canvas (#4; trackpad pinch = `ctrl`/`meta`+wheel and `Cmd`/`Ctrl` +/-/0 zoom the active canvas, never the browser page, on DG + DFD; native non-passive `wheel` listener on each canvas `preventDefault`s page-zoom while the canvas's own handler still zooms — React `onWheel` is passive so its preventDefault is a no-op; resolver `shortcuts.ts` adds `zoomIn`/`zoomOut`/`zoomReset` actions resolved before the bare-key guards, gated on ctrl/meta only, bypassing the editable guard; `useKeyboardShortcuts` routes to the active view handle, dict no-op) | viewer-ux-polish | viewer-ux-polish, keyboard-nav-shortcuts | commands | — |
| DFD process node sizes to text (#5; pure `processNodeSize(label)` in `src/flow-view/flow-layout.ts` word-wraps the label and returns `{lines,width,height}` with a `120×68` min floor — short names look unchanged, long names grow; same helper feeds ELK `nodeSize` AND the `FlowDiagramSvg` renderer via a shared `sizingLabel(node)` so the rect drawn equals the box ELK laid out — removed the old 130/120 + 64/68 mismatch; `ProcessNode` renders all wrapped lines, badge stays top-left; `test-cp4c-single-row-bands` C16 rephrased to a vertical-overlap strip check since process heights are now label-derived) | viewer-ux-polish | viewer-ux-polish | — | — |
| DD spotlight separate lines (#2; a spotlit DD browse-lens `both`/multi-edge bundle fans into SEPARATE `<path>` elements — one per edge/direction with offset connection points — never one path with arrowheads at both ends; "always separate" at rest; pure `src/app/logic/spotlight-lines.ts` `separateSpotlightLines(base, directions)` offsets perpendicular to the line axis — HORIZONTAL anchor spreads y, VERTICAL spreads x, symmetric `(i−(K−1)/2)·14px` about the base midpoint; K=1 → unchanged base line so the common single-FK look is bit-identical; `SpotlightOverlay` keeps `computeAnchor` DOM measurement then calls the helper and draws one path per spec, single arrowhead each; same separation on the dashed flow lines; `buildSpotlightConnections`/`buildFlowSpotlightConnections` bundling contract + pill second-pass + scrollport-skip + off-screen chips untouched) | viewer-ux-polish | viewer-ux-polish | — | — |
| DD spotlight inherited 1:1 key-inheritance connections (#9, CP7; SUPERSEDED by `key-inheritance-lineage` CP-A — kept for history; bounded to subtype clusters, single-level; pure `src/app/logic/spotlight-inherited.ts` `buildInheritedConnections(index, entityId)` → `InheritedConnection[]` (`{otherId, direction, via}`, `INHERITED_IDENTITY='identity'`); member → basetype + sibling identity links + basetype's direct rels (via=basetype); basetype → members + each member's direct rels (via=member); transitive rels de-dup against the active's own direct edges, identity links exempt; general identifying-1:1 dependent tables were a noted non-goal here — now generalized below; `SpotlightOverlay` draws a THIRD line category DOTTED in `--spotlight-line-inherited` green via the CP6 `separateSpotlightLines` path with "via &lt;basetype&gt;"/"shared key" pills + off-screen `spotlight-chip--inherited` chips; `DictionaryView` folds inherited ids into `spotlitIds`+`focusSet`; `buildSpotlightConnections` unchanged) | viewer-ux-polish | viewer-ux-polish | — | — |
| Key-inheritance lineage (GENERALIZES #9/CP7 above; CP-A + CP-B done; transitive **identity-group** model — `src/app/logic/spotlight-inherited.ts` `buildInheritedConnections` keeps its export name + `InheritedConnection {otherId,direction,via}` shape + `INHERITED_IDENTITY='identity'` so `DictionaryView`/`SpotlightOverlay` are unchanged; two 1:1 key-inheritance edge kinds: (a) subtype-cluster membership, (b) **dependent identifying-1:1** — edge `identifying` + cardinality 1:1 + `Object.keys(edge.on)`==child's full PK (`pkByNode`), the 1:1-child guard excludes subtype edges which derive `child='0..1'`; identity group = BFS transitive closure over both kinds in both directions, cycle-safe visited Set; inferred = each OTHER group member as identity link + each member's out-of-group direct rels (via=nearest-hop member id), de-duped against the active's OWN direct edges; bundle one per otherId, sort by otherId, group size ≤ 1 → []; proven on `models/key-inherited` ITIN→Identity→Party multi-hop. **CP-B (DG dotted lines):** on graph entity select, `GraphView` `drawInheritedEdges` adds EPHEMERAL dotted cytoscape edges (class `inherited`, id `_inherited_<sel>__<other>`) from the selected node to each inherited `otherId` present in cy; styled in `styles.ts` (`edge.inherited`: dotted, arrowless, thin) using the new `SPOTLIGHT_LINE_INHERITED[mode]` constant exported from `theme-css-vars.ts` (single source of truth shared with the DD CSS var so DG==DD); endpoints folded into the hover lineage-fade `keep` set so they stay lit; `clearInheritedEdges` (`cy.remove('edge.inherited')`) on deselect/reselect/reset/applyLayoutMode-before-ELK/no-entity-restore/teardown; never enters model/`layoutFingerprint`/`layout-store`/static-export/ELK — added after layout, removed before re-layout; no-leak unit check (`test-inherited-edges-no-leak.ts`) + Playwright DG check (`test-graph-inherited-edges.ts`: Identity 6, ITIN 10 transitive, deselect 0) + visual screenshot (`test/visual/test-graph-inherited-lines.ts`)) | key-inheritance-lineage | key-inheritance-lineage | — | — |
| Glossary of app terms (DG/DD/DFD/DE/DS/EE; DS⊃DE) | — | — | `../glossary.md` | — |

◆ **Process flows — implemented and first-class, now an in-app view.** The `ignatius flow` CLI subcommand has been removed; flows are the **Flows** view inside the unified SPA (`serve`) and are included in the single `export -o model.html` file. The process dictionary is fused into the unified **Dictionary** view (no separate `/flow-dict` route). The **flow viewer is a custom SVG renderer** (`src/flow-view/`, separate from the ERD's Cytoscape): Gane-Sarson notation (open-ended `D#` stores, numbered process hubs, green externals), banded DFD layout (hub-and-spoke to stores/externals, no process-to-process, shared store bridging). Every node carries a ⓘ badge — a **`db:` store** opens the rich `SelectedEntityModal` (attributes, relationships, examples) shared with graph nodes; a process / external / non-`db` store opens the plain markdown doc dialog. Flow bodies parse `[[wiki-links]]` that route in-dialog across both flow nodes and ERD entities. `models/key-inherited` carries demo DFDs (`order-to-cash` with a sub-DFD + `refund`). Skill coverage: the `noorm-modeling` skill's `flow` mode authors flow markdown (see the skill-modes row above). Guide coverage: `docs/guides/flows.md` (folder format, process frontmatter, endpoints, sub-DFDs, viewing) plus the flow rule catalog in `docs/guides/validation.md`. See `docs/spec/process-flows.md` Non-goals + the design's Open questions for the deferred set (queue-payload validation, usage index).

**Example instance tables — implemented and reconciled.** Structured `examples:` frontmatter → `ModelNode.examples` (`src/parse.ts`) → dict/graph accordions + the `entity.example_unknown_column` validator rule (live-server-only — `ignatius validate` never prints it, so the skill self-checks example keys at authoring time). The skill authors `examples:` frontmatter (entity-flow E7b, templates); older entities may still carry a prose `## Sample rows` body section, which the skill reads when seeding flow examples but no longer emits.
