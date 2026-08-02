---
type: Domain
description: Design docs, user guides, research notes, and implementation-contract specs for ignatius — the layered documentation corpus other domains' code and tests cite for coupling.
---

# docs


## What it does


- Houses ignatius's documentation corpus: [`docs/design/`](../design) (conceptual/approach docs), [`docs/guides/`](../guides) (user-facing how-to), [`docs/research/`](../research) (background investigation notes), and [`docs/spec/`](../spec) (implementation contracts) — 72 markdown files total (27 + 10 + 2 + 33). [`docs/glossary.md`](../glossary.md) sits directly under [`docs/`](..) as the shared-vocabulary reference.
- [`README.md`](../../README.md) states the design/spec relationship directly: "Conceptual designs live in [`docs/design/`](../design); the implementation contracts derived from them live in [`docs/spec/`](../spec). Start with [`docs/design/markdown-driven-erd.md`](../design/markdown-driven-erd.md) for the entity format and the derivation rules."
- [`docs/wiki/`](.) also lives under [`docs/`](..) as the generated signals wiki — out of scope for this domain file.


## Docs


### [`docs/design/`](../design) — conceptual/approach docs (27 files)


- [`docs/design/markdown-driven-erd.md`](../design/markdown-driven-erd.md) (333L) — largest design doc; canonical source for the markdown-driven entity file format. No matching [`docs/spec/`](../spec) file of its own exists — [`docs/wiki/feature-map.md`](feature-map.md)'s own "Markdown entity / folder format" row lists the Spec column as `—`.
- [`docs/design/process-flows.md`](../design/process-flows.md) (218L) — design doc for the SSADM DFD subsystem (processes, externals, stores, sub-DFDs).
- [`docs/design/schema-lint-and-error-ux.md`](../design/schema-lint-and-error-ux.md) (205L) — design doc for schema lint + error UX.
- [`docs/design/key-inheritance-lineage.md`](../design/key-inheritance-lineage.md) (175L, grew from 132L) — design doc for the key-inheritance-lineage feature: key-edge rule (FK ⊆ child PK, subset test), transitive connected-component lineage, DD dotted line + DG shift+hover reveal. Change log's newest entries (2026-08-01) record two corrections: associative/junction entities are now traversal BARRIERS (reachable but never passed through, to stop a hub like `Tag` welding every parent it links into one lineage), and the `?lineage=legacy` URL escape hatch used to A/B that fix was removed once the rule was accepted.
- [`docs/design/noorm-flow-discovery.md`](../design/noorm-flow-discovery.md) (179L) — design doc adding two modes to the `noorm-modeling` skill: `flow` (structured Q&A DFD authoring) and `discover` (Socratic interview generating both ERD entities and DFDs from a business description, including reverse-engineering an external system as an evidence source).
- [`docs/design/unified-app.md`](../design/unified-app.md) (152L) — design doc for the unified SPA collapse.
- [`docs/design/branding.md`](../design/branding.md) (160L) — design doc for the branding system.
- [`docs/design/noorm-modeling-skill.md`](../design/noorm-modeling-skill.md) (151L) — design doc for the ignatius modeling skill.
- [`docs/design/viewer-fab-ux.md`](../design/viewer-fab-ux.md) (144L) — design doc for the floating action button UX.
- [`docs/design/app-tsx-decomposition.md`](../design/app-tsx-decomposition.md) (142L) — design doc for the `src/App.tsx` → [`src/app/`](../../src/app) decomposition.
- [`docs/design/cli-and-outputs.md`](../design/cli-and-outputs.md) (135L) — design doc for CLI modes and the static output approach.
- [`docs/design/example-instance-tables.md`](../design/example-instance-tables.md) (135L) — design doc for example/sample-row instance tables.
- [`docs/design/viewer-ux-polish.md`](../design/viewer-ux-polish.md) (133L) — design doc for a 6-fix viewer-ux-polish batch (HTML title, spotlight line separation, native 1:1 zoom, Cmd/Ctrl+/-/0 canvas zoom, process node sizing, entity modal history).
- [`docs/design/folder-model.md`](../design/folder-model.md) (104L) — design doc for the folder-model migration: `_*`-prefix vs hoisted top-level folders, hard-cut migration strategy.
- [`docs/design/keyboard-nav-shortcuts.md`](../design/keyboard-nav-shortcuts.md) (110L) — design doc for single-key keyboard navigation shortcuts (keymap rationale, guard philosophy, `kbd-hint` badge UX).
- [`docs/design/ignatius-project-config.md`](../design/ignatius-project-config.md) (107L) — design doc for `ignatius.yml` config + model discovery.
- [`docs/design/graph-position-persistence.md`](../design/graph-position-persistence.md) (118L) — design doc for graph node position persistence.
- [`docs/design/dict-navigation.md`](../design/dict-navigation.md) (100L) — design doc for data-dictionary side navigation.
- [`docs/design/dfd-edge-hover-data.md`](../design/dfd-edge-hover-data.md) (100L) — design doc for DFD edge-hover data reveal (HTML overlay tooltip chosen for zoom-independence).
- [`docs/design/dfd-overhaul.md`](../design/dfd-overhaul.md) (93L) — design doc for the DFD viewer overhaul: Yourdon/SSADM leveling, ELK-driven layout, 5-band partitioning, orthogonal edge routing.
- [`docs/design/graph-flow-search.md`](../design/graph-flow-search.md) (84L) — design doc for search on the Graph and Flows views: dim-don't-filter approach, title-first matching with an "Include descriptions" toggle, shared `SearchBar` component.
- [`docs/design/dfd-nesting-depth.md`](../design/dfd-nesting-depth.md) (75L) — design doc for the arbitrary DFD nesting depth fix (root-cause: `renumberLeaf`'s last-segment-only prefix bug).
- [`docs/design/bidirectional-predicates.md`](../design/bidirectional-predicates.md) (67L) — design doc for the bidirectional predicate feature.
- [`docs/design/help-overlay.md`](../design/help-overlay.md) (62L) — design doc for the view-aware help overlay.
- [`docs/design/dd-spotlight-grid.md`](../design/dd-spotlight-grid.md) (60L) — design doc for the DD browse-lens spotlight grid.
- [`docs/design/wiki-entity-links.md`](../design/wiki-entity-links.md) (59L) — design doc for wiki-style `[[Entity]]` body links.
- [`docs/design/src-root-organization.md`](../design/src-root-organization.md) (49L) — design doc for the [`src/`](../../src) top-level subdirectory split.
- `docs/design/dict-polish.md`, `docs/design/dfd-polish-round2/3/4.md`, `docs/design/render-perf-indexing.md`, `docs/design/unified-app-polish.md`, `docs/design/derive-classification.md` do NOT exist — their specs (below) shipped without a separate design doc.


### [`docs/guides/`](../guides) — user-facing how-to (10 files)


All ten are linked from [`README.md`](../../README.md)'s docs table:


- [`docs/guides/getting-started.md`](../guides/getting-started.md) (93L) — install, build from source, serve the first model.
- [`docs/guides/commands.md`](../guides/commands.md) (156L) — the five CLI subcommands (three model commands + two utility commands) and the full keyboard-shortcut table, including search-focus and canvas-pan chords.
- [`docs/guides/folder-format.md`](../guides/folder-format.md) (159L) — `ignatius.yml`, the five recognized top-level folders (`data/`, `flows/`, `groups/`, `externals/`, `stores/`), entity/column/relationship authoring.
- [`docs/guides/derivation.md`](../guides/derivation.md) (45L) — what gets derived (cardinality, classification, subtype clusters) vs authored by hand.
- [`docs/guides/predicates.md`](../guides/predicates.md) (83L) — bidirectional relationship-edge label authoring.
- [`docs/guides/flows.md`](../guides/flows.md) (148L) — DFDs: processes, externals, stores, sub-DFDs, SSADM/Gane-Sarson rendering.
- [`docs/guides/validation.md`](../guides/validation.md) (113L) — the linter, severity tiers, and where findings surface (live viewer, static dictionary/graph, CLI stderr).
- [`docs/guides/themes-and-branding.md`](../guides/themes-and-branding.md) (83L) — `theme`/`branding` blocks in `ignatius.yml`, shared across all three subcommands.
- [`docs/guides/modeling-skill.md`](../guides/modeling-skill.md) (71L) — the `/noorm-modeling` Claude Code skill: entity, flow, model, and discover Q&A modes, verified via `ignatius validate`.
- [`docs/guides/building-from-source.md`](../guides/building-from-source.md) (50L) — Bun build stages (`bun build --compile`), project layout, tests.


### [`docs/research/`](../research) (2 files)


- [`docs/research/ssadm-dfd-rules.md`](../research/ssadm-dfd-rules.md) (118L) — research notes on SSADM DFD rules.
- [`docs/research/dfd-layout-and-leveling.md`](../research/dfd-layout-and-leveling.md) (129L) — research notes on DFD layout engines and Yourdon leveling; primary source for the dfd-overhaul design doc's ELK algorithm selection and band-partitioning option names.


### [`docs/spec/`](../spec) — implementation contracts (33 files)


- [`docs/spec/process-flows.md`](../spec/process-flows.md) (682L) — largest spec in the corpus; comprehensive implementation contract for SSADM DFD: parse, 11 `flow.*` rules, flow viewer, sub-DFD drill-down, `db:` store → entity dialog, non-entity store kinds, entity↔process cross-reference, DFD URL navigability.
- [`docs/spec/key-inheritance-lineage.md`](../spec/key-inheritance-lineage.md) (372L) — implementation contract for key-inheritance-lineage: `buildInheritedConnections` key-edge connected-component algorithm, DG ephemeral `edge.inherited` lifecycle, DD `SpotlightOverlay` dotted lines, shift-gated reveal on both surfaces. Its own change log runs through 2026-06-20 only — the design doc's 2026-08-01 associative-entity-barrier and legacy-escape-hatch entries are NOT yet mirrored here (see Concerns).
- [`docs/spec/app-tsx-decomposition.md`](../spec/app-tsx-decomposition.md) (246L) — implementation contract for the `App.tsx` decomposition.
- [`docs/spec/dfd-polish-round3.md`](../spec/dfd-polish-round3.md) (238L) — implementation contract for CP18–23.
- [`docs/spec/dd-spotlight-grid.md`](../spec/dd-spotlight-grid.md) (239L) — implementation contract for the DD browse-lens spotlight grid (`spotlight.ts`, `flow-spotlight.ts`, `GridCard`, `SpotlightOverlay`).
- [`docs/spec/render-perf-indexing.md`](../spec/render-perf-indexing.md) (231L) — implementation contract for the render-perf-indexing batch: preset-layout cache-skip, ELK cost scaling, O(n²)→Map indexing, ELK-in-worker, `buildModelIndex`.
- [`docs/spec/unified-app.md`](../spec/unified-app.md) (216L) — implementation contract for the unified SPA.
- [`docs/spec/noorm-modeling-skill.md`](../spec/noorm-modeling-skill.md) (204L) — implementation contract for the ignatius modeling skill.
- [`docs/spec/graph-flow-search.md`](../spec/graph-flow-search.md) (199L) — implementation contract for Graph/Flows search (SC1–SC12).
- [`docs/spec/unified-app-polish.md`](../spec/unified-app-polish.md) (194L) — implementation contract for the CP1–CP13 unified-app-polish batch.
- [`docs/spec/keyboard-nav-shortcuts.md`](../spec/keyboard-nav-shortcuts.md) (189L) — implementation contract for keyboard navigation shortcuts (`resolveShortcut`, `useKeyboardShortcuts`).
- [`docs/spec/viewer-ux-polish.md`](../spec/viewer-ux-polish.md) (180L) — implementation contract for the viewer-ux-polish batch.
- [`docs/spec/dfd-polish-round2.md`](../spec/dfd-polish-round2.md) (169L) — implementation contract for CP14–17.
- [`docs/spec/dfd-polish-round4.md`](../spec/dfd-polish-round4.md) (159L) — implementation contract for CP24–26 (DD sidebar process nesting, IO endpoint clickability, sample-data tables).
- [`docs/spec/dfd-overhaul.md`](../spec/dfd-overhaul.md) (155L) — implementation contract for the DFD viewer overhaul; success criteria C1–C18.
- [`docs/spec/bidirectional-predicates.md`](../spec/bidirectional-predicates.md) (157L) — implementation contract for bidirectional predicates.
- [`docs/spec/schema-lint-and-error-ux.md`](../spec/schema-lint-and-error-ux.md) (141L) — implementation contract for schema lint + error UX.
- [`docs/spec/example-instance-tables.md`](../spec/example-instance-tables.md) (140L) — implementation contract for example/sample-row instance tables.
- [`docs/spec/cli-and-outputs.md`](../spec/cli-and-outputs.md) (133L) — implementation contract for CLI output modes and the theme system.
- [`docs/spec/folder-model.md`](../spec/folder-model.md) (117L) — implementation contract for the folder-model migration.
- [`docs/spec/ignatius-project-config.md`](../spec/ignatius-project-config.md) (108L) — implementation contract for `ignatius.yml` config loading + model discovery.
- [`docs/spec/graph-position-persistence.md`](../spec/graph-position-persistence.md) (106L) — implementation contract for graph node position persistence.
- [`docs/spec/viewer-fab-ux.md`](../spec/viewer-fab-ux.md) (101L) — implementation contract for FAB UX.
- [`docs/spec/branding.md`](../spec/branding.md) (102L) — implementation contract for branding.
- [`docs/spec/dict-navigation.md`](../spec/dict-navigation.md) (90L) — implementation contract for the dict side nav.
- [`docs/spec/dict-polish.md`](../spec/dict-polish.md) (87L) — implementation contract for dict visual polish; no design-doc counterpart.
- [`docs/spec/noorm-flow-discovery.md`](../spec/noorm-flow-discovery.md) (83L) — implementation contract for the `flow`/`discover` skill modes; skill-markdown-only, no [`src/`](../../src) changes.
- [`docs/spec/dfd-edge-hover-data.md`](../spec/dfd-edge-hover-data.md) (83L) — implementation contract for DFD edge-hover data reveal.
- [`docs/spec/src-root-organization.md`](../spec/src-root-organization.md) (82L) — implementation contract for the [`src/`](../../src) directory split.
- [`docs/spec/wiki-entity-links.md`](../spec/wiki-entity-links.md) (79L) — implementation contract for wiki-entity links.
- [`docs/spec/derive-classification.md`](../spec/derive-classification.md) (72L) — implementation contract for the 5-rule classification derivation; no design-doc counterpart.
- [`docs/spec/dfd-nesting-depth.md`](../spec/dfd-nesting-depth.md) (69L) — implementation contract for the DFD nesting-depth fix.
- [`docs/spec/help-overlay.md`](../spec/help-overlay.md) (64L) — implementation contract for the help overlay.


### [`docs/glossary.md`](../glossary.md) (52L)


Canonical vocabulary table: DG (Data Graph), DD (Data Dictionary), DFD (Data Flow Diagram), DE (Data Entity), DS (Data Store), EE (External Entity), Process, Data Flow — plus the DS ⊃ DE and EE-vs-DS relationship notes and the `kind:` store taxonomy (`db`/`cache`/`queue`/`file`/`doc`/`manual`/`other`).


## Coupling


- [`docs/spec/dfd-overhaul.md`](../spec/dfd-overhaul.md) — success criteria C4, C16, C17 are cited by name in the **flow-view** domain ([`src/flow-view/elk-flow-layout.ts`](../../src/flow-view/elk-flow-layout.ts), band-layout contract); all six (C4, C5, C13, C15, C16, C17) are checked directly by tests in **frontend**/root test suites ([`test/checks/test-cp4b-elk-edge-routing.ts`](../../test/checks/test-cp4b-elk-edge-routing.ts), `test-cp4c-single-row-bands.ts`, `test-cp4d-frame-alignment.ts`, `test-elk-flow-positions.ts`, [`test/visual/test-cp2-dfd-edge-labels.ts`](../../test/visual/test-cp2-dfd-edge-labels.ts)).
- [`docs/spec/graph-flow-search.md`](../spec/graph-flow-search.md) — SC5 is cited by name in **frontend** ([`src/app/logic/search.ts`](../../src/app/logic/search.ts)) and CP1 by [`test/checks/test-viewer-search.ts`](../../test/checks/test-viewer-search.ts).
- [`docs/spec/derive-classification.md`](../spec/derive-classification.md) — cited by name in [`test/checks/test-validate-entity.ts`](../../test/checks/test-validate-entity.ts), covering the **parser**/**validate** domains' classification-derivation rules.
- [`docs/spec/example-instance-tables.md`](../spec/example-instance-tables.md) — named as the "canonical source" by [`skills/noorm-modeling/references/entity-flow.md`](../../skills/noorm-modeling/references/entity-flow.md), coupling this domain to **skill**.
- [`docs/spec/process-flows.md`](../spec/process-flows.md) — its `flow.*` frontmatter/token grammar is matched by [`skills/noorm-modeling/references/flow-templates.md`](../../skills/noorm-modeling/references/flow-templates.md), coupling this domain to **skill**.
- [`docs/guides/themes-and-branding.md`](../guides/themes-and-branding.md) — its worked example is pointed to by [`skills/noorm-modeling/references/model-flow.md`](../../skills/noorm-modeling/references/model-flow.md), coupling this domain to **theme** and **skill**.
- [`docs/design/markdown-driven-erd.md`](../design/markdown-driven-erd.md) has no [`docs/spec/`](../spec) counterpart — [`docs/wiki/feature-map.md`](feature-map.md)'s own "Markdown entity / folder format" row lists the Spec column as `—`.


## Conventions worth knowing


- Design and spec docs are usually paired 1:1 by filename (`docs/design/X.md` ↔ `docs/spec/X.md`) — design states the problem/approach, spec is the checkpoint-and-success-criteria build contract. Seven specs ship without a design-doc counterpart (`derive-classification.md`, `dict-polish.md`, `render-perf-indexing.md`, `unified-app-polish.md`, `dfd-polish-round2/3/4.md` — all follow-up polish/perf batches or a small derivation rule). Exactly one design doc has no spec counterpart of its own: `markdown-driven-erd.md` — no [`docs/spec/`](../spec) file exists for it ([`docs/wiki/feature-map.md`](feature-map.md)'s Spec column reads `—` for the markdown entity/folder format row).
- Specs carry a dated `## Change log` section (see [`docs/spec/key-inheritance-lineage.md`](../spec/key-inheritance-lineage.md)'s 5-entry log) recording corrections and superseded behavior, rather than editing history away silently.
- [`docs/glossary.md`](../glossary.md) is the single canonical abbreviation source; specs, code comments, and UI labels are expected to reuse its terms (DG/DD/DFD/DE/DS/EE) rather than coin new ones.
- [`docs/wiki/`](.) is the generated signals wiki and lives under [`docs/`](..) but is separate, self-referential infrastructure — not part of this domain's content.
