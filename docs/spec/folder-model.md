# Folder model: data/ + flows/, registries at root, no underscore

## Goal

Restructure the ignatius model format so each root has exactly five recognized
top-level folders — `data/` (entities), `flows/` (DFDs), and the optional shared
registries `groups/`, `externals/`, `stores/` — with no `_*` prefix convention and
no per-DFD nesting of externals/stores. Hard-cut: the parser reads only the new
layout. Implements #16. See `docs/design/folder-model.md`.

## Non-goals

- Back-compat reading of the old `_*`/nested layout (hard-cut).
- An `ignatius migrate` CLI command (a throwaway `tmp/migrate-folder-model.md`
  prompt covers the user's own models; already written, gitignored, not a checkpoint).
- Renaming `flows/` to `processes/` (name kept).
- A major version bump — ships as a minor (`feat`, no `!`, no `BREAKING CHANGE:`
  footer, so release-please cuts 0.9.0 not 1.0.0).
- `ignatius.yml` schema changes (none required).
- Auto-deriving / detecting an old layout to warn on it (would reintroduce `_*`
  awareness; out of scope).

## Success criteria

- [ ] Entities are discovered by scanning `data/**/*.md` only. Files outside `data/`
  are never parsed as entities. The old `**/*.md` + `_`-segment-skip + `flows/`-skip
  logic is gone (`src/model/parse.ts`).
- [ ] Group definitions are read from `groups/` (not `_groups/`). `groups/` is
  **optional** — a model with no `groups/` directory parses with zero groups and
  does **not** throw. A test asserts a groups-less model parses cleanly.
- [ ] External definitions are read once from the model-root `externals/` folder.
  Store definitions are read once from the model-root `stores/` folder. Per-DFD
  `_externals/` and `_stores/` are no longer read (`src/flows/flow-parse.ts`).
- [ ] The per-DFD external/store **override** capability is removed (a sub-DFD can
  no longer redefine an external its parent declared). Fixtures that exercised the
  old override (`broken-flow` has `Shopper.md` in both `checkout/_externals/` and
  `checkout/Decompose/_externals/`; `flows-leveling` has `User.md` at three levels)
  collapse to one global definition per name. Any test asserting per-DFD-override
  behavior is updated to the new global semantics; the broken fixtures keep their
  intended finding sets (re-verified, not assumed).
- [ ] DFD discovery under `flows/` no longer skips `_`-prefixed folders (it never
  needs to — registries are at the root); it still skips dot-prefixed entries.
  Sub-DFD detection (process `X.md` + sibling `X/`) is unchanged.
- [ ] Validator error messages naming folders reference the new names: `groups/<n>.md`,
  `externals/<n>.md` (global), with no `_` and no per-DFD framing (`src/model/validate.ts`).
- [ ] All 8 in-repo model roots are migrated in place (roots keep their names):
  entities → `data/`, `_groups/` → `groups/`, all externals → root `externals/`,
  all stores → root `stores/`, emptied `_*` dirs removed. `flows-leveling`'s three
  `User.md` externals collapse to a single `externals/User.md`.
- [ ] `ignatius validate <root>` exits 0 with no parse/global errors on
  `key-inherited`, `orm-hybrid`, `orm-pure`, `llm-memory-db-mssql`, and on the
  fixtures that were clean before; `broken-demo` / `broken-flows-model` keep their
  intended (unchanged) finding sets.
- [ ] Count baselines hold after migration (same files, new locations): key-inherited
  24 nodes; broken-demo 4 global + 8 entity findings; broken-demo 9 parsed entities /
  9 entity errors / 1 validator global. Re-verified, not assumed.
- [ ] Every test that builds a temp fixture with `_groups`/`_externals`/`_stores`
  dirs is updated to the new folder names (≈9 tests). No test references a `_*`
  model path. `bun run test` exits 0; `bun run build:cli` succeeds.
- [ ] The `noorm-modeling` skill teaches the new layout everywhere: no
  `_groups`/`_externals`/`_stores`/`flows/_*` path instruction remains in
  `skills/noorm-modeling/**`. The model-bootstrap and entity-write steps write under
  `data/` and `groups/`; DFD authoring references root `externals/` + `stores/`.
- [ ] Public guides `docs/guides/folder-format.md` and `docs/guides/flows.md`
  describe the new layout (tree sketches + prose). The live-contract design/specs
  the skill cites are amended per spec-currency: `markdown-driven-erd` (design),
  `ignatius-project-config` (design), `noorm-modeling-skill` (design+spec),
  `process-flows` (design+spec), `noorm-flow-discovery` (design). CLAUDE.md gets a
  new "Folder model" feature-map row; `docs/glossary.md` reconciled.
- [ ] Touched source files introduce **zero** new `tsc --noEmit` errors vs. baseline.

## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Entity side: parser scans `data/**`, reads optional `groups/`; migrate entities + `_groups` in all 8 roots; update entity-fixture-creating tests | `src/model/parse.ts`, all 8 model roots (entities + `_groups`), test-branding-parse / test-config-yaml / test-parse-examples / test-parse-globals / test-parse-predicate / test-theme-parse / test-cli-stderr / screenshot-entity-modal | atomic-implementer (feature) | ~12 + moves | entity tests + `validate` green; flow tests still green (flows untouched); groups-less model parses |
| 2 | Flow side: parser reads root `externals/`+`stores/`, drops per-DFD scans + `_` skip; validator msgs; migrate every `_externals`/`_stores` dir to model-root registries (collapsing same-name collisions in `broken-flow` + `flows-leveling`); update flow-fixture tests incl. removed-override assertions | `src/flows/flow-parse.ts`, `src/model/validate.ts`, flows trees in models/key-inherited, models/llm-memory-db-mssql, test/fixtures/{flows-model, broken-flows-model, broken-flow, flows-leveling, flows}; tests test-cp5-title-override, test-parse-flows, test-validate-flows, test-flow-cli | atomic-implementer (feature) | ~12 + moves | flow tests + `validate` green on all flow models; full `bun run test` exit 0; counts re-verified; broken fixtures keep finding sets |
| 3 | Skill: rewrite all stale path instructions to the new layout | `skills/noorm-modeling/references/{entity-flow,model-flow,dfd-authoring,flow-templates,interviewing,reverse-engineering,templates,verification}.md`, `SKILL.md` if needed | atomic-implementer (feature) | ~8 | no `_groups`/`_externals`/`_stores`/`flows/_*` grep hit in `skills/`; bootstrap+entity+DFD steps point at new folders |
| 4 | Public docs + canonical specs/designs + CLAUDE.md + glossary | `docs/guides/folder-format.md`, `docs/guides/flows.md`, amend `docs/design/{markdown-driven-erd,ignatius-project-config,noorm-modeling-skill,process-flows,noorm-flow-discovery}.md` + `docs/spec/{noorm-modeling-skill,process-flows}.md`, `CLAUDE.md` feature map, `docs/glossary.md` | atomic-implementer (surgical→feature) | ~10 | no stale `_*`/per-DFD layout in guides; spec-currency clean; new feature-map row present |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Parser/model migration out of sync mid-checkpoint → red suite | high | Each CP migrates the on-disk files AND the parser side AND the tests it affects in one slice. CP1 (entity) and CP2 (flow) are independently green because the flows tree is untouched by CP1 and the entity scan is confined to `data/` by then. |
| `git mv` loses files or leaves empty `_*` dirs | med | Implementer uses `git mv` (not Read+Write); after each migration runs `find <root> -name '_*' -type d` to confirm none remain; `git status` reviewed. |
| Count baseline shifts unnoticed | med | Success criteria pin the exact counts; CP2 re-runs `bun run test` whole-suite. A shifted count is a migration bug, surfaced not silenced. |
| flows-leveling `User.md` bodies differ → wrong collapse | low | Implementer diffs the three `User.md` bodies; if identical, keep one; if not, keep the richest and note it. Fixture's purpose is nesting depth, not externals. |
| Hidden hardcoded `flows/_externals` / `_stores` path in untouched code | low | Investigator grep was exhaustive across `src/`; CP2 re-greps `src/` for the three strings before declaring done. |
| Skill leaves one stale path → silent future authoring bug | med | CP3 gate is a grep for all four strings across `skills/` returning zero hits, not a spot check. |

## Implementation log

- CP1 — entity scan confined to `data/**`; `_groups/` → optional `groups/` (a missing dir no longer throws); migrated all 8 model roots entity-side via `git mv`; updated the fixture-creating tests; new `test/checks/test-folder-model.ts` (`97cf5e3`). Reviewer PASS, 1🔵 (stale `_stores/Sessions.md` strings) deferred into CP2 scope and fixed there.
- CP2 — externals/stores read once from model-root `externals/`/`stores/` (optional); per-DFD `_externals`/`_stores` reads + the override capability removed; validator folder-name strings updated; migrated every `_externals`/`_stores` dir, collapsing the `broken-flow` Shopper override and the `flows-leveling` User (×3) same-name collisions to one global definition each (`be578c6`). Reviewer PASS, 1🟡 fixed in-iteration: CP2 had dumped the full external registry into every `diagram.externals` (so context/leaf diagrams rendered all externals). Surgical fix — `diagram.externals` reverted to referenced-and-defined (rendered set); the full registry rides on `FlowModel.externals`, threaded to the validator's `ambiguous_endpoint` + `unknown_external` checks so `broken-flow`'s bare-`Ambiguous` ambiguity and `ext:Nobody` unknown still fire.
- CP3 — `noorm-modeling` skill rewritten across 8 reference files; `grep` for `_groups`/`_externals`/`_stores`/`flows/_` in `skills/` is zero; verified by building a model per the new instructions and validating it (`2688c0b`). Reviewer PASS, 1🔵 ("in the model root") fixed.
- CP4 — `folder-format` + `flows` guides rewritten to the five-folder model; live design/spec contracts (markdown-driven-erd, ignatius-project-config, process-flows, noorm-modeling-skill, noorm-flow-discovery) amended with change-log entries; incidental path refs fixed; CLAUDE.md feature-map row added (`38eacc0`). Reviewer PASS, 0 findings.
- Verify (on `main` after squash): `bun run test` → 577 PASS, 0 FAIL, exit 0; `build:cli` clean; `ignatius validate` clean on key-inherited (24), orm-pure (24), orm-hybrid (24), llm-memory-db-mssql (38); broken-demo exits 1 as intended. Zero NEW `tsc` errors in touched files (only the systemic Bun-types/`markdown-it` declaration gap). Grep gates: `src/` zero, `skills/` zero, `docs/` only the migration doc + change-log history.

**Squashed to d024c43 — 2026-06-17.** Per-iteration SHAs above are historical (unreachable from any branch). Ships as a minor (0.9.0) per the user's version policy.

## Change log

### 2026-06-17 — CP2 fixture set + per-DFD override removal

**What changed:** Expanded CP2 to cover all flow fixtures discovered on disk —
added `test/fixtures/flows` and `test/fixtures/broken-flow` (flows-only roots the
initial model inventory missed) and the `test-validate-flows` / `test-flow-cli`
tests. Added an explicit success criterion: the per-DFD external/store *override*
capability is removed, and fixtures that relied on it (`broken-flow` Shopper at two
levels; `flows-leveling` User at three) collapse to one global definition, with any
override-asserting test updated to global semantics.

**Why:** Pre-dispatch disk enumeration (`find … -name _externals -o -name _stores`)
found two extra fixtures and revealed that consolidating to a single root registry
deletes the per-DFD override feature — a behavioral change the original CP2 row
treated as a pure file move.
