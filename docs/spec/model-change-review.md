# Spec: Model change review


## Goal


`ignatius serve` highlights what changed in a model since the last approval, and `ignatius export` bakes the same review into the static page. ignatius diffs the parsed model and flows against a stored baseline; agent-written change notes explain the changes; the two are cross-checked. The graph, Dictionary, and Flow views mark added, changed, and removed items, a Changes panel lists them with their notes, and `ignatius approve` (or the panel's Approve button) accepts the current state as the new baseline.


## Approach


Hybrid diff plus change notes, stored in a per-model `.ignatius/` folder, per `docs/design/model-change-review.md`.


## Non-goals


- No git integration. The baseline is a file ignatius writes.
- No diff in `validate`. `ignatius export` bakes in the review of an existing baseline (SC14) but never creates or approves one.
- No ghost rendering of removed flow nodes on the DFD canvas. Removed flow nodes appear only in the Changes panel.
- No reject/revert command. Reverting is done by editing the files back and deleting or editing the note; the note's names otherwise stay listed as claimed but unchanged.
- No layout changes: highlights never move nodes and never write `layout-store` positions or the layout fingerprint.
- Change notes and the baseline are never parsed as model files and never committed.


## On-disk contract


```
<model>/
    ignatius.yml
    .gitignore                 contains the line `.ignatius/`
    .ignatius/
        baseline.json          { "version": 1, "model": Model, "flows": FlowDiagram[] }
        changes/
            <slug>.md          one note per edit session
```

Change note format:

```markdown
---
title: Split invoice lines out of Invoice
entities:
  Invoice: [line_total]        # changed entity: the columns touched
  InvoiceLine: []              # added or removed entity: columns optional
flows:
  order-to-cash: [bill-customer]   # diagram id: process/external/store ids touched
---

Why the change was made, written for the reviewer.
```

`entities` maps entity id to a column-name list. `flows` maps `FlowDiagram.id` to a list of node ids (`FlowProcess.id`, `FlowExternal.id`, `FlowStoreRef.name`). Both keys are optional. A note whose frontmatter fails to parse is reported as a note error in the review and is otherwise ignored.


## Coverage rules


A note **covers** a change item when:

| Item scope | Covered by |
|------------|-----------|
| `entity` (added, removed, or any SC1 entity field changed) | note names the entity |
| `column` | note names the entity and lists the column |
| `relationship` | note names the source or the target entity |
| `doc` (body-only change) | note names the entity |
| `flow` diagram added/removed | note names the diagram |
| `flow` node added/removed/changed | note names the diagram and lists the node |

A note **claim** is unchanged when it names an entity with no item for that entity, a column with no `column` item, a diagram with no `flow` item, or a node with no `flow` item for that node.


## Success criteria


- SC1 — `diffSnapshots(baseline, current)` returns one item per semantic difference: entity added/removed/changed (fields: `pk`, `ak`, `classification`, `group`, `description`, `examples`, `singleton`, `subtypes`; PK and AK compare as sets, `subtypes` is the basetype's subtype clusters with members compared as sets); column added/removed/changed (fields: `type`, `nullable`, `default`, `desc`); relationship added/removed/changed (fields: `identifying`, `on`, `predicate`, `cardinality`), keyed by source+target plus `on` when a pair has more than one edge; body-only change as a `doc` item; flow diagram added/removed and process/external/store added/removed/changed. A removed column item carries the baseline `ColumnDef` as `def`. Stores are keyed by `kind:name` and store items carry `storeKind`; flow endpoints compare by resolved `kind:name`, not raw text. Diagrams in `SYNTHETIC_DIAGRAM_IDS` (`__context__`, `__system__`) are derived from the leaf diagrams and produce no items. Diagrams are keyed by their ancestor path (`parent/child`), and each flow item carries both `diagram` (the `FlowDiagram.id`, which notes name) and `diagramPath`. Reordering YAML keys, columns, or key members produces no item.
- SC2 — `crossCheck(items, notes, baseline)` takes raw `parseChangeNote` results, marks every item `explained` (with the covering note files) or `unexplained`, lists every unchanged claim per the coverage rules, splits parse failures into `noteErrors`, and fills `removedNodes`/`removedEdges` from the baseline model.
- SC3 — `serve` writes `.ignatius/baseline.json` from the current parse when it is absent, at startup and on any `/api/model` request that finds it missing. Creating `.ignatius/` ensures `<model>/.gitignore` contains a `.ignatius/` line: the file is created when absent, the line appended when missing, and an existing line never duplicated.
- SC4 — `/api/model` returns a `diff` field: `{ items, claims, notes, noteErrors, removedNodes, removedEdges }`. `notes` carries each note's file name, title, entities, flows, and rendered body HTML. `removedNodes`/`removedEdges` carry the baseline's `ModelNode`/`ModelEdge` for each removed entity/relationship. Existing payload keys are unchanged. When the review cannot be built (unwritable model folder, unreadable notes), `diff` is `null`, the error is logged, and the rest of the payload is served unchanged. A baseline that does not parse or lacks `version: 1`, an object `model`, and an array `flows` is treated as missing and rewritten.
- SC5 — Editing an entity file or a change note while serving triggers the existing `model-changed` SSE event, and the refetched `diff` reflects the edit.
- SC6 — `ignatius approve [path] [--model <key>]` writes the current parse as the baseline and deletes every file in `.ignatius/changes/`, then prints what it approved (item and note counts) and exits 0. It resolves the model with `pickModel` like the other commands. `POST /api/approve` in serve does the same and broadcasts `model-changed`. It answers 403 to a cross-origin request (`Sec-Fetch-Site` other than `same-origin`, or an `Origin` whose host differs from `Host`) and to a `Host` that is not `localhost` or an IP literal. After either, `/api/model` returns an empty `items` list.
- SC7 — Graph view: nodes carry `change` data (`added` / `changed` / `removed`) and an `unexplained` flag; edges carry `change` data. Marks are glows, never an `outline-*` or a node underlay: a node glow is a blurred shape drawn on a canvas behind cytoscape's canvases, sized from the node's rendered bounds so it holds at any zoom, with the same blur and spread as the flow glow (`GLOW_BLUR`, `GLOW_SPREAD`) scaled by zoom and clipped to the outside of the node, so no tint lands inside it; nodes whose glow falls outside the viewport are not drawn; the canvas takes no pointer events and is removed with the graph. An edge glow is a thin cytoscape underlay along the line, whose line also takes the color. Green marks added, amber changed. Removed entities render as ghost nodes (dashed border, reduced opacity, muted glow, and a red ✕ badge at the top-right corner drawn on a canvas above cytoscape at full opacity, dimmed only by the hover, lineage, and search tiers, scaled with zoom within a legible range) built from `removedNodes`, and removed relationships as dashed edges with a muted glow from `removedEdges`. A column-only or doc-only change marks its entity as changed. Glows pulse from one shared animation-frame loop (a 1.8s cycle shared with the flow glow, opacity never below 0.35) that scales each glow by its element's effective opacity, so hover, lineage, and search dimming dim it too; the loop stops when the overlay is off, there are no marks, or the graph is torn down. An unexplained item's glow alternates between its kind color and red on successive pulses, with red held for most of the cycle. Under `prefers-reduced-motion: reduce` (re-read when the setting changes), or when the graph is over `ANIMATION_ELEMENT_LIMIT`, glows hold steady at the pulse midpoint, and an unexplained glow holds a blend leaning toward red. Colors read in both light and dark themes.
- SC8 — Dictionary view: an entity card with change items shows a change badge; column rows show added/changed markers; removed columns render as struck-through rows from the baseline. Removed column markers use `REMOVED_RED` and the removed badge text uses `REMOVED_TEXT` (SC10); the badge stays at full opacity while the rest of its removed card, frame included, is dimmed. Removed entities render in a "Removed since approval" section of the read lens, filtered by the Dictionary search; the browse lens shows a link to it. A body comparison ignores whether a wiki-link target exists, so adding or removing an entity never marks the bodies that link to it.
- SC9 — Flow view: process, external, and store nodes named by a `flow` item render with a blurred glow behind them on the diagram that owns them, green for added and amber for changed, with no stroke outline and `pointer-events: none`. On a newly added diagram, every node glows `added`, unexplained when the diagram's item is. The glow pulses through CSS keyframes on the same 1.8s cycle as the graph glow. An unexplained node stacks a red glow layer under its kind-color layer, and the two swap on successive pulses, matching the graph; the red layer never falls below half strength. Under `prefers-reduced-motion: reduce`, or when the diagram is over `ANIMATION_ELEMENT_LIMIT` (the SVG carries `data-motion="off"`), both layers hold steady and the red layer shows as a ring outside the kind color.
  The flow index and the breadcrumb level menus mark their rows the same way. A row is marked by the item for its process in the parent diagram, by a diagram item for the diagram it opens, or by the item adding the diagram that holds it, so every row inside a new diagram is marked `added` with that item's unexplained status. A marked index row's pill glows with the same layers, colors, keyframes, and cycle as a flow node, drawn as CSS `box-shadow`. A marked level menu row instead shows a glowing dot after its label that pulses the same way. A row whose own diagram, or any diagram below it, holds other items shows a static dot after its label: red when any of them is unexplained, else amber when any is not an addition, else green. A marked level menu row shows only its pulsing dot. Removed processes and diagrams have no row; only the Changes panel lists them. Hovering or focusing a marked index row adds a one-line summary under the side pane's title (`Changed: label, outputs · unexplained`). Reduced motion holds row glows and pulsing dots steady; the overlay toggle and a null `diff` (an export with no baseline, or a review the server could not build) remove every row mark.
- SC10 — Changes panel (hidden when the diff has no items, claims, notes, or note errors): lists each note (title, rendered body, the items it covers), then unexplained items, then unchanged claims, then note errors. Clicking an entity item navigates the graph to it (ghost nodes included); clicking a flow item opens its diagram. A removed item's row reads as a warning: a solid left bar and a red-circle ✕ before the label in `REMOVED_RED` (the ghost ✕ badge's red, `--change-removed`), and the word `removed` in `REMOVED_TEXT` (`--change-removed-text`: the same red in light mode, `#f87171` in dark, where `#dc2626` text falls under 4.5:1). The panel has an overlay toggle that removes every change class and ghost element without refetching, and, in live mode only, an Approve button that calls `POST /api/approve`. It never overlaps the Findings panel.
- SC11 — The modeling skill instructs the agent to write one `.ignatius/changes/<slug>.md` note per edit session, with column-level `entities:` and node-level `flows:` frontmatter, and to create `<model>/.gitignore` with `.ignatius/` for every model it generates. Before its first write to a model with no valid baseline, the skill runs `ignatius approve` when `.ignatius/changes/` is empty, and stops and asks the user when notes exist; a session that bootstraps a model runs `approve` after the bootstrap writes. `test-skill-no-repo-paths` stays green.
- SC12 — Docs: a guide page for change review, a `commands.md` row for `approve`, and the folder-format guide lists `.ignatius/` and the model `.gitignore`.
- SC13 — Every check in `test/checks/` that passed before this change still passes, the new checks pass, and `bunx tsc --noEmit` reports no new error kinds in files this change adds or modifies (the unresolved-cytoscape `Core`/namespace errors already present in the repo's checks are the one tolerated kind).
- SC14 — Static export: when the model has a stored baseline, `ignatius export` embeds the change review as `window.__CHANGE_REVIEW__`, and the static page shows the same glows, ghost nodes, and Changes panel, minus the Approve button. With no baseline the export carries no review. A review that cannot be built (unreadable note, unreadable baseline) exports without it and prints `ignatius: could not build the change review: <reason>` to stderr. Export never writes `.ignatius/` or `.gitignore`. Every injected JSON payload escapes `<` so note titles and descriptions cannot close or reopen the script.


## Checkpoints


| # | Checkpoint | Files/areas | Verifies |
|---|------------|-------------|----------|
| CP1 | Pure diff and cross-check: snapshot type, `diffSnapshots`, `parseChangeNote`, `crossCheck` | `src/model/change-review.ts`, `test/checks/test-change-review.ts` | SC1, SC2 on in-memory fixtures, including a key-reorder no-op and every coverage row |
| CP2 | Storage, server, CLI: baseline read/write, `.gitignore` ensure, note loading, `approve`, `/api/model` `diff`, `POST /api/approve`, `approve` subcommand | `src/model/change-store.ts`, `src/server/server.ts`, `src/cli/cli.ts`, `test/checks/test-change-review-serve.ts` | SC3–SC6 against a temp copy of `models/key-inherited` |
| CP3 | Graph highlights and Changes panel: `useModelData` exposes `diff`, GraphView change data + ghost elements, styles, `ChangesPanel`, overlay toggle, approve button | `src/app/hooks/useModelData.ts`, `src/app/views/graph/GraphView.tsx`, `src/app/views/graph/styles.ts`, `src/app/components/changes/ChangesPanel.tsx`, `src/app/App.tsx`, `src/app/styles.css`, `test/checks/test-change-review-graph.ts` | SC7, SC10 in a Playwright check against a served temp model with an edit and a note |
| CP4 | Dictionary and Flow highlights | `src/app/views/dict/DictionaryView.tsx`, `src/app/components/entity/ColumnsTable.tsx`, `src/app/components/entity/{EntityCard,GridCard,EntityModal}.tsx`, `src/app/components/changes/ChangeBadge.tsx`, `src/app/logic/change-marks.ts`, `src/app/components/changes/ChangesPanel.tsx` (flow labels), `src/app/App.tsx`, `src/app/views/graph/GraphView.tsx` (shared marks), `src/app/hooks/useModelData.ts`, `src/model/change-review.ts` (`def`, `storeKind`), `test/checks/test-change-review.ts`, `test/checks/test-change-review-graph.ts`, `src/app/views/flow/FlowsView.tsx`, `src/flow-view/FlowDiagramSvg.tsx`, `src/flow-view/FlowChrome.tsx`, `src/flow-view/FlowIndex.tsx`, `src/flow-view/LevelMenu.tsx`, `src/app/dom/theme-css-vars.ts`, `src/app/styles.css`, `test/checks/test-change-review-dict-flow.ts`, `test/checks/test-change-review-flow-index.ts` | SC8, SC9 in Playwright checks |
| CP5 | Skill and docs | `skills/ignatius-modeling/SKILL.md`, `skills/ignatius-modeling/references/change-notes.md`, `skills/ignatius-modeling/references/model-flow.md`, `skills/ignatius-modeling/references/verification.md`, `docs/guides/change-review.md`, `docs/guides/commands.md`, `docs/guides/folder-format.md` | SC11, SC12 |
| CP6 | Static export: `readReview`, `window.__CHANGE_REVIEW__` injection, read-only panel, hostile-title escaping | `src/model/change-store.ts`, `src/generators/app.ts`, `src/cli/cli.ts`, `src/app/globals.d.ts`, `src/app/hooks/useModelData.ts`, `src/app/components/changes/ChangesPanel.tsx`, `test/checks/test-export-change-review.ts` | SC14 |


## Change tree


```
A src/model/change-review.ts                    snapshot type, diffSnapshots, parseChangeNote, crossCheck
A src/model/change-store.ts                     .ignatius/ I/O: baseline, notes, gitignore, approve
M src/server/server.ts                          baseline on start, diff in /api/model, POST /api/approve
M src/cli/cli.ts                                approve subcommand; export passes readReview to generateApp
M src/generators/app.ts                         inject window.__CHANGE_REVIEW__; escape < in every payload
M src/app/globals.d.ts                          __CHANGE_REVIEW__ global
A test/checks/test-export-change-review.ts      export carries the review, read-only, never writes .ignatius/
M src/app/hooks/useModelData.ts                 expose diff
M src/app/views/graph/GraphView.tsx             change data on elements, ghost nodes/edges
M src/app/views/graph/styles.ts                 steady edge glows, dimmed-tier edge glows
A src/app/views/graph/change-glow.ts            glow and ghost-badge canvases, pulse loop, glow colors
A src/app/components/changes/ChangesPanel.tsx   notes, unexplained, claims, toggle, approve
M src/app/App.tsx                               panel mount, toggle state, navigation
M src/app/views/dict/DictionaryView.tsx         entity change badge
M src/app/components/entity/ColumnsTable.tsx    column markers, removed rows
A src/app/components/changes/ChangeBadge.tsx    added/changed/removed + unexplained badge
M src/app/components/entity/EntityCard.tsx      change badge
M src/app/components/entity/GridCard.tsx        change badge
M src/app/components/entity/EntityModal.tsx     change badge
A src/app/logic/change-marks.ts                 shared per-entity and per-flow-node marks, glow geometry
M src/app/views/flow/FlowsView.tsx              pass flow change ids and the review to FlowChrome
M src/flow-view/FlowDiagramSvg.tsx              node highlight
M src/flow-view/FlowChrome.tsx                  review to the index and level menus
M src/flow-view/FlowIndex.tsx                   row glows, ancestor dots, pane summary
M src/flow-view/LevelMenu.tsx                   pulsing and static dots
M src/app/styles.css                            panel and marker styles
M src/app/dom/theme-css-vars.ts                 CHANGE_COLORS, REMOVED_RED, REMOVED_TEXT single source
M src/app/components/findings/FindingsPanel.tsx shared side-panel chrome
M src/app/components/ui/Modal.tsx               stacked backdrop click note for portaled dialogs
M src/app/components/ui/JsonValue.tsx           dialog portaled to document.body, above the findings banner
M src/app/views/graph/layout-store.ts           lastPosition read for ghost placement
M src/app/views/graph/organic-layout.ts         gradeEdgeSpans takes an edge collection
M test/checks/test-layout-store.ts
A models/*/.gitignore, test/fixtures/*/.gitignore   `.ignatius/`
M package.json                                  test script clears in-place review state
A scripts/clear-review-state.ts                removes models/*/.ignatius and test/fixtures/*/.ignatius
M src/model/wikilink.ts                         linkStateNeutral for body comparison
A test/checks/test-change-review.ts
A test/checks/test-change-review-serve.ts
A test/checks/test-change-review-graph.ts
A test/checks/test-change-review-dict-flow.ts
A test/checks/test-change-review-flow-index.ts
A test/checks/test-modal-above-banner.ts
A test/visual/screenshot-change-glow.ts         glow captures per theme and motion setting
M skills/ignatius-modeling/SKILL.md             core rule: change notes + model .gitignore
A skills/ignatius-modeling/references/change-notes.md
M skills/ignatius-modeling/references/model-flow.md
M skills/ignatius-modeling/references/verification.md
M skills/ignatius-modeling/references/dfd-authoring.md      approve after bootstrap pointer
M skills/ignatius-modeling/references/discover-flow.md      approve after bootstrap pointer
M skills/ignatius-modeling/references/reverse-engineering.md approve after bootstrap pointer
M docs/guides/getting-started.md
M docs/guides/modeling-skill.md
M README.md
M docs/wiki/feature-map.md
A docs/guides/change-review.md
M docs/guides/commands.md
M docs/guides/folder-format.md
```


## Outline


```
src/model/change-review.ts
    ModelSnapshot — { version: 1, model, flows }
    ChangeItem — tagged union by scope: entity, column, relationship, doc, flow
    ChangeNote — file, title, entities map, flows map, bodyHtml
    ChangeReview — items with status, claims, notes, noteErrors, removedNodes, removedEdges
    diffSnapshots — baseline vs current → ChangeItem[]
    parseChangeNote — note file text → ChangeNote or error
    crossCheck — items + notes + baseline → ChangeReview
src/model/change-store.ts
    readBaseline — load or null
    writeBaseline — snapshot current parse, ensure .ignatius/ and .gitignore
    ensureGitignore — create or append the .ignatius/ line
    loadNotes — read .ignatius/changes/*.md
    buildReview — parse current, load baseline (create if absent), diff, cross-check
    readReview — export's read-only review: null without a stored baseline, never writes
    approve — write baseline, delete notes, return counts
src/server/server.ts
    serveCommand — create baseline at start; diff in /api/model; POST /api/approve; poll baseline.json mtime so a CLI approve refreshes tabs
src/model/wikilink.ts
    linkStateNeutral — body HTML with wiki-link target existence erased, for comparison
scripts/clear-review-state.ts
    clear — remove in-place review state from repo models and fixtures before checks
src/cli/cli.ts
    approveCmd — resolve model, approve, print counts
src/app/components/changes/ChangesPanel.tsx
    ChangesPanel — notes, unexplained, claims, note errors, overlay toggle, approve
src/app/views/graph/GraphView.tsx
    element build — change data, ghost nodes and edges when overlay on
src/app/views/graph/styles.ts
    change selectors — steady edge glow per kind, unexplained blend, ghost styling, dimmed-tier edge glow
src/app/views/graph/change-glow.ts
    glowColors — kind, muted, and red glow colors per theme mode
    createChangeGlow — glow canvas behind cytoscape, ghost-badge canvas above it, one animation-frame loop over marked elements
        refresh — re-read marks; pulse only when motion is allowed
        destroy — cancel the loop and remove both canvases
src/app/components/entity/ColumnsTable.tsx
    column markers — added/changed markers, removed rows
src/app/logic/change-marks.ts
    entityChanges — per-entity mark from review items
    flowNodeMarks — per-node marks for one diagram path
    flowRowChanges — a flow index or level menu row's mark, changed fields, and worst change inside
    GLOW_BLUR, GLOW_SPREAD — glow blur and spread shared by graph and flow
src/app/components/changes/ChangeBadge.tsx
    ChangeBadge — added/changed/removed label with unexplained marker
    ChangeDot — static "contains changes" dot in the worst change's color, or a pulsing dot for a row's own mark
src/flow-view/FlowDiagramSvg.tsx
    ChangeGlow — blurred kind-color layer, red layer when unexplained
    flow-svg root — data-motion="off" over the animation limit
src/flow-view/FlowIndex.tsx
    row marks — glow and dot per row
    pane change summary — kind, changed fields, unexplained
src/flow-view/LevelMenu.tsx
    row marks — one dot per entry: pulsing for its own mark, else static
src/flow-view/FlowChrome.tsx
    changeReview prop — passed to the index and level menus
skills/ignatius-modeling/references/change-notes.md
    when to write a note — per edit session
    note format — frontmatter and body
    model .gitignore — the .ignatius/ line
docs/guides/change-review.md
    what it shows
    lifecycle
    note format
    approve
```


## Flows


**First serve**

1. User runs `ignatius serve`.
2. Server finds no `.ignatius/baseline.json`, writes it from the current parse, and ensures `<model>/.gitignore` lists `.ignatius/`.
3. `/api/model` returns `diff.items: []`; no highlights, no Changes panel.

**Export**

1. User or agent runs `ignatius export -o model.html`.
2. Export loads the stored baseline without writing one; none, or an unreadable one, means no review.
3. With a baseline, `generateApp` embeds the review as `window.__CHANGE_REVIEW__`; the page shows the marks and Changes panel without Approve.

**Agent edit under review**

1. Agent edits `data/billing/Invoice.md` (adds `line_total`) and writes `.ignatius/changes/split-invoice-lines.md`.
2. The watcher broadcasts `model-changed`; the client refetches `/api/model`.
3. Server diffs baseline vs current and cross-checks against the note.
4. Graph marks `Invoice` changed; Dictionary marks the `line_total` row added; the Changes panel shows the note with its covered item.

**Unexplained and unchanged**

1. Agent also edits `Customer.md` without naming it in a note, and names `Payment` though it did not change it.
2. Changes panel lists the `Customer` item under unexplained and the `Payment` claim under claimed but unchanged.

**Approve**

1. User runs `ignatius approve` or clicks Approve.
2. Baseline is rewritten from the current parse; `.ignatius/changes/*.md` are deleted.
3. Serve broadcasts `model-changed` (the Approve button directly; a CLI `approve` through a stat poll on `.ignatius/baseline.json`, started after serve's own startup write); highlights and the panel clear.


## Risks


- Baseline written by a newer ignatius with a changed `Model` shape: a diff of mismatched shapes produces noise. `version: 1` lets a future change detect and rebuild it.
- Deleting notes on approve removes the only copy of the agent's explanation. Accepted: notes are review state, and the user approves after reading them.
- Ghost nodes enter cytoscape layout. They must be excluded from saved positions and the layout fingerprint, or approving would shift the layout.


## Change log


### 2026-10-11 — Static export carries the review; louder glows

**What changed:** SC14 adds the review to `ignatius export`, and SC10 hides Approve in static mode. SC7 and SC9 shorten the pulse cycle to 1.8s and weight red longer in the unexplained cycle. The change colors are more saturated.

**Why:** Agents hand over exported HTML, which showed no changes, so the reviewer could not see what an edit touched. The first palette and pace read as too faint in use.

**Superseded:** `export` rendered no highlights and no Changes panel; SC10's panel was live-only; the glow cycle was 3.6s with equal kind and red layers; the added and changed colors were `#22c55e`/`#f59e0b` (dark) and `#15803d`/`#d97706` (light), now split into glow colors and text colors.

### 2026-10-10 — A new diagram marks everything inside it

**What changed:** SC9 marks every row inside a newly added diagram, and every node on its canvas, `added` with the diagram item's unexplained status. The Dictionary's removed-marker rules move from SC10 to SC8. The CP4 row and change tree list the flow index files and the modal fix.

**Why:** The final audit found leaf rows in a new diagram unmarked while their decomposed siblings glowed, and a new diagram's canvas drew no glows.

**Superseded:** only a row's own process item or the diagram it opens marked it, and a new diagram's canvas drew no glows.

### 2026-10-10 — Removed items read as warnings

**What changed:** SC10 gives removed rows in the Changes panel a solid red bar, a red ✕, and a red `removed`; the Dictionary's removed badge and column markers take the same red, which the ghost badge now reads from `REMOVED_RED` in `theme-css-vars.ts`. Text uses `REMOVED_TEXT`, lighter in dark mode for contrast. A removed card dims its frame and content but not its badge.

**Why:** User asked for removals to read as warnings; the dashed grey bar read as inactive.

**Superseded:** removed rows had a dashed grey bar, and the Dictionary removed badge was dashed and muted.

### 2026-10-10 — Change marks in the flow index and level menus

**What changed:** SC9 extends to the flow index and the breadcrumb level menus: a row named by a process or diagram item glows like a flow node (a level menu row as a pulsing dot), an ancestor of changes shows a static dot colored by the worst of them, and the index pane summarizes a marked row's change. The outline and change tree add `flowRowChanges`, `ChangeDot`, the three flow-view components, and the new check.

**Why:** User found no change marks in the process hierarchy, which is how a reviewer finds a changed process in a deep tree.

### 2026-10-10 — Pulsing glows replace outlines

**What changed:** SC7 and SC9 draw change marks as pulsing glows: blurred shapes on a canvas behind cytoscape for graph nodes and a thin underlay for edges, driven by one shared loop, and a blurred SVG layer animated by CSS keyframes on flow diagrams. Both views share one blur radius and spread, kept tight to the node edge, and one 3.6s pulse cycle; the graph glow is clipped to the outside of its node. Ghost nodes gain a full-opacity red ✕ badge, since the translucent dashed ghost alone read too faintly. Unexplained items alternate their kind color with red. Reduced motion and the animation limit hold glows steady. The change tree and outline add `change-glow.ts` and the glow capture script.

**Why:** User asked for pulsing glows instead of borders. Cytoscape has no blur style, so a node underlay drew a hard-edged frame; node glows moved to a canvas.

**Superseded:** graph nodes carried a 3px `outline-*` in the change color with a red underlay when unexplained; flow nodes carried a stroked outline rect with a red underlay rect.

### 2026-10-09 — Final audit: body comparison, CLI approve refresh, body currency

**What changed:** SC8 records the Removed section and that body comparison ignores wiki-link target existence; SC11 records the skill's approve-before-first-write rule; the Approve flow states how a CLI approve refreshes open tabs; the revert non-goal states the note must go too; the change tree lists every delivered file.

**Why:** The final audit reproduced `doc` items on untouched entities after deleting a linked entity, found CLI approve left open tabs highlighted, and found shipped behaviour missing from the body.

**Correction:** SC13 said "no errors" in touched files; the gate the loop ran and the repo can meet is "no new error kinds", because the browser checks share the repo's pre-existing unresolved cytoscape typings.

### 2026-10-09 — CP5 review: synthetic diagrams produce no items

**What changed:** SC1 excludes the derived `__context__`/`__system__` diagrams from the flow diff.

**Why:** CP5 review reproduced permanent unexplained items under synthetic ids that no note can name and the panel hides.

### 2026-10-09 — CP4: item fields for Dictionary and Flow rendering

**What changed:** SC1 adds `def` (baseline `ColumnDef`) on removed column items and `storeKind` on flow store items. Change tree, outline, and the CP4 row add `change-marks.ts`, `ChangeBadge.tsx`, and the entity card/modal files.

**Why:** The Dictionary draws removed columns from the baseline definition, and the Flow view must not highlight a same-name store of another kind.

### 2026-10-09 — CP2 review: failure isolation and approve origin

**What changed:** SC4 adds `diff: null` when the review cannot be built and the baseline shape check; SC6 adds the approve origin and `Host` rules.

**Why:** CP2 review reproduced a 500 on `/api/model` for a read-only model folder and for a wrong-shape baseline, and showed `POST /api/approve` reachable cross-origin and by DNS rebinding.

### 2026-10-09 — CP1 review: keys and fields

**What changed:** SC1 names the full entity field list (adds `singleton` and `subtypes`), keys stores by `kind:name`, compares flow endpoints by resolved `kind:name`, and keys diagrams by ancestor path with `diagramPath` on flow items. SC2 gives `crossCheck` its third `baseline` argument.

**Why:** CP1 review found store shadowing (`db:x` vs `cache:x`), sub-DFD id collisions across parents, and subtype edits producing no item.

### 2026-10-09 — Initial spec

**What changed:** First version.

**Why:** User asked for a visible "what changed since last approval" in the rendered model after AI edits.


## Implementation log


### follow-up — 2026-10-10

Follow-up rounds on the same PR, squashed into its commit: pulsing glows replace outlines in the graph and flow views, with a red ✕ badge on ghost nodes; change marks in the flow index and level menus; removed items read in warning red; a new diagram marks every row and node inside it.

**Out-of-scope work performed during this build:**

- Modals stack above the global findings banner (`Modal.tsx`, `JsonValue.tsx`, `test-modal-above-banner.ts`). No criterion asks for it; main's CI fails `test-graph-bundle-mode` on the current runner because the banner covers a modal's close button, so this PR could not pass CI without it.

### shipped — 2026-10-09

Built across 5 checkpoints plus one post-audit iteration of /autopilot, squashed into one PR commit. Pre-squash commits (chronological):

- `379b93c` — CP1 diff snapshots and cross-check change notes
- `4ca01eb` — CP2 baseline storage, `/api/model` diff, `POST /api/approve`, `ignatius approve`
- `291d400` — CP3 graph highlights, ghost nodes, Changes panel
- `7991a36` — CP4 Dictionary and Flow highlights
- `029e811` — CP5 skill change notes and guides; derived diagrams excluded from the flow diff
- `5ec4386` — feature-map row
- `805b385` — post-audit: link-state-neutral body diff, CLI approve refresh via stat poll, dual-FK labels

**Out-of-scope work performed during this build:**

- A committed `.gitignore` (`.ignatius/`) in every repo model and fixture, and `scripts/clear-review-state.ts` before checks, because checks serve repo models in place.
- `/api/flow` failure no longer prevents the entity model from loading at boot.

**Unforeseens — surprises that emerged during implementation:**

- Bun's recursive `fs.watch` on macOS replays folder creation late and often misses the baseline rename; the CLI approve refresh uses `fs.watchFile` polling instead.
- Rendered body HTML depends on wiki-link target existence; body comparison normalizes it.
- Derived `__context__`/`__system__` diagrams repeated leaf nodes under ids no note can name; they are skipped.

**Deferred items still open:**

- None from the review ledger. Pre-existing on base and untouched: a selection made from a panel row is lost on any SSE model refresh; `test-sse-live-reload.ts`, `test-cli-binary.ts`, and `test-large-model-nav.ts` fail or flake on base in this environment.
