# DFD polish round 2 (CP14–17)


## Goal


Second flow-focused polish batch on `flow-edge-routing`: stop text-selection on DFD nodes, let non-entity stores/externals be colored by `kind` (theme-aware, YAML-overridable), give processes authored in/out data examples rendered as tables in the process dialog, and publish a shared glossary of app terms (DG/DD/DFD/DE/DS/EE) for humans and LLMs.


This is additive — the parse/validate/render/fingerprint/drill-down engine is untouched. Ships commit-only on `flow-edge-routing`, no push/merge.


## Non-goals


- Per-node arbitrary color values. Coloring is **by kind**, mirroring `semanticColors` (one palette entry per kind, overridable globally in `ignatius.yml`). No second per-node color axis.

- Flow example *validation* (`flow.example_unknown_*`). Examples render as authored; a validator rule is deferred (note in process-flows Open questions). Entity `example_unknown_column` is unchanged.

- New CLI subcommands or API routes. All four ride existing surfaces (Flows view, process/store dialogs, theme config, docs).

- Changing the entity `examples:` contract. The process `examples:` shape is *analogous* but separate (nested `in`/`out`).


## Success criteria


- [ ] DFD process/store/external node SVG groups are not text-selectable (computed `user-select: none`); dragging/clicking/ⓘ unaffected.

- [ ] A store with `kind: file` renders the file color in both dark and light; a `kind: cache` renders the cache color; default palette covers `db/cache/queue/file/doc/manual/other` (+ `external`).

- [ ] The kind palette is overridable in `ignatius.yml` under `theme:` (e.g. recolor `cache`) and the override wins in both modes — same merge path as `semanticColors`.

- [ ] An external may carry optional `kind:`; absent → conventional green (no visual regression for existing externals).

- [ ] A process with `examples: { in: [...], out: [...] }` shows, in its dialog, one table per input flow and one per output flow (titled by source/target + label), each with sample rows — after the body, symmetric with the entity examples section.

- [ ] A process without `examples:` renders exactly as today (no empty section).

- [ ] `docs/glossary.md` exists with the 8 canonical terms; DS⊃DE relationship stated; a feature-map row in `CLAUDE.md` links it.

- [ ] `bun run typecheck` zero NEW errors (no `as`/`any`/`!`); `bun run test` green; `bun run build:bundle` ok.

- [ ] Each visual checkpoint has a `test/visual/` check proving the rendered result (light + dark) against `models/key-inherited`.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 14 | No text-select on DFD nodes | `src/flow-view/FlowDiagramSvg.tsx` (node `<g>` class), `src/styles.css` | atomic-surgeon | 2 | computed `user-select: none` on each node-type group; drag/ⓘ still work (visual) |
| 15 | Kind-colored stores/externals (theme-aware, YAML-overridable) | `src/theme-defaults.ts` (new `flowKinds` palette + type + merge), `src/flow-view/FlowDiagramSvg.tsx` (`FlowPalette` + kind→fill), `src/flow-parse.ts` (external optional `kind:`), `src/parse.ts` (merge passthrough), `src/App.tsx` (inject kind palette into renderer), `docs/guides/themes-and-branding.md` | atomic-builder | ~6 | `kind: file` store lime in both modes; YAML override wins; external default green unchanged (visual + parse/merge test) |
| 16 | Per-process in/out data examples | `src/flow-parse.ts` (`FlowProcess.examples` + frontmatter parse), `src/App.tsx` (`FlowNodeModal` process branch → tables), `models/key-inherited/flows/order-to-cash/Collect-Payment.md` (demo examples), `docs/spec/process-flows.md` (contract amend + change-log) | atomic-builder | ~4 | process dialog shows one table per in/out flow w/ rows; absent → no section (parse test + visual) |
| 17 | Shared glossary doc + cross-refs | `docs/glossary.md` (new), `CLAUDE.md` (feature-map row) | atomic-surgeon | 2 | 8 terms present, DS⊃DE noted, feature-map row links it |


## Glossary (CP17 content — canonical)


| Abbr | Term | What it is |
|------|------|------------|
| DG | Data Graph | the ERD graph view (Cytoscape entity diagram) |
| DD | Data Dictionary | the searchable dictionary view |
| DFD | Data Flow Diagram | an SSADM process flow (the Flows view) |
| DE | Data Entity | a modeled entity; appears in a DFD as a `db:` store |
| DS | Data Store | any DFD store — DE-backed (`db:`) or non-entity (`cache`/`file`/`doc`/…) |
| EE | External Entity | a DFD external; a source/sink outside the system boundary |
| Process | — | a numbered transform hub in a DFD |
| Data Flow | — | a labeled arrow; the data moving between nodes |


`DS ⊃ DE`: every `db:`-backed store is also a data entity; non-`db` stores are not. State this explicitly so "store" and "entity" aren't treated as disjoint.


## Process examples authoring shape (CP16 — canonical)


Process frontmatter gains an optional `examples` object with `in` / `out` arrays. Each entry names the counterpart node + the flow label, and carries `rows` (free-form objects, rendered as a small table like entity sample rows):


```yaml
examples:
  in:
    - from: ext:Customer
      label: payment details
      rows:
        - { card: "****4242", amount: 49.99 }
  out:
    - to: db:Payment
      label: settled txn
      rows:
        - { id: 9001, status: captured }
```


Render: in the process dialog, after the body and the existing inputs/outputs IO table, render **one table per `in` entry and one per `out` entry** — table caption = `from`/`to` token + `label`; columns = union of row keys; one row per `rows` element. No `examples` → render nothing extra.


## Kind palette default (CP15 — canonical)


Default `flowKinds` palette (per mode, `{ bg, fg, border }`), overridable under `theme.flowKinds` in `ignatius.yml`. Suggested defaults (builder may tune for contrast, must pass both modes):


| kind | dark bg | light bg | note |
|------|---------|----------|------|
| db | (current store) | (current store) | DE-backed; unchanged from today's store fill |
| cache | amber | light amber | |
| queue | violet | light violet | |
| file | lime | light lime | |
| doc | sky | light sky | |
| manual | rose | light rose | |
| other | slate | light slate | |
| external | (current ext green) | (current ext green) | EE default; only changes if `kind:` set |


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Flow renderer can't reach the entity-model theme (separate payloads) | med | theme mode is already global (`__THEME_MODE__`); inject the resolved kind palette into `FlowDiagramSvg` the same way `__THEME_MODE__` reaches it; builder confirms the wiring before coloring |
| `user-select: none` on the `<g>` also blocks the ⓘ pointer/drag | low | scope to text only (it doesn't block pointer events); visual test asserts drag + ⓘ still fire |
| Process `examples` rows are heterogeneous (different keys per row) | med | columns = union of keys across the entry's rows; blank cell when a row lacks a key (mirror entity examples behavior) |


## Change log


<!-- first amendment after approval logged here -->


## Implementation log


### Shipped — 2026-06-08


Built across 4 checkpoints via the autopilot subagent loop, commit-only on `flow-edge-routing`. Commits (chronological):


- `0dc8dc2` — spec for the round-2 batch
- `2933588` — CP14 no text-select on DFD nodes (`user-select: none` scoped to `[data-ignatius="flow-svg"]`)
- `d86d3c7` — CP15 kind-colored stores/externals (8-kind `defaultFlowKinds` dark+light, `resolveFlowKindPalette`, `mergeTheme` passthrough, external optional `kind:`, renderer wired via `model.theme`, legend shows kinds)
- `760b3b6` — CP16 per-process in/out data example tables (`FlowProcess.examples`, `parseProcessExamples`, dialog tables, process-flows spec amended)
- `9cd99bb` — CP17 glossary (`docs/glossary.md` + CLAUDE.md feature-map rows)
- themes-and-branding guide + this log (folded at finalization)


**Out-of-scope work performed during this build:**

- CP15: updated the in-app `LegendModal` to show the per-kind store palette (a legend must reflect the colors it documents).
- Finalization: documented `theme.flowKinds` in `docs/guides/themes-and-branding.md` (CP15 surface the builder left out).


**Unforeseens — surprises that emerged during implementation:**

- CP15 introduced three prohibited `as` casts. Two (`extKind`/`storeKind` typed `string`) were caught by the reviewer; a third (`Object.keys(flowKinds) as FlowKindKey[]`) the reviewer's diff-focus missed and the orchestrator caught — fixed by deriving `FlowKindKey` from a `FLOW_KIND_KEYS as const` tuple and iterating typed keys.
- CP15: `FlowExternal` gaining optional `kind?` broke the `'kind' in node` discriminant; the renderer now narrows `FlowStoreRef` via `'displayName' in node` (the only union member with a required `displayName`).


**Deferred items still open:**

- Flow example *validation* (`flow.example_unknown_*`) — explicit non-goal this round (process-flows Open questions).
- Pre-existing round-1 follow-ups remain open: `unified-app-polish-stack-entities-dfd`, `unified-app-polish-flow-modal-light-mode`.


**Squashed to `681c942` — 2026-06-09.** The per-checkpoint SHAs in this log are historical — unreachable from any branch after the `flow-edge-routing` branch was squashed to a single commit.
