---
name: ignatius-modeling
description: Author an ignatius entity or bootstrap a new model through guided Q&A then verify with the ignatius CLI. Use when adding an entity or starting a model.
argument-hint: "[entity|model]"
allowed-tools: Read Write Edit Bash Glob AskUserQuestion
---

# Ignatius modeling

Guide the user through authoring an ignatius entity `.md` file or bootstrapping a new model, writing real files to disk and verifying them with the `ignatius` CLI.

## Quick Start

Read `$ARGUMENTS` to choose the mode, then follow the matching reference file step by step:

- `entity` — add one entity. Follow `references/entity-flow.md`.
- `model` — bootstrap a new model skeleton. Follow `references/model-flow.md`.
- empty or unrecognized — ask: "Which mode — `entity` (add one entity) or `model` (bootstrap a new model)?"

After writing any file, always run the verification loop in `references/verification.md`, then report or fix the findings.

## Core rules

- Derive, never ask: the parser infers `classification` and per-edge `identifying` from key shape. Ask `reference: true?` only for lookup or code tables.
- Choose an authoring convention once per model and keep it for the session:
  - `key-inherited` — parent PK columns propagate into the child PK, so foreign-key columns live inside the PK.
  - `orm-oriented` — each entity has a single surrogate `id`, and foreign-key columns sit outside the PK.
- Detect the convention from an existing entity: a composite PK that contains a foreign-key column is `key-inherited`; a single `id` PK with foreign keys outside is `orm-oriented`. State the detected convention and continue with it unless the user switches.

## Reference files

Load only the file for the step you are on:

- `references/entity-flow.md` — entity Q&A steps and convention-contradiction checks.
- `references/model-flow.md` — new-model bootstrap Q&A steps.
- `references/verification.md` — the `ignatius dict` loop and the rule reference table.
- `references/templates.md` — entity, group, and `ignatius.yml` templates with worked examples.
- `references/conventions.md` — column types and the classification and cardinality derivation tables.
