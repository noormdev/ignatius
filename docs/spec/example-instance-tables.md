# Example instance tables — spec

Design: [`docs/design/example-instance-tables.md`](../design/example-instance-tables.md)

## Goal

Authors attach `examples:` to entity frontmatter as an array of row objects. Examples render in the data dictionary (collapsible accordion after the body) and the graph viewer entity-detail modal (bottom-most accordion). The validator warns when example keys don't match the entity's column set, with the warning surfaced only in live mode. The modeling skill always generates 2–3 example rows per new entity.

## Non-goals

- Cross-entity FK consistency validation between examples.
- CSV / JSON import.
- Generated test fixtures, seed data, or runtime mocks.
- Caps on example row count.
- UI-driven example editing.

## Success criteria

- [ ] `Frontmatter` and `ModelNode` types in `src/parse.ts` accept `examples?: Record<string, unknown>[]`.
- [ ] Parser passes `examples` through unchanged from frontmatter to `ModelNode`. When frontmatter omits the field, `ModelNode.examples` is `undefined` (not `[]`, not an empty key). Downstream consumers branch on `examples && examples.length > 0`.
- [ ] `RuleId` union includes `entity.example_unknown_column`.
- [ ] `RuleEntry` gains an optional `liveOnly?: boolean` field; default behavior (omitted or `false`) preserves current surface behavior across all consumers.
- [ ] `formatFindingsForStderr` omits rows whose ruleId has `liveOnly: true` — CI stderr stays quiet on example warnings.
- [ ] The static dict generator (`generateDict(... mode = 'static' ...)`) omits live-only findings from its findings banner; the live server path still surfaces them.
- [ ] `validateModel` emits `entity.example_unknown_column` per offending key when any `examples[i]` row contains a key outside `columns ∪ pk`; no false positives on valid keys.
- [ ] `cleanedModel` retains the offending example rows unchanged (rule is advisory, not destructive).
- [ ] Dict output renders `<details class="dict-examples">` after the body markdown for entities with non-empty `examples`. PK columns appear first; declared `columns` order follows. Missing values render as a muted en-dash.
- [ ] Dict accordion opens by default when row count ≤ 3, closed when larger.
- [ ] Entities with `examples` undefined or empty render no accordion at all.
- [ ] Tapping any node in the graph viewer opens an entity-detail modal containing id, classification badge, group color, body HTML, columns table, and the examples accordion at the bottom.
- [ ] ESC or backdrop click closes the modal; hash-router entity selection persists across modal open/close.
- [ ] Live-mode graph viewer shows `entity.example_unknown_column` warnings in the findings panel; static mode does not.
- [ ] `skills/ignatius-modeling/SKILL.md` (post-relocate path; see commit `3b2df25`) lists step E5b between E5 (columns) and E6 (description), with instructions to always generate 2–3 example rows during the entity flow. Any per-step reference files under `skills/ignatius-modeling/references/` that describe the entity flow are updated to match. The skill's existing E8 verification step (running `ignatius dict`) implicitly catches generated examples that contain unknown keys — no new verification machinery required.
- [ ] `docs/design/ignatius-modeling-skill.md` mermaid reflects E5b in the entity flow.
- [ ] `docs/spec/ignatius-modeling-skill.md` has a `## Change log` entry recording the E5b amendment.
- [ ] All 24 entity files under `models/key-inherited/` have `examples:` blocks with at least 2 rows each. Existing clean-baseline tests still report 0 findings.
- [ ] `models/broken-demo/` amends an **existing** entity (not a new one — keeps the pin count deterministic) to add an `examples:` block containing one row with a key outside `columns ∪ pk`. The broken-pin test (`test/checks/test-validate-entity.ts`) sees exactly +1 entity error in live mode; CLI stderr counts (`test/checks/test-validate-refs.ts` or similar) are unchanged.
- [ ] Playwright visual checks for the dict accordion and the graph modal exist in `test/visual/`. These are manual-only — not wired into `bun run test` or CI.

## Approaches

| # | Approach | Sketch | Cost | Risk |
|---|----------|--------|------|------|
| A | Frontmatter array of objects | `examples: [{id: 1, ...}]` | low | none — decided |
| B | Frontmatter array of arrays + header | `examples: [[id, name], [1, "Acme"]]` | low | positional fragility |
| C | External per-entity CSV file | `_examples/Customer.csv` | medium | two-file sync |

**Recommendation: A.** See design doc for full rationale.

Graph surface:

| # | Surface | Sketch | Cost | Risk |
|---|---------|--------|------|------|
| A | Entity-detail modal on tap | Reuses `modal-backdrop` pattern at `src/App.tsx:290` | medium | first per-node modal in the viewer |
| B | Hover tooltip | New floating panel | high | layering conflicts with predicate-swap |
| C | Dict-only | No graph render | low | loses in-place discovery |

**Recommendation: A.** User-requested click-into-entity modal; reuses existing modal pattern.

Live-only validation:

| # | Mechanism | Sketch | Cost | Risk |
|---|-----------|--------|------|------|
| A | `liveOnly?: boolean` field on `RuleEntry` | filter in `formatFindingsForStderr` + dict generator | low | adds one rule-registry field |
| B | New `'live-warning'` severity tier | EntityError.severity union grows | medium | every consumer that switches on severity needs updating |
| C | Two parallel rule registries | `LIVE_RULES` + `STATIC_RULES` | high | doubles bookkeeping |

**Recommendation: A.**

## Checkpoints

| # | Checkpoint | Files / areas | Agent | Est. files | Verifies |
|---|------------|---------------|-------|------------|----------|
| 1 | Schema + parser pass-through for `examples` | `src/parse.ts`; new fixture under `test/fixtures/`; `test/checks/test-parse-examples.ts` | atomic-builder | ~3 | New parse check passes; existing parse checks unchanged |
| 2 | Validator rule + `liveOnly` filter | `src/validate.ts`; `test/checks/test-validate-examples.ts` | atomic-builder | ~2 | New check passes (asserts firing + non-firing cases + `formatFindingsForStderr` drops live-only); existing validator checks unchanged |
| 3 | Dict accordion render | `src/generators/dict.ts`; possibly `src/styles.css` if dict styles inline; `test/visual/screenshot-dict-examples.ts` | atomic-builder | ~3 | Playwright screenshot shows accordion under body; static-mode findings banner omits live-only warnings |
| 4 | Graph entity-detail modal + examples accordion | `src/App.tsx`; `src/styles.css`; `test/visual/screenshot-entity-modal.ts` | atomic-builder | ~3 | Playwright screenshot shows modal on tap; ESC/backdrop close works; hash selection preserved; live-mode shows warning, static does not |
| 5 | Modeling skill: always-on E5b examples step | `skills/ignatius-modeling/SKILL.md` and any affected files under `skills/ignatius-modeling/references/`; `docs/design/ignatius-modeling-skill.md` (mermaid); `docs/spec/ignatius-modeling-skill.md` (change log) | atomic-builder | 3–5 | Skill file lists E5b between E5 and E6; reference files agree; design mermaid reflects step; spec change log records amendment |
| 6 | Broken-demo fixture + test pin-count update | one existing entity under `models/broken-demo/`; `test/checks/test-validate-entity.ts`; any other pinned-count check that asserts broken-demo finding totals | atomic-surgeon | 2–3 | Broken-pin live-mode test count increases by exactly 1; static stderr count unchanged |
| 7 | Backfill examples across all 24 `key-inherited` entities | `models/key-inherited/{catalog,identity,reference,transactional}/*.md` | atomic-builder | 24 | Clean-baseline test still reports 0 findings; entity files retain existing frontmatter; each `examples:` block has ≥2 rows with values drawn from the entity's domain (not "foo/bar") |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Modal scope creeps into a full entity inspector | medium | Spec caps modal content to header / body HTML / columns table / examples accordion. No editing, no FK navigation, no relationships browser. |
| `liveOnly` mechanic adds coupling between rule registry and generators | low | Single field on `RuleEntry`; two filter sites only (`formatFindingsForStderr`, dict generator static path). Documented in `RuleEntry` jsdoc. |
| Skill change breaks existing entity-creation flow | low | Verification loop at E8 (`ignatius dict`) catches regressions before commit. CP7's `key-inherited` backfill is mechanical (not LLM-driven via the skill), so it doesn't double as a skill-flow rehearsal — manual skill exercise on a throwaway entity is the smoke test. |
| Tap-to-open modal conflicts with existing tap-to-select | low | Tap continues to update hash + selection. Modal opens additively. ESC / backdrop close modal only — selection persists. |
| Examples in YAML balloon entity file size | low | Cosmetic; folding in IDE handles it. No spec response. |
| Static dict export from CLI accidentally shows live-only warnings (or live mode hides them) | medium | CP2 + CP3 tests assert both directions. Static dict export must not include `example_unknown_column` rows in the findings banner; `/api/model` payload must include them. |
| Composite-PK entities render examples table awkwardly | low | Header order: PK first, then declared columns. Cosmetic polish deferred to a dict-polish follow-up. |

## Change log

<!-- Empty on creation. First entry lands on the first post-approval amendment. -->
