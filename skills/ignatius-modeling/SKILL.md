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
- Convention is derived, not declared. Two key styles exist — `key-inherited` (parent PK columns migrate into the child PK, so foreign keys live inside the PK) and `orm-oriented` (each entity has a surrogate `id`, foreign keys sit outside the PK) — but the user never sets a "mode". Each entity's PK shape *is* its convention; read it back, don't enforce it.
- Detect the prevailing style from existing entities and use it only as the default suggestion for the next entity: a composite PK containing a foreign-key column → `key-inherited`; a single `id` PK with foreign keys outside → `orm-oriented`. If one entity deviates, nudge once and allow it — a model may legitimately mix styles entity by entity.
- Existence rules survive the key style. In key-inherited models a mandatory parent is asserted by key placement; in orm-oriented models the same rule lives in FK nullability (`nullable: false`) and in the body as a documented cascade/existence constraint. Surface it either way — the dependency is never lost, only expressed in a different channel.
- Subtype clusters are an independent authoring choice, present or absent regardless of key style. Offer the subtype step when an entity divides into kinds or is one of those kinds; classification as Subtype is then derived from the cluster declaration, never asked.
- Predicates carry business meaning, not cardinality. Push for the domain verb a stakeholder would say ("makes payments using", "is classified by", "settles") over generic ORM phrases ("has many", "belongs to"). The crow's-foot already shows the cardinality; the predicate's job is to make the line read as a true sentence about the business.
- Capture the business story, not just the schema. The markdown body is the reason this tool exists over a plain data dictionary. Actively draw out business rules, constraints, lifecycle/state transitions, and the *why* behind any structural complexity, then record them in the entity body — with their source and justification — so they survive past the conversation and are there at development time. Treat an offhand "billing won't allow payments under $5" or "new users must be authorized before full access" as a documentable rule, not chatter.

## Conducting the interview

How to run both flows well. These reflect how Claude works best as an interactive guide, and they apply throughout.

- **One question at a time.** Ask the current step's question, wait for the answer, then continue. Dumping the whole flow into one prompt makes the user skim and skip the business context (Step E9) that gives the model its value.
- **Explain the WHY when you ask for something non-obvious.** "Parent PK columns first, because key-inherited propagates them into the child key" lands better than a bare demand and teaches the convention as you go. State motivation, not just the rule.
- **Act, don't just suggest.** Once a step's answer is in hand, write or update the file — do not stop at proposing YAML and waiting for permission. The user invoked the skill to produce files. Writing into the model directory is local and reversible; only confirm before overwriting an existing entity.
- **Infer before asking.** Read existing entities, `_groups/`, and `ignatius.yml` first to detect the convention, list groups, and prefill answers. Ask only what the files cannot tell you.
- **Reflect after verification.** When `ignatius dict` returns findings, read them and decide the smallest set of Q&A steps to re-ask before rewriting. Do not blindly regenerate the whole file.
- **Self-check before declaring done.** The linter checks structure, not story. A clean `dict` run is necessary but not sufficient. Before reporting success, confirm the entity actually captured its business rules and rationale (Step E9) and that each predicate reads as a true sentence in both directions — these are the parts no rule can catch.
- **Prefer the positive form.** Tell the user what to write, with a concrete example, rather than listing what to avoid.

## Reference files

Load only the file for the step you are on:

- `references/entity-flow.md` — entity Q&A steps, the one-time convention nudge, and the subtype-cluster step.
- `references/model-flow.md` — new-model bootstrap Q&A steps.
- `references/verification.md` — the `ignatius dict` loop and the rule reference table.
- `references/templates.md` — entity, group, and `ignatius.yml` templates with worked examples.
- `references/conventions.md` — column types and the classification and cardinality derivation tables.
