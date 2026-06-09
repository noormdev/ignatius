# Noorm flow authoring + Socratic discovery modes


## Goal

Add two modes to the `noorm-modeling` skill: **`flow`** (structured Q&A authoring of SSADM DFD markdown) and **`discover`** (opt-in Socratic interview that generates both ERD entities and DFDs from a business description). Both produce real files verified by `ignatius validate`. No source changes — skill markdown only.


## Non-goals

- No new `flow.*` validator rules; `src/flow-validate.ts` and all `src/` code untouched. Examples and business-context richness are enforced by the authoring method, not by code.
- No autonomous bulk authoring; no CSV import.
- No reverse-engineering of the model's own `.md` files back into an editing form. (Reverse-engineering an *external* system — DB/schema/codebase/API — into a model **is** in scope, via `references/reverse-engineering.md`.)
- `discover` does not replace `/pressure-test` — it is the generative counterpart.
- The fourth mode is named `discover` (settled). A later rename is a trivial find-replace across SKILL.md + the one reference filename.
- Sample-rows format reconciliation (entity prose `## Sample rows` vs structured `examples:`) is NOT fixed in this batch — the entity-side change is tracked separately. This batch only handles seeding gracefully across both formats (see criteria).


## Success criteria

- [ ] `SKILL.md` `argument-hint` is `[entity|model|flow|discover]`; the router dispatches `flow` → `references/dfd-authoring.md` and `discover` → `references/discover-flow.md`; bare/unrecognized arg asks the user to pick among all four.
- [ ] `references/dfd-authoring.md` exists and drives F0–F9: locate root + read entities → diagram id → name processes (verbs) → externals → `db:`/`kind:` store fork → in/out flows (all fields) → examples → body context → optional sub-DFD → write + validate.
- [ ] `flow` mode always writes in/out `examples:` frontmatter. When a flow is `db:<Entity>` and that entity carries structured `examples:` frontmatter, seed from it; when the entity carries only a prose `## Sample rows` section (the current format), reuse those values; when neither exists, co-create the rows with the user. The reference must handle all three cases explicitly.
- [ ] `flow` mode's store-kind menu in `dfd-authoring.md` lists exactly `db:` (first), `cache`, `queue`, `file`, `doc`, `manual`, `other`. The menu is a suggestion for *classifying* the user's store, but the reference states the token prefix set is closed (it is — `src/flow-parse.ts` `VALID_KINDS_LIST`): an off-menu kind is authored as `kind: other` + `title:`, never as an invented prefix.
- [ ] `flow` mode is positive-framed: the references describe only process↔store and process↔external shapes. A reviewer grep of `dfd-authoring.md` and `flow-templates.md` finds no mention of store↔store, ext↔store, ext↔ext, or process↔process as connections "to avoid" / "don't" / "never" — the illegal shapes are never named at all.
- [ ] `flow` mode requires business-context body sections: externals (role + `## What X does` + expectations), non-db stores (reason-for-existence + sample `rows:`), db-entity rationale reinforced when thin.
- [ ] `references/discover-flow.md` exists and documents the five-gate spine (Identify / Decide / Justify / Derive / Ground), each with a plain-English question form and an internal principle that is never surfaced to the user.
- [ ] `discover` mode is verb-led: the reference's write steps always emit entity files (via the entity-flow steps) before emitting any flow process files that reference them, then validate.
- [ ] `discover` mode crystallizes incrementally (writes a node's file once it passes all five gates).
- [ ] `discover` mode never lets formal-logic jargon reach the user. A reviewer grep of `discover-flow.md`'s user-facing question forms finds none of: "excluded middle", "law of identity", "non-contradiction", "sufficient reason", "four causes", "three-valued logic", "falsifiable", "syllogism". These terms may appear only in internal-guidance sections explicitly marked as not-surfaced-to-the-user.
- [ ] `references/reverse-engineering.md` exists and documents a phased extraction (inventory sources → extract ER → extract DFDs → ground with real data → reconcile through the five gates → verify), in the IDEF1X spirit: read-don't-invent, faithful-first-better-second, reconstruct key migration to detect the key-inherited/orm convention, derive identifying/classification (never declare). It maps reads→inputs and writes→outputs at column level, and is wired as `discover`'s artifact-evidence source.
- [ ] `references/flow-templates.md` exists with process / external / store frontmatter templates including worked `inputs`/`outputs`/`examples` and `rows:` examples.
- [ ] CLAUDE.md feature-↔-doc map gains a row for the new modes, pointing at this spec, the design, and the skill references.
- [ ] The `db:`/`ext:`/`kind:` endpoint tokens and the `examples:`/`rows:` frontmatter shape used in `flow-templates.md` match `docs/spec/process-flows.md` exactly (verified field-by-field against a process file in `models/key-inherited/flows/`).
- [ ] End-to-end trace: a `flow`-mode walkthrough writes flow files under a scratch model that pass `ignatius validate <model>` (exit 0, or only findings already present in the baseline) — checked as part of Checkpoint 1.


## Approaches

| # | Approach | Sketch | Cost | Risk |
|---|----------|--------|------|------|
| A | Two new modes on `noorm-modeling`, reusing SKILL.md + references scaffold | `flow` + `discover` references; SKILL router updated | med | SKILL.md routing grows to 4 modes |
| B | Separate `noorm-flows` skill | New skill dir | med | Splits model knowledge; discovery straddles two skills |
| C | New validator rules to enforce examples/richness | `flow.*` rules in code | high | User-rejected; blocks half-authored flows |
| D | Bake store-kind enum into validator | hard enum | med | User chose skill-side menu |


## Recommendation

**Approach A.** Discovery derives entities from processes and must write the ERD before the DFD, so one skill must own both entity and flow authoring — splitting (B) breaks that. Code enforcement (C/D) was settled against: the method enforces, existing `flow-validate.ts` is the unchanged backstop. The logical apparatus is translated from `~/.claude/commands/pressure-test.md` (three laws, four causes, sufficient reason) into a generative posture; structural rules and adoption decisions are grounded in `docs/research/ssadm-dfd-rules.md`.


## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | `flow` mode references + templates + e2e trace | `skills/noorm-modeling/references/dfd-authoring.md`, `references/flow-templates.md` | atomic-builder | 2 | F0–F9 present; no mention of store↔store / ext↔store / ext↔ext / process↔process as things "to avoid" (grep clean); store-kind menu lists exactly `db:`/`cache`/`queue`/`file`/`doc`/`manual`; examples-always with all 3 seeding cases; required context sections; templates' tokens + `examples:`/`rows:` shape match `process-flows.md`; a walkthrough produces files passing `ignatius validate` on a scratch model |
| 2 | `discover` mode reference (five-gate Socratic method) | `skills/noorm-modeling/references/discover-flow.md` | atomic-builder | 1 | Five gates (Identify/Decide/Justify/Derive/Ground) with plain-English forms + internal-only principles; verb-led (entities emitted before flows); incremental write; no banned jargon in user-facing forms (grep clean); emits both entities + flows; routes to reverse-engineering when a real system exists |
| 2b | Reverse-engineering reference (extract from an existing system) | `skills/noorm-modeling/references/reverse-engineering.md` | atomic-builder | 1 | Phased R0–R4 (inventory → ER → DFDs → ground → reconcile through gates); IDEF1X spirit (read-don't-invent, key-migration detection, derive-never-declare); reads→inputs / writes→outputs at column level; surfaces anti-patterns as user decisions, never silent rewrites |
| 3 | SKILL.md router update | `skills/noorm-modeling/SKILL.md` | atomic-surgeon | 1 | `argument-hint` = `[entity|model|flow|discover]`; `flow`/`discover` dispatch lines; bare-arg picker lists four; new modes reference the existing core rules |
| 4 | CLAUDE.md feature-map row | `CLAUDE.md` | atomic-surgeon | 1 | Feature-map row added pointing at this spec + design + the new references (cross-refs inside reference files belong to CP1/CP2, not here) |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `discover` reference drifts toward cloning pressure-test (negative/critique posture) | med | Spec pins generative posture + the five *positive* gates; reviewer checks polarity, not similarity |
| Positive framing slips — a reference names an illegal connection "to avoid" | med | Success criterion forbids it explicitly; reviewer greps references for store↔store / process↔process mentions |
| Entities carry prose `## Sample rows`, not structured `examples:`, so flow-example seeding has no structured source | med | `dfd-authoring.md` handles all three seeding cases explicitly (structured `examples:` → reuse; prose `## Sample rows` → reuse those values; neither → co-create with user); flow templates emit structured `examples:`; the entity-side format reconciliation is out of scope and tracked separately |
| References contradict the shipped flow format (tokens, kinds, frontmatter keys) | low | Checkpoint 1/2 verify against `process-flows.md` + `ssadm-dfd-rules.md`; end-to-end trace catches format drift |


## Change log


### 2026-06-09 — Correction: store-kind menu adds `other`; token prefix set is closed

**What changed:** The store-kind menu criterion now includes `other` and requires the reference to state that the endpoint token prefix set is closed (off-menu kinds → `kind: other` + `title:`, token `other:<slug>`).

**Why:** Review simulation showed the old "never a closed set the user can't extend" wording sent an executor to invent a token prefix (`waitlist:standby-list`), which the parser does not read as a kind — it falls through to process-name resolution and fails with a misleading `flow.unknown_process` error, while the store file's unrecognized `kind:` is silently coerced to `other` (`src/flow-parse.ts`). The user may *describe* any kind; the *tokens* are an enum.

**Superseded:** the menu listed five kinds without `other` and was forbidden from presenting the set as closed.
