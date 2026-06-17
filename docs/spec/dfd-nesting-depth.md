# DFD arbitrary nesting depth

## Goal

DFD dotted process numbers preserve the full ancestor chain at any nesting depth
(`N.a`, `N.a.b`, `N.a.b.c`, …) instead of dropping ancestor segments beyond ~2
levels (the user-observed `5.4.1` → `4.1` bug). The `noorm-modeling` skill's
`flow` mode authors nested DFDs down arbitrarily many layers. Implements issue #15.

## Non-goals

- No parser changes — `parseFlows` already composes correct full relative numbers.
- No auto-deriving decomposition levels from a flat diagram set.
- No change to the L1 overview's "one process per top-level diagram" shape.
- No `compareDottedProcesses` / DD-sidebar / renderer changes — already depth-agnostic.

## Approach

See `docs/design/dfd-nesting-depth.md`. Root cause: `renumberLeaf` in
`src/flows/flow-derive-levels.ts` renumbers only a leaf's direct processes to
`parentN.<lastSegment>` and does not recurse into `subDfds`. Fix: recurse the
whole leaf subtree and prefix `parentN.` to each process's full relative dotted
number.

## Success criteria

- [ ] `renumberLeaf` (`src/flows/flow-derive-levels.ts`) recurses into `subDfds` and prefixes the L1 parent number to every process's **full** relative dotted number, so under L1 parent `N`: a direct process keeps `N.<n>`, a depth-2 process becomes `N.a.b`, a depth-3 process becomes `N.a.b.c`, with no ancestor segment dropped. The folder-order fallback for a non-numeric local number is preserved.
- [ ] The parser (`flow-parse.ts`) is unchanged.
- [ ] The existing `test/fixtures/flows-leveling/` fixture (auth → Authenticate → Login → VerifyToken/CreateSession, 3 process levels deep) is used by a new check in `test/checks/` that parses it via `parseFlows` and asserts the full-depth dotted numbers: `Authenticate` = `1.1`, `Login` = `1.1.1`, `VerifyToken` = `1.1.1.1`, `CreateSession` = `1.1.1.2` (auth is the sole top-level diagram → L1 process `1`). The test must FAIL against the pre-fix `renumberLeaf` — which currently yields `Login = 1.1` (colliding with `Authenticate`), `VerifyToken = 1.1.1`, `CreateSession = 1.1.2`, all missing the ancestor prefix.
- [ ] No regression: `test/checks/test-leveling.ts`, `test/checks/test-flow-leveling.ts`, and `test/checks/test-parse-flows.ts` still pass (existing 1–2 level dotted numbers unchanged).
- [ ] The `test/fixtures/flows-leveling/` fixture is made servable (minimal `ignatius.yml` + a minimal `Party` entity so its `db:Party` endpoints resolve cleanly), and a `test/visual/` screenshot script serves it and captures the DD process list (and/or the drilled Login sub-DFD) showing the full-depth numbers `1.1`, `1.1.1`, `1.1.1.1`, `1.1.1.2`. Additions live entirely inside the fixture dir; `parseFlows`-based checks (`test-deep-nesting.ts`, `test-flow-leveling.ts`) are unaffected.
- [ ] `skills/noorm-modeling/references/dfd-authoring.md` Step F8 is rewritten so decomposition is explicitly recursive — a child process may itself become a sub-DFD parent, down as many layers as warranted — and the folder-layout sketch shows a second nesting level. Any other skill surface that caps depth (e.g. `flow-templates.md`) is reconciled.
- [ ] `bun run test` passes (all `test/checks/*.ts`, exit 0). `bun run build:cli` succeeds.
- [ ] Touched source files introduce **zero** new `tsc --noEmit` errors vs. the baseline.
- [ ] CLAUDE.md feature map + `docs/guides/flows.md` reflect arbitrary nesting depth (the "Sub-DFDs" section already says "recurses as deep as it needs to" — confirm it's accurate and add the dotted-number depth note if missing).

## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Fix `renumberLeaf` (recurse + full prefix) + failing check on the existing deep fixture | `src/flows/flow-derive-levels.ts`, `test/checks/test-deep-nesting.ts` (new, uses existing `test/fixtures/flows-leveling/`) | atomic-implementer (feature) | 2 | `Authenticate=1.1`, `Login=1.1.1`, `VerifyToken=1.1.1.1`, `CreateSession=1.1.1.2`; no regression |
| 2 | Make `flows-leveling` servable + screenshot rendered deep numbers | `test/fixtures/flows-leveling/ignatius.yml` (new), minimal `Party` entity (new), `test/visual/test-deep-nesting.ts` (new) | atomic-implementer (feature) | 3-4 | served deep fixture shows `1.1.1.1` in DD process list / drilled sub-DFD |
| 3 | Skill: recursive F8 + folder-layout depth; docs reconciliation | `skills/noorm-modeling/references/dfd-authoring.md`, `CLAUDE.md`, `docs/guides/flows.md` | atomic-implementer (surgical) | 2-3 | F8 explicitly recursive; layout shows ≥2 nesting levels; guide/map accurate |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Prefixing the full relative number double-counts if relative numbers are NOT leaf-root-relative | low | Verified: parser threads `parentDottedNumbers` from the leaf root down (`flow-parse.ts:561`), so a single prefix is correct. The deep-fixture test catches double-counting (would show `N.a.a.b`). |
| Modifying a demo model breaks existing leveling assertions | med | Use a NEW dedicated fixture under `test/fixtures/`; do not alter `models/llm-memory-db-mssql` or `models/key-inherited` flow trees that existing tests pin. |
| Balancing validator (`flow.unbalanced_decomposition`) trips on the new deep fixture | med | Author the fixture balanced (thread the same data through each level); run `ignatius validate` on it as part of CP1. |
| Skill F8 rewrite contradicts the renderer's actual behaviour | low | Renderer + parser already recurse; the fix makes numbering correct at depth — the skill change only documents existing (now-correct) capability. |

## Implementation log

- CP1 — `renumberLeaf` rewritten as recursive `renumberDiagram`: prefixes the L1 parent number to each process's FULL relative `dottedNumber` and recurses `subDfds`, so depth is preserved (`1.1`→`1.1.1`→`1.1.1.1`). Reproduced the bug first (pre-fix `Login=1.1` collided with `Authenticate`). New `test/checks/test-deep-nesting.ts` (7 assertions on `flows-leveling`); also corrected `test-parse-flows.ts` which pinned the buggy `Reserve-Stock=1.1` (now `1.1.1`). Stale "no cross-level prefix" comment removed (`cbbb8f5`). Reviewer PASS, 0 findings.
- CP2 — `test/fixtures/flows-leveling/` made servable (`ignatius.yml` + `Party` entity + `groups/auth.md`) + `test/visual/test-deep-nesting.ts` (serves it, asserts DOM contains `1.1.1.1`/`1.1.1.2`, screenshots) (`5c562bd`). Reviewer PASS, 1🔵 (empty-catch comment) fixed in-iteration. Screenshot verified: Party Processes table shows `1.1 Authenticate`, `1.1.1 Login`, `1.1.1.1 Verify Token`, `1.1.1.2 Create Session`.
- CP3 — skill `dfd-authoring.md` F8 made explicitly recursive (no depth cap; full-depth numbering; per-level balancing), folder-layout sketch shows a grandchild sub-DFD; CLAUDE.md feature-map row + `docs/guides/flows.md` full-depth note (`f71a769`). Reviewer PASS, 0 findings (numbering examples + per-level-balancing claim verified against `flow-derive-levels.ts`/`flow-validate.ts`).
- Verify: `build:cli` clean; `bun run test` exit 0 (981 PASS, 0 FAIL); tsc zero new errors in any tracked file (2 new errors are in gitignored `tmp/trash/`); `ignatius validate` clean on key-inherited (24 entities), llm-memory-db-mssql (38 entities), and flows-leveling (2 pre-existing `flow.process_to_process` warnings only).

**Squashed to 367b0ea — 2026-06-16.** Per-iteration SHAs above are historical (unreachable from any branch).

## Change log

### 2026-06-16 — use existing `flows-leveling` fixture

**What changed:** CP1 now uses the existing `test/fixtures/flows-leveling/` fixture (already 3 process levels deep: auth→Authenticate→Login→VerifyToken/CreateSession) instead of creating a new deep fixture. Success criterion pinned to exact expected numbers.

**Why:** Pre-implementation discovery — the deep fixture already exists and reproduces the bug (`Login=1.1` collides with `Authenticate`; `VerifyToken=1.1.1`, `CreateSession=1.1.2` lack the ancestor prefix). Avoids a redundant fixture.
