---
type: Index
description: Ignatius — Bun/TypeScript markdown-driven ERD modeler with a unified graph/dictionary/flow (DFD) viewer, CLI-served or exported to a single static HTML file.
---

<wiki-type>repo</wiki-type>
<scan-sha>97a3d19819b3e7d88daf886689cf78f91ff55bbf</scan-sha>
<wiki-schema>1</wiki-schema>

# Project signals

## Framework & runtime

- Runtime: Bun (all scripts, server, test runner, binary compiler)
- Language: TypeScript (strict, ESM modules, `type: "module"` in package.json)
- Frontend: React 19, Cytoscape.js 3.31 + cytoscape-elk 2.2 + cytoscape-fcose 2.2 + cytoscape-navigator 2.0 — ELK drives layered/hierarchical layout (and the organic fallback above `ORGANIC_FALLBACK_THRESHOLD`), fCoSE drives the organic layout's multi-seed force-directed search
- Markdown parsing: markdown-it 14; YAML parsing: yaml 2.8
- No Express, no Vite, no webpack — Bun.serve + Bun HTML imports only
- Dev tools: Playwright (screenshot/SSE tests), webview-bun

## Build / test / lint

| Purpose | Command | Source |
|---------|---------|--------|
| Build compiled binary | `bun run build:cli` | package.json |
| Build React bundle only | `bun run build:bundle` | package.json |
| Rename hashed → stable names | `bun run build:stable-names` | scripts/stable-names.ts |
| Dev server (hot reload) | `bun run dev` | package.json → src/server/server.ts |
| Dev CLI (hot reload) | `bun run dev:cli` | package.json → src/cli/cli.ts serve models/key-inherited |
| Run all assertion checks | `bun run test` | package.json globs `test/checks/*.ts` |
| Run a single check | `bun test/checks/test-<name>.ts` | test/checks/ |
| Typecheck | `bun run typecheck` | package.json → `bunx tsc --noEmit` |

`build:cli` sequence: `build:bundle` → `build:stable-names` → `bun build --compile src/cli/cli.ts --outfile dist/ignatius`

`bun run test` runs a shell loop over `test/checks/*.ts` in order; exits 1 on first failure. CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) runs the same `test/checks/*.ts` loop after building the binary. [`test/`](../../test) is not a formal test-framework suite — there are no `*.test.ts` files and nothing imports `bun:test`; a bare `bun test` finds 0 files and exits 1.

- [`test/checks/`](../../test/checks) — 87 raw assertion scripts (PASS/FAIL/throw), run by `bun run test` and CI. Which check covers which behavior is documented per-domain in each `docs/wiki/<domain>.md`.
- [`test/visual/`](../../test/visual) — 64 Playwright screenshot scripts for manual visual inspection. NOT run by `bun run test`.
- [`test/fixtures/`](../../test/fixtures) — YAML fixtures and 5 fixture model roots (`flows-leveling/`, `flows-model/`, `broken-flows-model/`, `broken-flow/`, `flows/`), all using the v0.11.0 folder layout (`data/`, `groups/`, `externals/`, `stores/`).
- [`test/notes/`](../../test/notes) — 2 markdown dev notes.
- [`test/assert.ts`](../../test/assert.ts) — shared assertion helper.

No linter or formatter configured in package.json.

## Language breakdown

| Language | LOC | Files | % |
|----------|-----|-------|---|
| TypeScript | 59737 | 267 | 70% |
| Markdown | 20459 | 298 | 24% |
| CSS | 3017 | 2 | 3% |
| YAML | 1340 | 14 | 1% |
| Shell | 116 | 1 | 0% |
| JSON | 104 | 4 | 0% |
| HTML | 27 | 2 | 0% |
| TOML | 12 | 2 | 0% |

## DevOps & CI

- CI provider: GitHub Actions ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)). Triggers on all branch pushes and PRs to master/main.
- CI pipeline: install deps → cache Playwright → build bundle + stable-names → compile binary → run all `test/checks/*.ts` → typecheck (`continue-on-error: true`).
- Release pipeline: [`.github/workflows/release-please.yml`](../../.github/workflows/release-please.yml) (release-please driven; a `build` job gated on `release_created` compiles the 5 platform binaries + checksums and attaches them to the release in the same push-to-main run). [`install.sh`](../../install.sh) (repo root) is the curl-able CLI installer that pulls those binaries from `releases/latest/download`.
- Binary is built locally or in CI via `bun run build:cli`; produces `dist/ignatius`.
- package.json `name` is `ignatius`, version is `0.15.0`. The repo *directory* is still named `derek-db-generator/` — the one remaining derek reference, a known leftover.

---

## Domains

| Domain | Repo paths | One-liner | Detail |
|--------|------------|-----------|--------|
| cli | [`src/cli/`](../../src/cli) | citty-based subcommand dispatch (serve/validate/export/version/update); `dict`/`graph`/`flow` are removal stubs; model-root discovery + interactive picker; port fallback + browser open on serve; self-update + version reporting | [`docs/wiki/cli.md`](cli.md) |
| server | [`src/server/server.ts`](../../src/server/server.ts) | Bun.serve with `/api/model` + `/api/flow` + `/events` SSE + fs.watch live-reload; `/dict` and `/flow` redirect to unified SPA hash routes; `/flow-dict` redirects to `/#view=dict` | [`docs/wiki/server.md`](server.md) |
| parser | [`src/model/parse.ts`](../../src/model/parse.ts), [`src/model/wikilink.ts`](../../src/model/wikilink.ts), [`src/model/model-index.ts`](../../src/model/model-index.ts) | `ignatius.yml` config loading → ParseResult: {model, globalErrors}; nodes, edges, cardinality + classification derivation; wiki-link inline rule + two-pass body rendering; `buildModelIndex` — 13 O(1) lookup maps built once per Model | [`docs/wiki/parser.md`](parser.md) |
| validate | [`src/model/validate.ts`](../../src/model/validate.ts) | Pure model validator: 27 RuleIds across 6 domains (parse/entity/body/edge/cluster/flow), two severity tiers (A=warn, B=omit); coerces invalid pk/columns to safe defaults in cleanedModel | [`docs/wiki/validate.md`](validate.md) |
| flows | [`src/flows/`](../../src/flows) | SSADM data flow diagrams: `parseFlows` (recursive sub-DFDs + canonical Yourdon leveling via `deriveLevels`), `validateFlows` (12 `flow.*` rules), `buildFlowLayoutKeys`, usage indexing; role-split node model | [`docs/wiki/flows.md`](flows.md) |
| flow-view | [`src/flow-view/`](../../src/flow-view) | ELK-driven DFD layout (5-band partitioning, orthogonal edge routing); pure coord helpers for polyline rendering; SVG renderer consumes ELK positions + edgeRoutes + search-token dimming | [`docs/wiki/flow-view.md`](flow-view.md) |
| frontend | [`src/app/`](../../src/app) | React 19 unified SPA (Graph/Dictionary/Flows views); shell (`App.tsx`) owns state + composition; views own cy/SVG lifecycle; components/logic/hooks/dom layered underneath | [`docs/wiki/frontend.md`](frontend.md) |
| generators | [`src/generators/`](../../src/generators) | Unified static HTML export via `generateApp` (single file — graph + dict + flows); sole static generator | [`docs/wiki/generators.md`](generators.md) |
| theme | [`src/theme/`](../../src/theme) | ThemeConfig + Branding types, default palettes, flow-kind colors, dark/light merging | [`docs/wiki/theme.md`](theme.md) |
| skill | [`skills/ignatius-modeling/`](../../skills/ignatius-modeling) | Project-scoped Claude Code skill: Q&A-driven entity/model/DFD authoring, convention-aware, writes files + verifies with `ignatius validate` | [`docs/wiki/skill.md`](skill.md) |
| docs | [`docs/`](..) (excluding [`docs/wiki/`](.)) | Design docs, user guides, research notes, and implementation-contract specs — 72 markdown files across [`docs/design/`](../design), [`docs/guides/`](../guides), [`docs/research/`](../research), [`docs/spec/`](../spec) | [`docs/wiki/docs.md`](docs.md) |
| scripts | [`scripts/`](../../scripts) | Build helpers: stable-names.ts, convert-yaml-to-md.ts; perf/diagnostic tooling: probe.ts, screenshot.ts, gen-synthetic-model.ts, perf-harness.ts | [`docs/wiki/scripts.md`](scripts.md) |

## Cross-cutting

- Domain partitioning basis: pinned by [`docs/wiki/CLAUDE.md`](CLAUDE.md) steering (twelve established domains, not re-derived per refresh). [`src/model/parse.ts`](../../src/model/parse.ts) and [`src/model/validate.ts`](../../src/model/validate.ts) share a directory but are separate domains (parser vs validate); [`src/flows/`](../../src/flows) and [`src/flow-view/`](../../src/flow-view) are separate domains (DFD parse/leveling vs ELK layout/rendering) despite the shared "flow" naming.
- Ignored for domain purposes (never cited as domain content): [`trash/`](../../trash) (v1 YAML-driven engine, superseded, not imported anywhere in [`src/`](../../src)), `tmp/`, `dist/` (build output), `node_modules/`, [`models/`](../../models) (5 sibling demo/fixture model roots — `key-inherited/`, `orm-hybrid/`, `orm-pure/`, `broken-demo/`, `llm-memory-db-mssql/` — reference data, not source), [`test/fixtures/`](../../test/fixtures).
- Findings flow crosses three domains: `parse.ts` → `ParseResult.globalErrors` (parse-time) + `validateModel()` → `ValidationResult.globalErrors + .entityErrors` + optional `validateFlows()` → `FlowValidationResult.flowErrors` → merged by callers (cli, server, frontend) before rendering.
- CLI subcommand status: `serve`/`validate`/`export`/`version`/`update` active; `dict`/`graph`/`flow` are removal stubs pointing at `export`.
- [`docs/wiki/feature-map.md`](feature-map.md) — hand-authored feature-to-doc cross-reference table (design/spec/guide/skill columns per feature); not generated by this signals pipeline, maintained separately.
- Deterministic substrate: [`docs/wiki/scan.md`](scan.md).
