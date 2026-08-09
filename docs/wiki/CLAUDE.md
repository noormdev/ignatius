---
type: Steering
description: Authoritative steering for the signals/wiki inferrer when operating under docs/wiki/.
---

<steering note: user hints to correct framework detection / domain grouping / build-test commands;
 the inferrer reads this and treats it as authoritative>

## Framework

Bun (runtime, bundler, test runner, binary compiler) + TypeScript strict ESM.
React 19 SPA, Cytoscape.js + cytoscape-elk/fcose/navigator for the graph, ELK for DFD layout.
Server is `Bun.serve()` with HTML imports. No Express, no Vite, no webpack, no NestJS.

## Build

- Build binary: `bun run build:cli` (= `build:bundle` → `build:stable-names` → `bun build --compile`)
- Bundle only: `bun run build:bundle`
- Typecheck: `bun run typecheck` (non-blocking today — many pre-existing errors)
- Test: `bun run test` — a shell loop over `test/checks/*.ts`, exits 1 on first failure.
  NOT `bun test`: there are no `*.test.ts` files and nothing imports `bun:test`;
  bare `bun test` finds 0 files and exits 1. Checks need the binary built first.

## Domains

Keep the twelve established domains; do not re-derive or merge them.

- cli — src/cli/
- server — src/server/
- parser — src/model/parse.ts, wikilink.ts, model-index.ts
- validate — src/model/validate.ts  (separate concern from parser, same directory)
- flows — src/flows/  (parse, leveling, validation, fingerprint, usage index)
- flow-view — src/flow-view/  (ELK layout + SVG rendering; separate from flows)
- frontend — src/app/
- generators — src/generators/
- theme — src/theme/
- skill — skills/noorm-modeling/
- docs — docs/
- scripts — scripts/

## Ignore for domains

- trash/      (dead code kept for reference — never a domain)
- tmp/        (throwaway scratch)
- dist/       (build output)
- node_modules/
- models/     (demo + fixture model roots, i.e. sample data — not source)
- test/fixtures/
- spec/       (top-level spec/spec.md is the ORIGINAL single-YAML design, self-marked historical
              and superseded — provenance only, never a domain; the live specs are docs/spec/)
