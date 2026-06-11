# Spec: src/ root organization

## Goal

Group the 27 loose `src/` root files into domain directories (`cli/`, `server/`, `model/`, `flows/`, `theme/`; frontend strays into `app/`) so the root contains only directories. Pure moves + import-path updates; zero behavior change. Continues on branch `app-tsx-decomposition` (same PR as the App.tsx decomposition, per user decision).

## Non-goals

- Renaming exported symbols.
- Touching `generators/`, `flow-view/`, `types/` contents (import paths INTO them may update).
- Barrel files / `index.ts` re-exports.
- Splitting `styles.css`.
- CI workflow changes beyond what package.json script paths require (expected: none — CI calls scripts by name).

## Success criteria

1. `ls src/` shows only directories: `app/`, `cli/`, `server/`, `model/`, `flows/`, `theme/`, `generators/`, `flow-view/`, `types/`.
2. Placement matches the design's decision table (docs/design/src-root-organization.md).
3. `bun run typecheck 2>&1 | grep "error TS" | grep -cv "^tmp/"` ≤ 433 after every checkpoint; no new error sites.
4. `bun run test` (54 checks) exits 0 after every checkpoint.
5. `bun run build:bundle` + `bun run build:stable-names` + `bun run build:cli` succeed after every checkpoint that touches their inputs; compiled `dist/ignatius validate models/key-inherited` and `export` smoke-pass at the end.
6. Zero references to old root paths remain: `grep -rn "from '\.\./src/\(parse\|validate\|server\|cli\|flow-parse\|...\)'" test/ scripts/` style sweep returns no stale imports (verified per checkpoint by typecheck + the checks suite actually executing).
7. Zero behavior change — final visual sentinels: CP13, CP18, CP3 pass.

## Recommendation

Approach A from the design (domain dirs, checkpointed moves). Gate pattern proven on this branch across 19 iterations.

## Checkpoints

Move with `git mv`. Update importers repo-wide per move: `src/`, `test/checks/`, `test/visual/`, `scripts/`, `package.json`, `src/app/index.html` as applicable. Locate importers by grep/sg, not memory.

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|-----------|---------|
| R1 | `model/` core | parse.ts, validate.ts, model-index.ts, wikilink.ts, layout-fingerprint.ts → `src/model/`; update all importers (app/, server.ts, cli.ts, generators/, flows files, test/checks, scripts/) | atomic-builder | ~30 touched | typecheck gate, `bun run test`, build:bundle |
| R2 | `flows/` core | flow-parse.ts, flow-validate.ts, flow-fingerprint.ts, flow-usage-index.ts, titlelize.ts → `src/flows/`; update importers | atomic-builder | ~20 touched | typecheck gate, `bun run test`, build:bundle |
| R3 | `theme/` | theme-defaults.ts, branding-defaults.ts → `src/theme/`; fix `assets/noorm-logo.svg` relative file-import depth; update importers | atomic-builder | ~10 touched | typecheck gate, `bun run test`, build:bundle |
| R4 | `cli/` + `server/` | cli.ts, discover.ts, resolve-model.ts, serve-port.ts, open-browser.ts, version.ts, update.ts → `src/cli/`; server.ts → `src/server/`; update package.json (`build:cli` compile path, `dev`, `dev:cli`), cross-imports, test imports | atomic-builder | ~15 touched | typecheck gate, `bun run test`, **build:cli** + `dist/ignatius validate` smoke |
| R5 | frontend strays → `app/` | hash-router.ts → `src/app/`; markers.ts, wrap-label.ts, layout-store.ts → `src/app/views/graph/`; main.tsx, index.html, styles.css → `src/app/`; update package.json `build:bundle` entry, server.ts HTML import, importers | atomic-builder | ~15 touched | typecheck gate, `bun run test`, build:bundle + build:cli; visual: CP18, CP13 |
| R6 | final sweep + signals | grep sweep for stale path comments; full gate run incl. export smoke + CP3; dispatch signals refresh for moved paths | atomic-builder (signals via atomic-signals-inferrer) | ~3 | all success criteria re-verified |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Bun HTML-import path in server.ts breaks when index.html moves (compiled binary embeds it) | Medium | R5 gates on build:cli + binary serve/export smoke, not just bundle |
| `branding-defaults.ts` SVG file-import depth wrong after move | Medium | R3 verifies via build:cli (file import resolved at compile) + checks |
| Missed test-script import (109 files import src/ paths) | Medium | checks suite executes every file — a missed import fails loudly; typecheck covers test/ too |
| package.json script paths drift from new entry locations | Low | R4/R5 run the scripts themselves as the gate |
| `bun build --compile` embeds by entrypoint graph — moved entry changes dist layout | Low | stable-names + embedded-bundle read `dist/static/` which is path-stable |

## Change log

<!-- empty on creation -->

## Implementation log

### shipped — 2026-06-11

Built across 6 iterations of /subagent-implementation on branch `app-tsx-decomposition` (same PR as the App.tsx decomposition). Commits (chronological):

- `8b901c0` — R1 model core → src/model/ (52 files)
- `7ab96b1` — R2 flow core → src/flows/ (46 files)
- `5d09574` — R3 theme → src/theme/ (SVG file-import depth proven via build:cli)
- `d4407ff` — R4 CLI → src/cli/, server → src/server/ (79 files; package.json scripts; 49 spawn strings)
- `69fdd2e` — R5 frontend strays → src/app/ (bundle entry + server HTML import; SC-1 achieved)
- `b1ab3e6` — R6 stale path-string sweep + functional `build` script fix
- `649d54b` — signals.md path citations repointed (27 paths)

**Out-of-scope work performed during this build:**
- `package.json` `"build"` script was already stale before R5 (pointed at root index.html while build:bundle was canonical) — fixed in R6.

**Unforeseens — surprises that emerged during implementation:**
- Signals-refresh agent died mid-write (API socket close); a second dispatch completed the remaining 11 stale refs against the partial edit.
- Old shipped specs (`render-perf-indexing`, `schema-lint-and-error-ux`) cite old paths in historical checkpoint tables — left as history per spec-currency rules.

**Deferred items still open:**
- none — sole ledger item (F-1 stale comment) fixed in R6.

**Squashed to b2c3342 — 2026-06-11.** Per-iteration SHAs above are historical (unreachable from any branch).
