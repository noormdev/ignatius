---
id: ignatius-authoring-skill
title: Author a Claude skill for using ignatius (markdown-driven ERD authoring)
created: "2026-05-30"
origin: |
    recovered from session cd4c9886 transcript via /atomic-improve 2026-05-30; originally requested mid-build, never filed
severity: question
review_by: "2026-07-29"
status: open
---

User request (verbatim, recovered from cd4c9886 transcript):

"Once we have everything settled, we need to make a skill for this."

Scope:
- A skill guiding authoring of ignatius models: per-entity markdown frontmatter format, group/color config, FK-inferred cardinality rules, subtype (inclusive/exclusive) conventions, _groups/_theme/_meta layout.
- Gate: "once we have everything settled" — depends on [[schema-validation-linter-error-ux]] (validation rules) and [[model-validation-test-suite]] landing first, so the skill encodes the settled conventions.

---

## Strategist enrichment (2026-05-30, opus, read-only)

### ⚠ Reconcile-first: an overlapping skill spec ALREADY exists

`docs/spec/ignatius-modeling-skill.md` + `docs/design/ignatius-modeling-skill.md` (committed 05-29, commits `4876045` + `81a9edf`) already define a `/ignatius-modeling` skill — **authoring-only, two modes (entity / model), linter-gated verify loop**. Neither mentions ORM or key-inheritance teaching. This follow-up overlaps it heavily. First planning decision: **extend/amend that spec** (preferred — user rejects duplicate skills) vs author a distinct skill. The existing spec already commits the skill to depend on the linter (`schema-validation-linter-error-ux`) rather than re-checking rules — honor that.

### The ORM-vs-key-inheritance tension (the heart of the user's ask)

These are two incompatible identity philosophies, not just different defaults:

- **Clash 1 — surrogate vs propagated PK.** ignatius's cardinality engine reads PK *structure* to infer meaning (`parse.ts:109-112`). Key inheritance makes the child PK a superset of the parent PK (`SalesOrder.pk=[party_id, sales_order_id]`; `SO_Line.pk=[party_id, sales_order_id, line_seq]`). ORMs default to a surrogate `id` + plain FK not in the PK. Model the ORM way and every identifying relationship collapses to the referential branch (`parse.ts:115-122`) — the diagram stops showing key migration, which is the whole point of the tool.
- **Clash 2 — inheritance mapping.** ignatius subtypes (subtype PK = basetype PK) ARE joined-table/class-table inheritance — maps cleanly. ORMs commonly default to single-table inheritance (one table + discriminator) which ignatius cannot represent as separate entities; table-per-class contradicts the "subtype PK = basetype PK" invariant.
- **Clash 3 — composite FK associations.** An identifying relationship is a composite-FK owned `belongsTo`. Many ORMs handle composite keys poorly (Sequelize/TypeORM verbose; Prisma `@@id` + relation `references`). If emitting ORM code, pick targets whose composite-key support is real.

**Reconciliation that holds:** logical-model-first. Treat the ignatius model as the logical truth (composite/natural keys, IDEF1X); ORM/DDL is a **downstream generation target, not an authoring style**. Joined-table inheritance is the one bridge native to both worlds. If a target ORM demands a surrogate `id`, generate it at *emit time* as an extra column while keeping the natural composite PK logical. **The skill cannot teach surrogate-PK ORM authoring and key-inheritance authoring as co-equal styles** — the cardinality engine would produce contradictory diagrams.

### What the skill must encode (non-obvious; author gets wrong without guidance)

- **The FK-in-PK rule is the whole game.** `identifying: true` is declared, but the *cardinality shown* depends on whether `on`'s child cols complete the PK (1:1) or sit alongside an extra discriminator (1:many) — `parse.ts:109-112`. One local discriminator column silently flips cardinality.
- **`classification` is hand-authored and UNCHECKED** (`parse.ts:185`). It is NOT derived (historical spec §4.1 + design doc wrongly say "derived" — shipped code trusts frontmatter). Only `classification === 'Subtype'` drives behavior (`parse.ts:106`); a wrong value on a subtype actively breaks cardinality, every other wrong value only mis-renders.
- **Subtype invariants:** subtype PK = basetype PK column-for-column; subtype declares identifying rel back with `predicate: is a`; exclusive clusters need discriminator path `Entity.column.VALUE` resolving to a classifier seed (`Party.md:16-19`); inclusive clusters use a plain member list, no discriminator.
- **`predicate` is a single string in the CURRENT format** (`parse.ts:28`), NOT the `{fwd,rev}` object in `spec/spec.md` (HISTORICAL). Author copying from spec/spec.md produces a shape the parser mis-handles.
- **AK membership silently flips referential cardinality** (`parse.ts:117`) — adding a unique AK on an FK turns a `many` child into `1`.
- Logical types only (`text, integer, decimal, boolean, date, datetime, binary`); no engine/dialect/length/precision/auto-increment anywhere; no DDL output exists (`rg CREATE TABLE` → 0 hits).

### Open questions to settle before planning

1. **Authoring-only, or also emit DDL/ORM code?** The decisive fork. Existing spec is authoring-only ("No CLI sub-command", verify via `ignatius dict`). "Create ORM-style databases" may need a NEW generation target no spec covers.
2. **If emit: which ORMs/dialects?** Prisma / Drizzle / TypeORM / Sequelize differ sharply on composite keys + joined-table inheritance.
3. **Surrogate keys: allowed / banned / generated-at-emit?** Banning preserves cardinality derivation; allowing degrades the diagram; generate-at-emit is the reconcile path.
4. **Extend `ignatius-modeling-skill` spec, or distinct skill?** (see warning above).
5. **Gate still holds?** Follow-up says "once everything settled" — depends on the linter + test-suite follow-ups (both `status: open`). Building the skill before the linter risks skill/linter divergence (existing spec flags this exact risk).
6. **Single-table / table-per-class inheritance — support or decline?** Recommend decline; key inheritance already implies joined-table.

### Scope boundaries

- Do NOT make surrogate-PK ORM a co-equal authoring style. ORM-ness belongs at emit time.
- Do NOT reimplement validation — depend on the linter.
- Do NOT emit engine-specific DDL as part of *authoring* (separate generation step, own spec).
- Do NOT teach from `spec/spec.md` (HISTORICAL — stale predicate shape + grammar). Source from `docs/design/markdown-driven-erd.md` + `parse.ts` types.
- Do NOT support single-table / table-per-class inheritance.

**Confidence: medium** — codebase facts verified against `parse.ts` + real model files (high); the ORM-emission half has no code/spec to anchor against (reasoning from data-model shape). Would collapse the emission fork (Q1-3) if "ORM-style databases" means only "models that *could* back an ORM app" (authoring-only) rather than "emit ORM/DDL code." **Settle that meaning first.**

---

## User clarification (2026-05-30) — resolves Open Question 1

**"It should generate the markdown files for creating the database dictionary and the graph. Basically the same thing I'm doing in `models/` but oriented for an ORM instead of for a key-inherited database."**

This **collapses the emit fork (Q1-3 above).** The skill output is **ignatius markdown entity files** (the existing per-entity frontmatter format that feeds dict + graph) — NOT DDL/Prisma/Drizzle code. There is no code-generation target.

"ORM-style" is an **authoring convention**, not an emit target. The skill teaches authoring ignatius models in **two flavors along one axis**:

- **Key-inherited** (current `models/`): IDEF1X, parent PK propagates into child composite PK, identifying relationships.
- **ORM-oriented**: surrogate-key style — single surrogate PK per entity, parent link as a plain FK *not* in the PK (how an ORM lays tables out).

Both render to the same dict + graph. This is the entity/model authoring skill (`docs/spec/ignatius-modeling-skill.md`) extended with an **ORM-vs-key-inherited convention axis**.

### NEW open question this surfaces (was the strategist's Clash 1, now the live one)

Authoring ORM-oriented (surrogate PK, FK-not-in-PK) sends every relationship down `deriveCardinality`'s **referential branch** (`parse.ts:115-122`) — no identifying-key migration shown. **Does the current viewer/dict render surrogate-key models acceptably today, or does the derivation/rendering need work to make ORM-oriented models look right?** This is a concrete, factual question → good `/gather-evidence` or quick-experiment target before the skill spec is amended. The earlier emission questions (which ORM, which dialect, surrogate-at-emit) are now **moot** — no emission.

### Superseded

- Open Questions 1-3 (emit-or-not, which ORMs, surrogate-at-emit) — RESOLVED: no emission. Output is markdown.
- "ORM-vs-key-inheritance tension / Clash 1-3" reasoning above still holds as *authoring-convention* differences, but the reconciliation is no longer "emit-time translation" — it's "two documented authoring conventions in one skill," with the open question being whether ignatius *renders* the ORM convention well.

---

## Update (2026-05-30) — classification/identifying now derived from keys

Shipped `docs/spec/derive-classification.md` (commits `50b6897` + `20c7dd5`): the parser now DERIVES `classification` and per-relationship `identifying` from PK/FK structure. Model files no longer carry either field; the only hand-authored signal left is `reference: true` for classifier/lookup tables.

Impact on this skill:
- The authoring Q&A must NOT ask for classification — derive it from keys + relationships. Ask only: keys, relationships (with `on` mapping), and `reference?` for lookup tables.
- The earlier "ORM-vs-key-inherited" axis is now cleaner: ORM-style = surrogate `id` PK + FK-not-in-PK → derives Independent + referential everywhere (no dependent/associative). Key-inherited = FK-in-PK → derives dependent/associative. Both render identically (verified via gather-evidence; ORM-full == key-inherited topology). The skill teaches key placement; classification follows automatically.
- Reconcile notes appended to `docs/spec/ignatius-modeling-skill.md` and `docs/spec/schema-lint-and-error-ux.md` change logs.
