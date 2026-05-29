# Ignatius modeling skill — spec


## Goal

Ship two Claude Code skills — `/new-entity` and `/new-model` — that guide a user through authoring ignatius entity and model files via a Q&A loop, encode IDEF1X rules to prevent lint violations before they occur, write real files to disk, and verify the output by invoking the `ignatius` CLI.


## Non-goals

- No linter reimplementation. The skill depends on `schema-lint-and-error-ux` for verification; it does not recheck rules itself.
- No bulk-create (single entity or single model per invocation).
- No model migration from the old YAML format (`scripts/convert-yaml-to-md.ts` covers that).
- No reverse-engineering of an existing entity file into an editable form.
- No CLI sub-command (`ignatius new entity`). Skills are the only invocation surface.
- No templating library dependency.
- No `git add` / `git commit` in the skill. Staging is left to the user. (Resolved from design open question — user controls staging.)


## Success criteria

- `/new-entity` produces a `.md` entity file that — once `schema-lint-and-error-ux` is implemented — has zero lint findings on first run for the happy-path inputs the skill was designed to handle; until then, the soft bar is exit code 0 from `ignatius dict`.
- `/new-model` produces a minimal skeleton (`_groups/*.md`, optional `_theme.yaml`, optional `_branding.yaml`, optional one entity) that — once `schema-lint-and-error-ux` is implemented — has zero lint findings on first run; until then, the soft bar is exit code 0 from `ignatius dict`.
- Both skills ask about models dir when not determinable from context.
- When the user selects classification = `independent` and then nominates an FK column as part of the PK, the skill prompts to resolve the contradiction (either change classification or drop the FK from the PK) BEFORE writing any file.
- After writing, both skills run `ignatius dict <dir>` and surface any findings with a fix-or-skip prompt.
- The verification loop is bounded to 5 attempts per skill invocation. If the limit is exceeded, the skill surfaces all remaining findings to the user and exits — it does not silently stop.
- When the user opts into custom branding or theme during `/new-model`, the resulting `_branding.yaml` / `_theme.yaml` carry all required top-level keys for those schemas (dark palette for theme; copyright + title for branding).
- Skills live at `.claude/skills/new-entity/SKILL.md` and `.claude/skills/new-model/SKILL.md` (project-scoped).
- Invoking either skill from outside an ignatius project does not error — the skill asks for the models dir path.


## Approach

Implement two independent SKILL.md files that encode the Q&A flows, IDEF1X classification rules, and file schemas described in `docs/design/ignatius-modeling-skill.md` and `docs/design/markdown-driven-erd.md`. Each skill body references `docs/spec/schema-lint-and-error-ux.md` as the authority on linter rules, so the question ordering stays aligned with what the linter flags. CP-3 (verification loop) depends on that spec being implemented and emitting structured stderr output; until then, skills ship in soft-verify mode (exit code only).


## Checkpoints

| # | Checkpoint | Deliverable | Verifies |
|---|------------|-------------|----------|
| CP-1 | `/new-entity` skill | `.claude/skills/new-entity/SKILL.md` containing the encoded IDEF1X rules, entity `.md` frontmatter template, and Q&A flow (see design doc for full sub-item list) | Invoking `/new-entity` walks the Q&A, writes a well-formed entity `.md` file, and exits 0 on `ignatius dict <dir>` against the output (soft-verify until `schema-lint-and-error-ux` ships structured stderr); IDEF1X contradiction (independent + FK-in-PK) is caught during the flow, not post-write |
| CP-2 | `/new-model` skill | `.claude/skills/new-model/SKILL.md` containing the encoded bootstrap Q&A, `_groups/*.md` schema, `_theme.yaml` schema, `_branding.yaml` schema, and file write step (see design doc for full sub-item list) | Invoking `ignatius dict <dir>` against the skeleton exits 0 (soft-verify until `schema-lint-and-error-ux` ships structured stderr) |
| CP-3 | Verification loop | Both SKILL.md files amended with a post-write block that runs `ignatius dict <dir>`, parses stderr lint output per `schema-lint-and-error-ux` format, reports findings with fix hints, and re-loops (max 5 attempts). **Dependency:** `schema-lint-and-error-ux` must be implemented and emitting structured stderr before this CP ships. Until then, CP-1 and CP-2 ship with soft-verify (exit code only) and CP-3 is a follow-up. | After writing a file with a deliberate lint violation, the skill surfaces the finding, offers to revise, and the corrected file passes on the next run; stderr output of `ignatius dict` matches the structured format defined in `docs/spec/schema-lint-and-error-ux.md` (one line per finding, `severity category file message`) |
| CP-4 | README update | `README.md` amended with a "Modeling skills" section announcing `/new-entity` and `/new-model`, prerequisites (Claude Code, `ignatius` binary in PATH), and one example invocation each | Section is present and accurate; no broken links |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `schema-lint-and-error-ux` not yet implemented when CP-3 is attempted | High | CP-1 and CP-2 explicitly ship in soft-verify mode (exit code only); CP-3 is gated on that spec being implemented. The BRIEF notes this dependency explicitly. |
| Skill Q&A flow diverges from linter rules over time (rules change, skill body not updated) | Medium | Both SKILL.md files include a frontmatter pointer to `docs/spec/schema-lint-and-error-ux.md`. Sync is manual but explicit — the spec author updates the skill when linter rules change. |
| IDEF1X contradiction detection requires LLM judgment on ambiguous user answers | Medium | Skill encodes the specific rule (dependent ↔ FK in PK) as a deterministic check with an explicit re-ask; for ambiguous cases it explains the rule and re-prompts rather than guessing. |
| `/new-model` skeleton accepted by `parseModels()` but silently wrong (missing optional fields that the tool expects) | Low | CP-2 Verifies uses `ignatius dict` exit code as the observable signal; any silent parse failures surface as a non-zero exit. |
| Target entity / `_groups` file already exists at the chosen path | Medium | Skill checks for existence before writing; prompts the user to overwrite, choose a different id, or abort. |
| Five-attempt verification loop insufficient for deeply nested lint violations | Low | Five attempts covers the common cases; if exceeded, the skill surfaces all remaining findings and exits, leaving the user to fix manually. Not a blocking risk. |


## Change log

<!-- empty during drafting; first entry on first post-approval amendment -->
