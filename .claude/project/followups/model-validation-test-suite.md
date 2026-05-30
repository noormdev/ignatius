---
id: model-validation-test-suite
title: Solid test suite covering parser/model failure modes
created: "2026-05-30"
origin: |
    recovered from session cd4c9886 transcript via /atomic-improve 2026-05-30; originally requested mid-build, never filed
severity: question
review_by: "2026-07-29"
status: open
---

User request (verbatim, recovered from cd4c9886 transcript):

"We need to write a solid test suite to make sure that we're covering all of our bases. I think what we could do for now is focus on failure modes and what happens when you have an incomplete schema, or schemas that are not properly configured."

Scope:
- Failure-mode coverage for parse.ts: incomplete frontmatter, missing PKs, dangling FK refs, malformed cardinality inputs, bad/missing _theme.yaml, misconfigured subtype clusters.
- Pairs with [[schema-validation-linter-error-ux]] — the validator's rules are what these tests assert against.
- Project is still in exploratory testing phase (see memory feedback_testing_phase); align with test/checks/ assertion-script style, not a new framework.

---

## Strategist enrichment (2026-05-30, opus, read-only)

### Headline: parse.ts does almost NO validation

Exactly **three throw sites**: frontmatter regex miss (`parse.ts:84`), group `sort_key` non-number (`:155`), branding title/subtitle >50 chars (`branding-defaults.ts:61`). Everything else is **silent degradation** (undefined fields, dangling edges, dropped relationships). So this suite is two things: (1) pin *current* behavior on bad input so the future validator's changes show as diffs; (2) document where the validator must intervene.

### Failure taxonomy (cite parse.ts unless noted)

- **A. Frontmatter structural** — no fence → throw (`:84`); malformed YAML inside fence → raw `yaml` lib throw, unwrapped (`:86`). *(throws — testable today)*
- **B. Missing/typeless fields (silent)** — `entity`/`classification`/`pk`/`columns` accessed blind (`:184-190`); missing → `undefined` stored (pk NOT defaulted to `[]`). Duplicate `entity` → silent overwrite in nodeMap (`:220`).
- **C. FK / referential (silent)** — missing `on` → `Object.keys(undefined)` **delayed crash** in `deriveCardinality` (`:103`). Dangling `target` → edge emitted with fabricated default cardinality `{parent:'1',child:'many'}`, target matches no node (`:222-226`; fallback keyed on `source` not `target`).
- **D. Cardinality-derivation edge cases (`:98-123`)** — `classification==='Subtype'` exact string match (typo/case silently skips subtype branch, `:106`); missing pk + identifying → `arraysEqual` crash (`:109`); dangling FK *column* optional-chained → silently non-nullable (`:116`); AK exact-match flips child `1`↔`many` (`:117`) — pure deterministic logic, ideal coverage.
- **E. Subtype cluster (`:203-215`)** — `members` scalar → `Object.keys` misbehaves; `exclusive` missing → `undefined`; no check members reference real entities.
- **F. Theme/branding/group/meta** — `_theme`/`_branding`/`_meta` `parseYaml` unwrapped + no shape guard; branding length is the ONLY real validation (already covered by `test-branding-parse.ts:65-97` — extend, don't duplicate); `_meta` assigned `as ModelMeta` with zero validation (`:233-237`).

### Fixture reality check — existing fixtures are STALE/unusable

- `test/fixtures/sample_model.yaml` is the **old single-file YAML grammar** (pre-pivot monolith). `parseModels` reads a **directory of per-entity `.md`**, not a YAML file. Matches nothing in the current parser; referenced only by the migration script. **Dead for tests.**
- `test/fixtures/test-theme.yaml` / `test-branding.yaml` are current-format but **orphaned** — the check scripts write their YAML inline via `Bun.write`, never load the fixtures.
- Parse-touching checks run against the **real `models/` dir**, mutating it in place — fine for happy-path, **wrong for failure-mode** (can't drop a broken entity into `models/` without breaking other checks + the dev server).
- **What's actually needed:** deliberately-broken minimal model dirs **constructed under `tmp/` at runtime** (`mkdir -p` + `Bun.write`, call `parseModels(thatDir)`, assert, clean up) — matches the `test-inline-asset.ts:5-6` / `test-asset-route.ts:10` idiom AND the `tmp/` memory note. Do NOT add static broken fixtures under `test/fixtures/`.

### Test idiom to match (gotcha)

Use the **`process.exit(1)` assert helper** (`test-cli-parse.ts:9-15`) — the only idiom that actually fails CI (`bun run test` relies on non-zero exit). **AVOID `console.assert`** (`test-theme-parse.ts:13`) as the primary signal — it prints to stderr but **does NOT change exit code**, so a failing assertion passes CI (latent gap in existing files). Expected-throw cases: try/catch + `threw` boolean + message-substring (`test-branding-parse.ts:69-79`), paired with the `assert` helper. No framework, no `bun:test`, no new deps.

### Coverage ranking (exploration phase — don't gold-plate)

**Tier 1 (testable today, highest value):** dangling FK target → broken edge (`:222-226`); missing `on` → delayed crash (`:103`); missing pk + identifying → `arraysEqual` crash (`:109`); no/malformed frontmatter throw (`:84,:86`).
**Tier 2 (medium):** missing entity/classification/columns silent (`:184-190`); duplicate entity overwrite (`:220`); `deriveCardinality` pure matrix (identifying × PK-match × AK-match × nullable × Subtype). **Tier 3 (defer):** subtype members malformed; `_theme`/`_meta` non-object; dangling FK column.
First cut = Tier 1 + the `deriveCardinality` matrix.

### Dependency on the validator + sequencing (high confidence)

**Today:** characterization tests pinning *current* (often broken) behavior — throw sites, crash sites ("currently throws X"), silent-degradation sites ("currently returns `pk===undefined`, no throw"). **Blocked on validator:** any "bad input is *rejected with a clear message*" test. **Recommendation:** write Tier-1 characterization tests now, explicitly headered `// CHARACTERIZATION: current degraded behavior; validator (schema-validation-linter) will change this`. They become the regression net that makes the validator's improvements visible. Do NOT write aspirational "should reject" tests now (red day-one, rot or invert the suite's meaning).

### Open questions

1. **Characterization vs aspirational** — pins current (often broken) behavior, not desired. Determines green/red day one. Recommend characterization with explicit headers.
2. **Export `deriveCardinality`?** Module-private (`:98`). The pure matrix is highest-ROI but testing through `parseModels` needs a model dir per case. Exporting enables direct unit calls (tension with "test public API only").
3. **Fixture location** — confirm `tmp/` runtime construction.
4. **CI enrollment** — CI runs a **hand-picked subset** of 6 scripts, not the `*.ts` glob. New checks won't run in CI unless explicitly added (and consider fixing the `console.assert`-doesn't-fail-CI gap while there, or separate follow-up).
5. **Scope: `parse.ts` only**, or include downstream consumers (dict.ts/App.tsx) choking on degraded Model? Recommend parse.ts-only first cut.

### Scope boundaries

- No validator rule design / error UX here — that's [[schema-validation-linter-error-ux]]; these tests *consume* those rules later.
- No visual/SSE/generator tests (orthogonal).
- Stale `test/fixtures/sample_model.yaml` cleanup is a separate concern — note, don't fold in.
