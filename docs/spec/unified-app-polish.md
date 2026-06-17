# Unified-app polish — chrome, Dictionary, and DFD consistency


## Goal


Close the remaining consistency and feature gaps across the three unified-SPA views (DG = data graph, DD = Dictionary, DFD = flows) found during live verification. Every store/process/external/entity must render with one styled component family; the Dictionary must be searchable-with-highlight, printable, and minimap-free; DFDs must be URL-navigable; and the rich entity dialog must surface process usage everywhere it appears.


This is a polish + small-feature batch on top of the shipped unified app (`docs/spec/unified-app.md`, HEAD `74899cb`). The flow engine (parse/validate/render/fingerprint/persistence/drill-down) stays — this reworks presentation, navigation, and cross-references, plus first-class support for non-entity data stores.


## Non-goals


- Rewriting the flow engine, the Cytoscape ERD, or the DFD SVG renderer.
- Replacing `cytoscape-navigator` with a custom minimap (decided: **match styling only**, keep both renderers).
- A Dictionary document-minimap (decided: **DD has no minimap**).
- Stacking entities in the DFD for real-estate (deferred — see follow-up `unified-app-polish-F-1`).


## Standing constraints (apply to every checkpoint)


- No `as` / `any` / non-null `!` assertions — fix types at the root.
- Bun only (`bun test`, `bun run typecheck`, `bun run build:bundle`).
- **Visual changes MUST be screenshot-verified** via the existing harness (`scripts/screenshot.ts` + `test/visual/`). Never claim a visual change works blind. Durable checks go in `test/visual/`; scratch runs in `tmp/`.
- Themeable: any new color is a CSS custom property that resolves in both light and dark mode. No hardcoded hex in chrome.
- Reuse the shared `<Modal>` primitive and the shared dict section components — do not hand-roll a parallel shell or a one-off style.


## Problem catalog (from live verification 2026-06-07, images referenced)


Subagents cannot see the images — these descriptions are the reference.


- **External (`EXT`) renders its body TWICE — BAD:** in BOTH the DD external section and the DFD external dialog (the `Customer` external), the markdown body is rendered once formatted at the top, then AGAIN as a raw/second copy lower down (visible duplicate of "The buyer who places orders…" + "What Customer does"). This is the primary external defect: a duplicate-body bug PLUS missing the structured header/section chrome.
- **Good entity dialog (target style):** the `Payment` entity dialog shows a classification badge row (`DEPENDENT`, `TRANSACTIONAL`), a PK line, an `ATTRIBUTES` table, a single body, `BUSINESS RULES`, and a `RELATIONSHIPS` table. This is the canonical rich style externals/stores/processes must visually belong to (no duplicate body, structured sections).
- **Process/DFD titles, BAD:** top-level DFD names (e.g. `order-to-cash`, `refund`) and/or process headings show the raw folder/slug form, not a human title.
- **DD entity references not clickable, BAD:** in the DD flat page, resolvable entity references / `[[wiki-links]]` in bodies (e.g. mentions of `Party`, `PaymentMethod`) are not clickable — there is no in-page navigation to the referenced entity's section.


## Checkpoints


Each is one cohesive slice ending in a green test run + screenshot proof. Order is dependency-aware: the shared external/store component (CP4) lands before the surfaces that consume it.


| # | Checkpoint | Files / areas | Agent | Verifies |
|---|------------|---------------|-------|----------|
| 1 | **Minimap parity + DD minimap leak** | `src/flow-view/FlowChrome.tsx` (FlowMinimap), `src/styles.css` (`.minimap`), `src/App.tsx` (DD render path) | atomic-builder | DFD minimap matches DG `.minimap` styling (label, bg, border, radius, viewport box, theme) in both modes; DD shows NO minimap; `test/visual/` side-by-side screenshot of DG vs DFD minimap + DD has none |
| 2 | **FAB menu per-view correctness** | `src/App.tsx` (FAB menu component), `src/flow-view/*` | atomic-surgeon | DD menu has NO "Legend" item and NO minimap toggle (neither applies to DD); the flow nav item is labeled **"Data Flows"** on every view; menu item order consistent across views; `test/visual/` asserts DD menu items by text |
| 3 | **DFD URL navigability** | `src/hash-router.ts`, `src/App.tsx` (initFlowGraph / drill-down swap) | atomic-builder | Selecting a top-level DFD writes a deep-linkable hash (e.g. `#view=flow&dfd=<id>`); loading that URL renders that DFD directly; browser back/forward swaps DFDs; reuses the existing client-side swap (no full reload); sub-DFD drill-down also reflected in the hash; `test/visual/` loads a deep link and asserts the active DFD |
| 4 | **Shared external/store section + dialog (fix duplicate body + restyle)** | `src/App.tsx` (`DictExternalSection`, `DictStoreSection`, `FlowNodeModal`), `src/styles.css` | atomic-builder | The DD external section AND the DFD external/store ⓘ dialog render with the SAME styled component family as entities/processes; **the duplicate-body bug is fixed (body renders exactly ONCE)**; structured header (badge + title) like the entity dialog, no raw second copy; one component, two mount points; `test/visual/` screenshots DD external + DFD external dialog, asserts the body text appears once and styling matches |
| 5 | **Title metadata + titlelize fallback** | `src/flow-parse.ts` (parse `title:`), `src/App.tsx`, `src/flow-view/FlowChrome.tsx`, a titlelize helper | atomic-builder | Top-level DFD names and process/external/store headings show a human title: optional `title:` frontmatter wins; else the slug/folder name is titlelized (`order-to-cash` → "Order To Cash", `Create-Sales-Order` → "Create Sales Order"); applied to DD headings, DFD node labels (keep `D#`/process number prefix), breadcrumb, and the DFD nav card; titlelize helper is pure + unit-tested in `test/checks/` |
| 6 | **Non-entity data stores (files/cache/documents)** | `src/flow-parse.ts`, `src/flow-validate.ts`, `src/App.tsx` (DD stores section), `src/flow-view/*` (DFD store node), `models/key-inherited/stores/` (demo) | atomic-builder | A store whose ref is NOT `db:<entity>` (e.g. `D2 Cache`, a file/document/queue) is first-class: optional `kind:` frontmatter (file/cache/document/queue/other); renders as a Gane-Sarson store in the DFD with its title; appears in a DD **"Data Stores"** section styled like entities (CP4 component), showing kind + markdown; add a demo non-entity store under `stores/` at the model root referenced by a demo DFD so layout is visible + pinnable; `test/visual/` screenshots the store in DFD + DD |
| 7 | **Entity ↔ process cross-reference** | `src/App.tsx` (`SelectedEntityModal`, DD entity section), a usage-index helper | atomic-builder | Compute which processes read/write each entity from the flow model; **DD**: a table after the examples section listing the processes that touch the entity (linked); **rich entity dialog** (`SelectedEntityModal`, wherever it appears — DG nodes AND DFD `db:` stores): a "Processes" section after examples with the same links; helper pure + unit-tested |
| 8 | **DFD process dialog → entity links resolve** | `src/App.tsx` (`FlowNodeModal` / process I/O rendering), resolver | atomic-surgeon | Entity references in a process dialog's I/O (e.g. `db:Payment`) render as entity-links with a populated `data-entity` so a click opens the rich entity dialog (currently the attribute/`data-entity` is missing so they never link out); routes through the existing entity resolver; `test/visual/` clicks a process-dialog entity link and asserts the entity dialog opens |
| 9 | **DD search → DOM highlight** | `src/App.tsx` (DD search), `src/styles.css` | atomic-builder | After a Dictionary search, all matching words are highlighted via the DOM (driven by an effect keyed to the committed search term, NOT React state per-character) — implementation may be `<mark class="dd-search-highlight">` wrapping OR the CSS Custom Highlight API (`CSS.highlights` + `Range` + `::highlight(dd-search-highlight)`), whichever avoids fighting React reconciliation; highlight color is a themeable CSS var (`--dd-search-highlight`, yellow default) resolving in light + dark; clearing the search removes all highlights cleanly; `test/visual/` types a query and asserts matches are visibly highlighted in the themed color (pixel sample or highlight/mark presence) and that clearing removes them |
| 10 | **DD printable again** | `src/styles.css` (print media query), `src/App.tsx` (DD) | atomic-surgeon | `@media print` on the Dictionary expands all sections (search filtering does not hide content from print), hides overlays (FAB, findings, any chrome), and produces a clean printable document as it did before search was added; `test/visual/` (or a print-emulation screenshot) asserts all sections present under print emulation |
| 11 | **DFD subprocess "elevated" affordance** | `src/flow-view/FlowDiagramSvg.tsx` (process node render), `src/styles.css` | atomic-builder | A process that has subprocesses (a sub-DFD) renders "elevated" — a hard drop-shadow / stacked-card look under the node — signaling drill-down, in addition to (or replacing) the bare arrow; themed for both modes; `test/visual/` screenshots a parent process and asserts the elevated treatment vs a leaf process |
| 12 | **DD entity references clickable (in-page nav)** | `src/App.tsx` (DD body rendering, click delegation), `src/parse.ts`/`src/wikilink.ts` (resolved anchors) | atomic-builder | In the DD flat page, resolvable entity references / `[[wiki-links]]` in ANY body (entity, process, external, store) render as in-page anchor links that scroll to that entity's DD section (`#entity-<id>`); unresolved refs keep the missing-link mark; reuses the existing `.entity-link` / `data-entity` machinery (the DD is one page, so a click scrolls rather than opening a dialog); `test/visual/` clicks an entity reference in the DD and asserts the page scrolls to the target section |
| 13 | **External/store parity in DD + DFD dialogs** | `src/App.tsx` (DictExternalSection/DictStoreSection body, FlowNodeModal, flow-opened SelectedEntityModal nav, upgrade pass), `src/styles.css` | atomic-builder | Three connected fixes so non-data-entity nodes (externals, non-db stores) are first-class with data entities: (1) **DD card styling** — external/store section bodies use the same `.dict-entity-body` treatment as data-entity sections (currently `.flow-node-body`, missing the separator/padding), so the cards match. (2) **In-place navigation in the Flows view** — clicking ANY node reference (external/store/process/entity) inside a DFD dialog opens the target's dialog IN PLACE over the flow (via the flow resolver), never yanks to the Dictionary or Graph. This includes references inside a `SelectedEntityModal` opened from the Flows view: its FK/body/process-usage links must navigate in-place within the flow (a flow-context-aware navigation), NOT `setView('dict')`/graph pan as they do in the DD/Graph context. (3) **Consistent link color** — external/store/process references inside flow dialog bodies render the same `.entity-link` color as `db:` entity references (run the `upgradeMissingLinksInContainer` pass inside FlowNodeModal and the flow-opened SelectedEntityModal bodies; today they stay `.entity-link--missing` muted because the upgrade only runs in the DD). `test/visual/` proves: DD external/store body matches entity body styling; clicking an external/process reference in a DFD dialog opens it in place (hash stays on flow, no view switch); db: vs ext: links in a flow dialog share one color. |


## Decisions baked in (do not re-litigate)


- Minimaps: **match styling only**, keep both renderers (DG = cytoscape-navigator, DFD = custom SVG). DD has no minimap.
- Titles: `title:` frontmatter overrides; otherwise titlelize the slug/folder. DFD top-level names titlelize from the folder name (optional `title:` via a folder index supported but not required for the demo).
- Non-entity stores: `kind:` frontmatter is optional metadata; absence is fine (defaults to "other"). A `db:`-prefixed store stays an entity (rich dialog); everything else is a plain store (markdown + kind, CP4 component).
- Menu label: "Flows" → **"Data Flows"** everywhere.
- Process usage (CP7) is derived from `inputs`/`outputs` `from:`/`to:` refs resolving to `db:<entity>` — both directions count as "uses".


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| DOM highlight (CP9) fights React reconciliation (marks wiped on re-render) | med | Apply marks in a layout effect keyed to the committed search term over already-rendered, keep-mounted DD nodes; remove marks before re-applying; never mutate React-owned text nodes structurally beyond wrapping/unwrapping |
| Hash schema (CP3) collides with existing `#view=`/entity/zoom hash | med | Extend `hash-router.ts` parse/serialize with a `dfd` field; keep existing fields working; add a unit test for round-trip |
| Non-entity stores (CP6) ripple into flow-validate balancing rules | med | Treat plain stores exactly as existing stores in validation; only add the `kind:`/title metadata + DD section; pin with the existing `broken-demo`/`key-inherited` finding-count tests (update counts if a demo store adds findings) |
| Visual checkpoints pass selector-asserts but stay inconsistent | high | Every visual check asserts computed style / pixel sample / text, not just element presence (the CP10-series lesson) |


## Verification (per checkpoint, before declaring green)


- `bun run typecheck` (no new errors; no `as`/`any`/`!`)
- `bun run test` (all `test/checks/*.ts` green; update finding-count pins if a demo store changes them)
- `bun run build:bundle` (bundle builds; the served SPA reflects the change)
- The checkpoint's `test/visual/` screenshot inspected — not just run.


## Change log


### 2026-06-08 — CP9 highlight mechanism left to implementer

**What changed:** CP9's Verifies column no longer mandates `<mark class="dd-search-highlight">` wrapping. It
now requires DOM-driven, effect-keyed highlighting of search matches (themeable `--dd-search-highlight`,
yellow default, clears cleanly) and explicitly permits either `<mark>` wrapping OR the CSS Custom Highlight
API, whichever avoids fighting React reconciliation.

**Why:** wrapping React-owned text nodes in `<mark>` risks reconciliation conflicts (Risks table). The
behavior (highlight matches, themeable, DOM-driven, clears cleanly) is the contract; the mechanism is an
implementation choice.

**Superseded:** the prior contract that prescribed `<mark>` wrapping specifically.


### 2026-06-08 — CP13: external/store parity in DD + DFD dialogs


**What changed:** Added CP13. Externals and non-db stores were second-class vs data entities: their DD card
body used `.flow-node-body` (no separator) instead of `.dict-entity-body`; references to them inside flow
dialogs rendered muted (`.entity-link--missing`) because the upgrade pass only ran in the DD; and a
`SelectedEntityModal` opened from the Flows view navigated references via the DD/Graph path (`setView('dict')`,
graph pan) instead of opening targets in place over the flow.

**Why:** User feedback after the 12-CP batch — "you missed styling non-data entity displays in the DD"; "when
you click on an ext. ent. it takes you to the DD instead of rendering it in place like data entities"; "a
discrepancy in the link color." Reproduced: DD external body = `.flow-node-body` vs entity `.dict-entity-body`;
ext: refs in flow dialogs = `.entity-link--missing` (muted) vs db: = `.entity-link`; the flow-opened rich
dialog routes process/FK links out of the Flows view.


## Implementation log


### shipped — 2026-06-08 (autopilot, commit-only on flow-edge-routing)


Built across 12 checkpoints via the autopilot subagent loop (implement → review → screenshot-verify →
commit per green). Every reviewer finding (🔴/🟡/🔵) addressed in-iteration; scratchpad FOLLOWUPS empty.
Commits (chronological):

- `15a6dbc` — CP1 minimap parity + stop the DG minimap leaking onto the Dictionary
- `768b5fe` — CP2 FAB menu per view (no Legend/minimap on dict; "Flows" → "Data Flows"; consistent order)
- `d55fd03` — CP3 DFD URL navigability (`#view=flow&dfd=<id>`, deep-link + back/forward + drill-down)
- `3322f77` — CP4 external/store body renders once + restyled to the shared card family
- `7d99e31` — CP5 human DFD/process titles (titlelize fallback + `title:` override; resolver keyed by id)
- `9c775a1` — CP6 first-class non-entity data stores (kind:, DFD node, DD Data Stores section, demo store)
- `90385dc` — CP7 entity ↔ process cross-reference (DD table + rich-dialog Processes section)
- `b0022bd` — CP8 process dialog entity links open the rich entity dialog
- `ddd3629` — CP9 Dictionary search highlight via the CSS Custom Highlight API (themeable)
- `3e1d375` — CP10 restore Dictionary printing (print CSS + beforeprint filter-clear)
- `b3fc79b` — CP11 elevated affordance (stacked shadow) on processes with a sub-DFD
- `b86d0b5` — CP12 Dictionary body references clickable across all sections (shared resolveBodyClick)

**Out-of-scope work performed during this build:**
- CP5 keyed the flow doc resolver (`externalById`) by stable id, not display label, so a `title:` override
  never breaks `[[Entity]]`/`ext:` resolution. Necessary for the title feature to be safe.
- CP6 backfilled `displayName` on flow test fixtures (cleared pre-existing typecheck errors).

**Unforeseens — surprises that emerged during implementation:**
- The "DD minimap leak" was a real bug: `#minimap-panel` rendered on `!isFlowSurface`, true on the dict view
  too (fixed in CP1 by gating on `view === 'graph'`).
- CP3 introduced and then corrected a history-pollution bug (initial flow render must `replaceState`, not
  `pushState`) and a sub-DFD back-nav gap (added `selectDiagramById` rebuilding the breadcrumb stack).
- CP9: the app applied the light highlight color correctly; the bug was a visual test bypassing the React
  theme toggle (false positive) — fixed the test to flip theme through the real control.
- CP12's iteration-2 builder died on an API socket error mid-run; its partial work was intact in the tree
  and finished in iteration 3 with click-time missing-span resolution (timing-independent) + one shared
  `resolveBodyClick` helper.

**Deferred items still open (durable follow-ups):**
- `unified-app-polish-stack-entities-dfd` — stack entities in the DFD to reclaim canvas real-estate
  (user-deferred, out of scope).
- `unified-app-polish-flow-modal-light-mode` — dialogs opened from the Flows view may render dark in light
  mode (pre-existing, discovered during CP8 review; needs a dedicated light-mode pass).

**Decided/kept:** minimaps match styling only (both renderers kept); DD has no minimap.


### post-batch fix — 2026-06-08


- `0a38a44` — CP3 follow-up: sub-DFD deep links now survive refresh (shareable). User reported drilling into a
  sub-DFD then refreshing reset to the parent. The flow init resolved only top-level start ids; it now uses
  `findDiagramPath` to resolve top-level OR nested ids and rebuilds the full breadcrumb stack. CP3 visual test
  gained cases G (sub-DFD deep-link renders directly) and G2 (survives `page.reload()`).
- `c9a2cd4` — CP13: external/store parity in the DD + DFD dialogs. User feedback: externals/stores were
  second-class. (1) DD EXT/FILE card bodies now use `.dict-entity-body` (matched data-entity cards);
  (2) flow-context-aware navigation — refs clicked in a DFD dialog (incl. a flow-opened entity dialog's FK/
  body/process links) open in place over the flow instead of jumping to the DD/graph (`fromFlow` flag, reset
  on close; graph/DD contexts unchanged); (3) the missing-link upgrade pass runs in FlowNodeModal + flow-opened
  entity dialog bodies so ext/store/process refs share the `.entity-link` color. Reviewer confirmed no CP7/CP8/
  CP12 regression. `test/visual/test-cp13-external-store-parity.ts`.


**Squashed to `681c942` — 2026-06-09.** The per-checkpoint SHAs in this log are historical — unreachable from any branch after the `flow-edge-routing` branch was squashed to a single commit.
