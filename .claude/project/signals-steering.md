# Signals steering
#
# User-provided hints for the signals inferrer. When this file exists,
# the inferrer reads it before writing signals.md and treats its
# content as ground truth — steering wins over detection when they
# conflict.

## Framework

Bun + React 19, ESM-only. No Vite, webpack, or Node — Bun handles serve, build, test, compile.

The `bun run build` script is a partial dev bundle producing `dist/` for development. The real production build is `bun run build:cli`, which compiles the standalone single-file binary at `dist/ignatius`.

## Build

| Purpose | Command |
|---------|---------|
| Build compiled binary (primary) | `bun run build:cli` |
| Build React bundle only | `bun run build:bundle` |
| Rename hashed → stable bundle names | `bun run build:stable-names` |
| Dev interactive app (hot reload) | `bun run dev:cli` |
| Dev server alone | `bun run dev` |
| Run all assertion checks | `bun run test` (globs `test/checks/*.ts`) |
| Run a single check | `bun test/checks/test-<name>.ts` |

`test/` is exploratory tooling, NOT a formal suite, and is organized by kind:

- `test/checks/` — raw assertion scripts (PASS/FAIL/throw). `bun run test` and CI run these.
- `test/visual/` — Playwright screenshot scripts for manual visual inspection. Not run by `bun run test`.
- `test/fixtures/` — `.yaml` fixtures loaded by scripts via `../fixtures/`.
- `test/notes/` — `.md` dev notes, not tests.

No `bun test` runner config exists; running `bun test` (the runner) exercises nothing — the scripts are plain assertion programs.

## Domains

- `trash/` is v1 dead code, not a domain — already excluded via `.signalsignore`
- `spec/spec.md` is historical v1 design (superseded by `docs/spec/` and `docs/design/`) — already flagged generated via `.signalsignore`
- `models/` is fixture/reference data, not application state. Treat it as test input, not a domain in its own right.
- `test/` is exploratory tooling (checks/visual/fixtures/notes), not a domain or a formal suite. See the Build section for its layout.
- `tmp/` is throwaway scratch, blanket-ignored in `.gitignore`. Previously-tracked artifacts stay tracked, but new files are ignored. Not a domain.

## Ignore for domains

- `dist/` — build output
- `node_modules/` — vendor
- `tmp/` — throwaway scratch (blanket-ignored)
