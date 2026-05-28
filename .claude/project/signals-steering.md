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
| Run a single test script | `bun tmp/test-<name>.ts` |

Tests are raw assertion scripts in `tmp/`, not a test framework. Six scripts cover: CLI binary, parse, dict gen, graph gen, SSE live reload, theme parse. No `bun test` runner config exists; running `bun test` will not exercise them.

## Domains

- `trash/` is v1 dead code, not a domain — already excluded via `.signalsignore`
- `spec/spec.md` is historical v1 design (superseded by `docs/spec/` and `docs/design/`) — already flagged generated via `.signalsignore`
- `models/` is fixture/reference data, not application state. Treat it as test input, not a domain in its own right.
- `tmp/` is the test directory by convention (not throwaway scratch). The `test-*.ts` files there are intentional and load-bearing.

## Naming

- The repo directory name (`derek-db-generator`) and the `package.json` `name` field intentionally retain "derek" as the historical project identifier
- The compiled binary is named `ignatius` (`dist/ignatius`)
- Any "derek" reference the inferrer encounters in a path or filename is the historical identifier, not a stale artifact to flag

## Ignore for domains

- `dist/` — build output
- `node_modules/` — vendor
- `tmp/build-check*/` — bundle output from ad-hoc test runs
