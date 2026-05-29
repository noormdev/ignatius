# Ignatius modeling skill


## Problem

Authoring an ignatius entity file today means:

1. Hand-write the YAML frontmatter without IDE help (no schema, no completion).
2. Remember the IDEF1X classification rules (independent vs dependent vs subtype — including the FK-in-PK = dependent rule that even seasoned users get wrong).
3. Know that group color, sort_key, and theme must live in `_groups/*.md` and `_theme.yaml`, not on the entity itself.
4. Run `ignatius dict` afterwards to discover mistakes — by which point the lint surface is reactive, not preventive.

The result: every new contributor's first entity is a half-broken file that produces lint warnings on first run. Reviewers spend cycles on mechanical issues. The skill is the antidote — a guided authoring loop that produces a properly-formed file the first time and verifies it by invoking the CLI.


## Goals / Non-goals

- **Goals**
    - One skill (`/ignatius-modeling`) with two modes selected by a positional arg:
        - **`entity`** — author a single entity .md file given an existing `models/` root.
        - **`model`** — bootstrap a complete `models/` skeleton (`_groups/`, optional `_theme.yaml`, optional `_branding.yaml`, one or two reference entities).
    - The skill knows the IDEF1X rules — it asks the right questions in the right order so the resulting file satisfies the linter on first run.
    - After writing, the skill runs `ignatius dict <models>` and reports any lint findings. If findings appear, the skill prompts the user to fix them iteratively.
    - The skill is invoked via the standard Claude Code skill mechanism: `/ignatius-modeling entity` or `/ignatius-modeling model`. Bare `/ignatius-modeling` asks the user to pick.
    - Skill output: real file(s) on disk, staged but not committed.

- **Non-goals**
    - The skill is NOT the linter. It depends on the linter (`schema-lint-and-error-ux` spec) to verify output.
    - No autonomous bulk-create (skill won't loop through "add 20 entities from a CSV" — single-entity or single-model invocations only).
    - No model migration (the older YAML format → current markdown format). `scripts/convert-yaml-to-md.ts` covers that case.
    - No reverse-engineering of an existing entity (.md file → form to edit). Could come later.


## Sub-modes


### `entity` flow

```mermaid
flowchart TD
    Start[User: /ignatius-modeling entity] --> Q1{Models dir specified?}
    Q1 -->|no| AskDir[Ask for models/ path]
    Q1 -->|yes| Parse[parseModels existing]
    AskDir --> Parse
    Parse --> Q2[Ask: entity id]
    Q2 --> Q3[Ask: classification<br/>kernel/dependent/etc]
    Q3 --> Q4[Ask: group]
    Q4 --> Q5[Ask: PK columns]
    Q5 --> Q6{Is dependent?}
    Q6 -->|user said dependent| Q7[Ask: parent entity FK<br/>guide them to FK-in-PK]
    Q6 -->|user said independent| Q8[Skip parent question]
    Q7 --> Q9[Ask: additional columns]
    Q8 --> Q9
    Q9 --> Q10[Ask: optional body description]
    Q10 --> Write[Write the .md file]
    Write --> Lint[Run ignatius dict + lint]
    Lint --> Report{Any findings?}
    Report -->|no| Success
    Report -->|yes| Loop[Surface findings to user,<br/>offer to edit]
    Loop --> Q2
```

Key behavior: the skill uses the user's earlier answers to *prevent* lint violations rather than just catching them. Example: if the user says "independent" and then declares an FK as part of the PK, the skill catches the contradiction in the question flow, not at lint time.

### `model` flow

```mermaid
flowchart TD
    Start[User: /ignatius-modeling model] --> Q1[Ask: target dir<br/>default ./models]
    Q1 --> Q2[Ask: project name<br/>for _branding title]
    Q2 --> Q3[Ask: theme<br/>default Noorm / custom?]
    Q3 --> Q4[Ask: group names + colors<br/>at least 1]
    Q4 --> Q5[Optional: bootstrap one<br/>reference entity to demo]
    Q5 --> Write[Write _groups/*.md,<br/>optionally _theme.yaml + _branding.yaml,<br/>optionally one entity]
    Write --> Lint[Run ignatius dict on new dir]
    Lint --> Success
```

The skeleton is intentionally minimal — no inflated example data. One group, optionally one entity, ready to grow.


## Invocation

- Skill file lives in this repo so it ships with the project. Path: `.claude/skills/ignatius-modeling/SKILL.md` (project-scoped skill).
- Name: `/ignatius-modeling`. One skill, one file. Mode selected by positional arg: `entity` or `model`.
- Bare `/ignatius-modeling` (no arg) prompts the user to pick which mode. Unknown args fall to the same prompt.
- Invokable from anywhere; if not inside an ignatius `models/`-bearing project the skill asks for paths.


## Knowledge encoded in the skill

The single `SKILL.md` must encode:

- The exact required + optional fields for an entity .md file (id, classification, group, pk, columns, alternateKeys, …).
- The IDEF1X classification → derivation rules, especially:
    - independent / kernel: no FK in PK.
    - dependent: at least one FK column also in PK.
    - subtype: appears in a `subtypeClusters[].members[]` declaration.
    - classifier / associative: standard IDEF1X rules.
- The `_groups/*.md` schema (label, color, optional sort_key, optional desc).
- The `_theme.yaml` schema (dark / light palettes).
- The `_branding.yaml` schema (logo, title, subtitle, copyright, poweredBy).
- Pointers to the linter rule catalog so the skill's questions map 1:1 with what the linter would flag.

These are kept in sync with the canonical sources by referencing `docs/spec/schema-lint-and-error-ux.md` and `docs/design/markdown-driven-erd.md` in the skill's frontmatter / inline body. If the linter rules change, the skill author updates the skill — explicit, not automatic.


## Verification loop

After writing files, the skill runs `ignatius dict <dir> -o /tmp/ignatius-skill-check.html` and parses the CLI's stderr lint output (the format defined by `schema-lint-and-error-ux`). For each finding:

- The skill reports the category + message + fix hint to the user.
- The skill offers to revise: "Update the file?" — if yes, the skill walks the relevant question subset again with the original answers prefilled, writes the file, re-runs.
- Loop bounded to 5 attempts (defensive against infinite cycles from misbehaving CLI).

The verification step depends on the linter shipping. Until then, the skill can ship with a "soft" verify (run CLI, report exit code only; warnings invisible). The spec marks this as a v1.0 vs v1.1 distinction.


## Open questions

- **Skill auto-stage?** Should the skill `git add` the new file(s)? Likely no — leave staging to the user. They might want to iterate before committing.
- **Body markdown content** — should the skill ask for a short description or leave the body blank? Probably ask for an optional one-sentence summary; longer prose is better written outside a Q&A flow.


## Approaches considered and rejected

| Rejected | Why |
|----------|-----|
| Two separate skills (`/new-entity` + `/new-model`) | User picked "separate sub-modes" — one skill, two args — in the original clarify round. Splitting into two skill files contradicts that selection and doubles the surface for no benefit. |
| Hand-rolled CLI subcommand (`ignatius new entity`) | Skills are the right surface — interactive, in-IDE, in the same loop as everything else Claude Code touches. CLI sub-command duplicates that surface. |
| Skill that writes through a templating library (Mustache, EJS) | Overkill. Skills are markdown + LLM judgment; templates would add a dep without buying much. |
| Skill that bypasses the linter and trusts its own checks | Would diverge over time. Skill DEPENDS on the linter; doesn't reimplement it. |
| Skill that doesn't verify (just writes the file) | Fails the goal — the whole point is "lint-clean on first run". Verify is non-optional. |
