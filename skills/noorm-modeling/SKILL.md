---
name: noorm-modeling
description: Guided Q&A authoring of ignatius entities, data flow diagrams, and models, plus Socratic discovery. Use when adding entities, flows, or models.
argument-hint: "[entity|model|flow|discover]"
allowed-tools: Read Write Edit Bash Glob AskUserQuestion
---

# Noorm modeling

Guide the user through authoring an ignatius model — entities, data flow diagrams, a new-model bootstrap, or a Socratic discovery session that generates both — writing real files to disk and verifying them with the `ignatius` CLI.

## Quick Start

Read `$ARGUMENTS` to choose the mode, read `references/interviewing.md` for how to conduct it, then follow the matching reference file step by step:

- `entity` — add one entity. Follow `references/entity-flow.md`.
- `model` — bootstrap a new model skeleton. Follow `references/model-flow.md`.
- `flow` — author a data flow diagram, for a user who already knows their processes. Follow `references/dfd-authoring.md` (templates in `references/flow-templates.md`).
- `discover` — Socratically extract a model, generating both entities and flows. Follow `references/discover-flow.md`. When a real database/codebase/schema exists to read, it routes to `references/reverse-engineering.md`.
- empty or unrecognized — ask: "Which mode — `entity` (add one entity), `model` (bootstrap a new model), `flow` (author a data flow diagram), or `discover` (work out a model from how your business runs)?"

After writing any file, always run the verification loop in `references/verification.md`, then report or fix the findings.

## Core rules (apply to all four modes)

- Derive, never ask: the parser infers `classification` and per-edge `identifying` from key shape. Ask `reference: true?` only for lookup or code tables.
- Convention is derived, not declared: an entity's PK shape *is* its style — `key-inherited` (parent PK migrates into the child PK) or `orm-oriented` (surrogate `id`, FKs outside the PK). Detect the prevailing style from existing entities and use it only as the default suggestion; if one entity deviates, nudge once and allow it.
- Adapt to the user's conventions, never invent your own: this extends beyond key style to every naming choice — entity ids, column names, group slugs, flow file names. Read the existing files first and match what is there. The skill's built-in defaults (PascalCase ids, snake_case slugs, Title-Case flow files) apply only when nothing exists yet, and even then as suggestions. Names extracted from a real system stay verbatim.
- Existence rules survive the key style: a mandatory parent is asserted by key placement (key-inherited) or by FK `nullable: false` plus a documented rule in the body (orm-oriented). Surface it either way — the dependency is never lost, only expressed in a different channel.
- Subtype clusters are an independent authoring choice; classification as Subtype is derived from the cluster declaration, never asked.
- Predicates carry business meaning, not cardinality: push for the domain verb a stakeholder would say ("makes payments using", "settles") over "has many" / "belongs to". The crow's-foot already shows cardinality; the predicate makes the line read as a true sentence.
- Examples always, in every mode: every entity carries 2–3 `examples:` rows and every process carries in/out `examples:` — never skipped, never offered as optional. Generate them yourself from the business context (realistic domain values, not `foo`/`1`/`test`), show them, and let the user adjust. Concrete instances expose wrong rules that pass every structural check; a model without examples is unverified.
- Capture the business story, not just the schema: business rules, constraints, lifecycle, and the *why* behind structural complexity go in the body with their source and justification. Treat an offhand "billing won't allow payments under $5" as a documentable rule, not chatter.

## Reference files

Load only the file for the step you are on:

- `references/interviewing.md` — how to conduct the Q&A (read first; applies to every mode).
- `references/entity-flow.md` — entity Q&A steps, the convention nudge, the subtype step.
- `references/model-flow.md` — new-model bootstrap Q&A steps.
- `references/dfd-authoring.md` — DFD Q&A steps: the `db:`/`kind:` store fork, examples-always, business-context bodies.
- `references/flow-templates.md` — process, external, and non-`db` store templates.
- `references/discover-flow.md` — the Socratic five-gate method (generates entities + flows).
- `references/reverse-engineering.md` — extract entities + flows from an existing system (IDEF1X spirit).
- `references/verification.md` — the `ignatius validate` loop and the rule reference tables.
- `references/templates.md` — entity, group, and `ignatius.yml` templates.
- `references/conventions.md` — column types and the classification/cardinality derivation tables.
