# Large-model navigation


## Goal


On a large model, a hover focus applies only once the pointer rests on one target, a view over the animation limit jumps to its end state, and every flow is reachable from a flow index and from breadcrumb level menus that show each diagram's description.


## Non-goals


- Virtualizing, culling, or re-laying-out large diagrams.
- A validator rule that requires `description:` on a flow folder.
- Unique React keys for Dictionary process rows when two flows share a process name.
- Opening a process's ⓘ dialog from a flow index row.


## Success criteria


- [x] `src/app/logic/motion.ts` exports `HOVER_INTENT_MS = 300`, `ANIMATION_ELEMENT_LIMIT = 150` (inclusive: 150 animates, 151 does not), `animationsAllowed`, `scrollBehaviorWithin`, and `createHoverIntent` with `set`, `applyNow`, `cancel`, `applied`.
- [x] `createHoverIntent`: every change of target, including to `null`, applies after the pointer stays on it for the delay; reporting the same target again never restarts the wait; returning to the applied target before the delay applies nothing; moving A → B never applies `null` in between; `applyNow` applies at once and drops the pending target.
- [x] Flows view: node, edge, and chip hover dimming and the edge tooltip go through one hover intent; after the tooltip shows, pointer moves reposition it without re-rendering the SVG; `buildFlowData` is memoized on `diagram` and `flowDataOpts`; opening an edge's contract dialog clears the hover at once.
- [x] Graph view: hover fade, reverse-predicate labels, and Shift lineage apply when a node hover settles; Shift over a node whose hover is still waiting applies it at once with lineage; leaving the canvas clears through the same wait; a plain click clears the hover at once before opening the modal.
- [x] Dictionary browse lens: card spotlight and label reveal apply when a card hover settles; switching lens clears it at once.
- [x] A DFD whose rendered nodes plus edges exceed the limit renders nodes, edges, and chips with no opacity transition. A Dictionary whose visible entities, processes, externals, and stores exceed it marks `.dict-view` `data-motion="off"`: card fades have no transition and every scroll into the Dictionary (sidebar, body links, spotlight chips, the shell's process scroll) jumps.
- [x] A flow folder's `index.md` may carry `description:` frontmatter: `parseFlows` sets `FlowDiagram.description`; a router-only index file (no frontmatter) yields none; malformed frontmatter reports `parse.invalid_yaml`; `deriveLevels` copies it onto the flow's L1 process.
- [x] Router: a flow folder row shows the folder's description; a described row's hash folds the description in, so rewording it changes the parent digest only; an undescribed row's hash is the folder digest unchanged; `ignatius index` keeps the frontmatter.
- [x] `src/flow-view/flow-nav.ts`: `resolveDiagramPath` walks id paths exactly; `levelEntries` lists the sub-DFDs of a parent (or the roots) in dotted-number order with number, label, description, process count; `buildFlowIndex` lists every flow and process in number order with a unique key and the exact path each opens; the derived Context and System levels are not rows, so the flows are the top level. Description fallback: process `description:`, then sub-DFD folder description, then (the whole-system process, and roots) the model `description:`.
- [x] Landing and derived levels: with no `dfd=`, the Flows view opens on the System overview (`defaultDiagramPath`: the Context root's System child; an unleveled tree's first root). The derived Context and System diagrams get no crumb, and a derived diagram has no Back button. A house (Home) button between the Process Flows chip and the first crumb opens the overview from any depth and is marked current (`aria-current="page"`) while the overview is on screen. The overview is the landing and the Back target from a top-level flow; the Context diagram opens only by `dfd=__context__`.
- [x] Breadcrumbs: the root chip reads "☰ Process Flows" and toggles the flow index; each crumb whose level has two or more diagrams shows a ▾ (a flow crumb's menu is headed "Process flows") that opens `LevelMenu` (heading, count, filter above 8 entries, ↑ ↓ Enter Esc, outside click closes, current entry marked); an ancestor crumb's label still drills up; picking an entry navigates by id path.
- [x] Flow index (`FlowIndex`): an SSADM process-hierarchy chart of pills with connectors and a side pane showing the hovered or focused row's description (else the current diagram's, else the model's name and description); a row opens its own sub-DFD, or the diagram that contains it; opening centres the current row; Esc, ✕, the root chip, and `i` close it; a pick closes it.
- [x] `i` on the Flows view resolves to `{ type: 'flowIndex' }` (not on Graph or Dictionary, not while typing, not with a modifier) and toggles the index. The Flows help overlay lists the index, level switching, and `I`.
- [x] The DFD nav card is removed; the flow minimap sits at `left: 16px` like the Graph's.
- [x] Deep links: `dfd=` carries `diagramRef` of the rendered diagram, its id path below the derived Context and System levels joined with `/` (`invoicing/Submit-PCI`; a top-level flow is its bare id, a derived diagram its own id), with `/` left unencoded. Reload, Back/Forward, a live-reload rebuild, and a `flowview=`/`collapse=` toggle resolve it through `findDiagramByRef`, which returns the first path in tree order whose trailing ids match, so a bare-id link resolves as before. The `__IGNATIUS_ACTIVE_FLOW_DFD__` test hook stays the bare diagram id.
- [x] Checks: `test-motion.ts`, `test-flow-diagram-description.ts`, `test-flow-nav.ts`, `test-hash-router.ts`, `test-shortcuts.ts` T30, and the Playwright `test-large-model-nav.ts` (menus by pointer and keyboard, index, URL path across a reload, hover delay, dialog clears hover, animation cutoff); `test-graph-inherited-edges.ts` waits for the hover to settle and covers Shift inside the wait and a click clearing the hover.


## Approach


One hover-intent helper feeds every hover site, one element-count limit gates animation, and one navigation model built from the leveled tree drives the flow index and the breadcrumb level menus. See `docs/design/large-model-nav.md`.


## Change tree


```
src/app/logic/
├── motion.ts ............... A  (hover intent, animation limit, scroll behavior)
└── shortcuts.ts ............ M  (i → flowIndex)
src/app/hooks/useKeyboardShortcuts.ts .. M  (onFlowIndex)
src/app/App.tsx ............. M  (i → FlowsView.toggleIndex; scrollBehaviorWithin)
src/app/hash-router.ts ...... M  (dfd= keeps '/' readable)
src/app/components/
├── entity/SpotlightOverlay.tsx  M  (scroll behavior)
└── ui/HelpModal.tsx ........ M  (index, level switching, I)
src/app/views/
├── dict/DictionaryView.tsx . M  (card hover intent, data-motion, scroll behavior)
├── flow/FlowsView.tsx ...... M  (selectDiagramPath, toggleIndex, model meta to chrome)
└── graph/GraphView.tsx ..... M  (node hover intent, showHover)
src/app/styles.css .......... M  (crumbs, level menu, index, data-motion)
src/flow-view/
├── FlowChrome.tsx .......... M  (split crumbs, index button; nav card removed)
├── FlowDiagramSvg.tsx ...... M  (hover intent, tooltip, memo, animate)
├── FlowIndex.tsx ........... A
├── LevelMenu.tsx ........... A
└── flow-nav.ts ............. A
src/flows/
├── flow-parse.ts ........... M  (FlowDiagram.description)
└── flow-derive-levels.ts ... M  (L1 process description)
src/router/build.ts ......... M  (folder row description + hash)
test/checks/
├── test-motion.ts .......... A
├── test-flow-diagram-description.ts  A
├── test-flow-nav.ts ........ A
├── test-large-model-nav.ts . A
├── test-shortcuts.ts ....... M  (T30)
├── test-hash-router.ts ..... M  (dfd path round-trip)
└── test-graph-inherited-edges.ts  M  (settle waits)
test/visual/
├── screenshot-large-model-nav.ts  A  (menu, index, hover delay captures)
└── (hovering scripts) ....... M  (settle waits after hovers)
models/llm-memory-db-mssql/  M  (flow index.md descriptions; routers regenerated)
docs/guides/flows.md ........ M  (flow index, level menus, flow descriptions)
docs/guides/folder-format.md  M  (flow folder index.md description)
docs/guides/commands.md ..... M  (i key)
docs/spec/keyboard-nav-shortcuts.md  M  (change log: i)
docs/spec/help-overlay.md ... M  (change log: index rows, I)
docs/spec/model-index-routing.md  M  (SC7: folder row description)
docs/spec/process-flows.md .. M  (top-level navigation)
docs/spec/graph-flow-search.md  M  (SC12: no nav card)
docs/spec/dfd-overhaul.md ... M  (C9: derived levels have no crumb)
docs/wiki/feature-map.md .... M  (row)
skills/ignatius-modeling/ ... M  (flow folder description)
```


## Outline


```
src/app/logic/motion.ts
  HOVER_INTENT_MS — rest time before a hover applies
  ANIMATION_ELEMENT_LIMIT — element count above which a view stops animating
  animationsAllowed — count against the limit
  scrollBehaviorWithin — 'auto' inside a data-motion="off" root, else 'smooth'
  createHoverIntent — settle-then-apply target tracker
    set — report the target under the pointer
    applyNow — apply at once, drop pending
    cancel — drop pending
    applied — last applied target

src/flow-view/flow-nav.ts
  resolveDiagramPath — id path to diagrams, null on any miss
  levelEntries — diagrams one level below a parent, or the roots
  buildFlowIndex — root and process hierarchy with paths
  defaultDiagramPath — the diagram the Flows view opens on
  diagramRef — a diagram's dfd= reference
  findDiagramByRef — reference to diagram path, trailing-id match
  FlowLevelEntry, FlowIndexNode — navigation records

src/flow-view/FlowIndex.tsx
  FlowIndex — hierarchy chart + description pane

src/flow-view/LevelMenu.tsx
  LevelMenu — a crumb's level dropdown

src/flow-view/FlowChrome.tsx
  FlowChrome — index button, Home button, crumbs with ▾ menus, index, minimap
    toggleIndex — handle method for the i key

src/flow-view/FlowDiagramSvg.tsx
  tooltipPlacement — viewport-clamped tooltip position
  FlowDiagramSvg — hover intent, direct tooltip moves, memoized flow data, animate flag

src/app/views/flow/FlowsView.tsx
  initFlowGraphCore
    selectDiagramById — navigate by dfd= reference
    selectDiagramPath — navigate by exact id path
    stackFor — crumb labels for a diagram path
    showPath — rebuild the crumb stack and render

src/app/hash-router.ts
  serializeHash — dfd= keeps '/' readable
  FlowsViewHandle.toggleIndex — keyboard entry

src/app/views/graph/GraphView.tsx
  showHover — render a settled node hover or its absence
  showPredicates — forward/reverse predicate labels on a node's edges

src/flows/flow-parse.ts
  readDiagramDescription — index file frontmatter description
  FlowDiagram.description

src/router/build.ts
  buildFlowFolder — folder row description and hash
```


## Flows


**Flow: resting on a DFD node**

1. pointer enters a node; `hoverIntent.set('node:<id>')` starts a 300 ms wait, nothing repaints
2. pointer moves on to another node before 300 ms; the wait restarts for that node
3. pointer rests 300 ms; `setHover` dims everything outside the node's edges, with transitions only when the diagram is at or under 150 elements
4. pointer leaves to empty canvas and rests 300 ms; the dim clears

**Flow: switching flows from a breadcrumb**

1. user on `9.2 Submit PCI` clicks the ▾ on `9 Invoicing`
2. `LevelMenu` lists the 29 flows under `0 System` with number, description, process count, `9 Invoicing` marked
3. user types to filter and picks `22 Scope Pricing`
4. `onSelectPath([Context, System, scope-pricing])` → `selectDiagramPath` rebuilds the stack and renders

**Flow: opening a diagram from the index**

1. user clicks "☰ Process Flows" or presses `i`
2. `FlowIndex` opens scrolled to the current diagram's row
3. hovering a row shows its description in the pane
4. clicking a row calls `selectDiagramPath` with that row's path and closes the index

**Flow: reloading a deep-linked sub-diagram**

1. rendering `beta/Submit` writes `#view=flow&dfd=beta/Submit` (`diagramRef`)
2. user reloads; `FlowsView` seeds its start reference from the hash
3. `findDiagramByRef` matches the trailing ids `beta`, `Submit` and returns `Context / System / beta / Submit`, not the same-named `alpha/Submit`


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Flow folder description through parse, leveling, router | `src/flows/`, `src/router/build.ts` | atomic-implementer (mode: feature) | 4 | `test-flow-diagram-description.ts`, router/leveling checks |
| 2 | Hover intent + animation limit on Flows, Graph, Dictionary | `src/app/logic/motion.ts`, `FlowDiagramSvg.tsx`, `GraphView.tsx`, `DictionaryView.tsx`, `styles.css` | atomic-implementer (mode: feature) | 8 | `test-motion.ts`, hover browser checks |
| 3 | Navigation model, flow index, level menus, `i` | `src/flow-view/`, `FlowsView.tsx`, `shortcuts.ts`, `HelpModal.tsx` | atomic-implementer (mode: feature) | 10 | `test-flow-nav.ts`, T30, `test-large-model-nav.ts` |
| 4 | Docs, skill, feature map | `docs/`, `skills/ignatius-modeling/` | atomic-implementer (mode: feature) | 9 | surfaces agree |


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| A check or script reads hover state immediately and sees the pre-hover view | high | Browser checks wait `HOVER_INTENT_MS + 100`; `test/visual` scripts swept for the same wait |
| Authors edit `flows/<dfd>/index.md` while `ignatius index` also writes it | med | The router rewrites only `<ignatius-*>` regions; `test-flow-diagram-description.ts` asserts the frontmatter survives a write |
| Existing models go `index.stale` after upgrade | low | A folder row's hash changes only when the folder has a description |
| Two flows share a process file name | med | Index and menus navigate by id path; `test-flow-nav.ts` and the browser check cover the collision |


## Change log

<!-- Populated on first amendment after the spec is approved. Do not log drafting/refinement turns. -->
