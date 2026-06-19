# Viewer UX polish


## Goal


Fix six owner-reported viewer irritations in ignatius: a settable HTML title,
separated spotlight connection lines, native-1:1 zoom semantics, pinch/keyboard
zoom routed to the canvas, text-fitted DFD process nodes, and entity-modal
history/URL sync. #7 (graph search highlight) is deferred to issue #18.

See `docs/design/viewer-ux-polish.md`.


## Non-goals


- Graph search-highlight (#18).
- Spotlight-model or DFD layout-engine redesign.
- An elkjs bump (already 0.11.1) or new theme tokens beyond a fix's need.


## Success criteria


- [x] #1 — A served/exported model named `Foo` produces `document.title` `Foo` (live tab and static-export HTML `<title>`); a nameless model falls back to `Ignatius`. A check asserts the static-export `<title>`.
- [x] #2 — When a spotlit DD card has a bidirectional (`both`) or multi-edge connection to another card, the overlay draws ≥2 distinct `<path>` elements with distinct connection points (no shared endpoint) — not one path with arrowheads at both ends. A unit test on the splitting/geometry helper proves separation; a visual screenshot confirms.
- [x] #3 — The readout shows true scale: at Cytoscape `zoom===1` / SVG `scale===1` it reads `100%`, regardless of model size. The initial view fits and reports its real (non-100%) percentage on a large model. Home/reset fits-to-screen. `setPercent(100)` yields 1:1.
- [x] #4 — Trackpad pinch (`ctrl`+wheel) and Cmd/Ctrl `+`/`-`/`0` zoom the canvas and never the browser page, on both DG and DFD. A unit test covers the resolver's new zoom actions; the page does not zoom (`preventDefault`).
- [x] #5 — A process named `Confirm OTP And Create Individual` renders fully inside its box (no overflow); the box grows to fit and ELK spacing reflects the measured size. A unit test pins the sizing helper; a visual screenshot confirms.
- [x] #6/#8 — Opening an entity modal pushes a history entry carrying `entity=<id>`; browser Back returns to the previous modal/state; closing the modal removes `entity=` from the URL.
- [x] #9 — Spotlighting a subtype member in the DD browse lens also surfaces the basetype's relationships and its sibling subtypes as visually-distinct INHERITED connections (and a basetype surfaces its members' connections); inherited connections are de-duplicated against the active entity's direct edges and never duplicate a direct edge. A unit test pins the inheritance helper; a visual screenshot confirms.
- [x] No new `tsc --noEmit` errors vs baseline; `bun run test` exits 0; `bun run build:cli` succeeds.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est | Verifies |
|---|-----------|-------------|-------|-----|----------|
| 1 | HTML title from model name | `src/app/index.html`, `src/generators/app.ts`, `src/server/server.ts`, SPA runtime title (`src/app/App.tsx` or a hook), `test/checks/test-app-title.ts` | feature | ~5 | export `<title>`=name; fallback `Ignatius`; suite green |
| 2 | Entity-modal history + URL sync | `src/app/App.tsx`, `src/app/hooks/useHashRoute.ts`, `src/app/hash-router.ts`, `src/app/views/graph/GraphView.tsx` (reconcile `entity=` write), test | feature | ~5 | open pushes `entity=`; Back works; close clears param |
| 3 | Zoom 100% = native 1:1 | `src/app/views/graph/GraphView.tsx`, `src/app/views/flow/FlowsView.tsx`, `src/flow-view/FlowDiagramSvg.tsx`, `src/app/components/ui/ZoomControl.tsx` | feature | ~4 | readout true scale; Home fits; `setPercent(100)`→1:1 |
| 4 | Pinch + Cmd/Ctrl zoom → canvas | `src/app/views/graph/GraphView.tsx`, `src/flow-view/FlowDiagramSvg.tsx`, `src/app/logic/shortcuts.ts`, `src/app/hooks/useKeyboardShortcuts.ts`, `src/app/App.tsx`, `test/checks/test-shortcuts.ts` | feature | ~6 | resolver zoom actions; no page zoom on either view |
| 5 | DFD process node sizes to text | `src/flow-view/elk-flow-layout.ts`, `src/flow-view/FlowDiagramSvg.tsx`, `test/checks/` | feature | ~3 | long name fits; ELK `nodeSize` reflects measured box |
| 6 | DD spotlight separate lines | `src/app/logic/spotlight-lines.ts` (new pure helper), `src/app/components/entity/SpotlightOverlay.tsx`, `test/checks/test-spotlight-lines.ts`, `test/visual/test-dd-spotlight-grid.ts` | feature | ~3 | ≥2 distinct paths/points for `both`/multi-edge |
| 7 | DD spotlight inherits 1:1 key-inheritance rels (#9) | new pure helper (e.g. `src/app/logic/spotlight-inherited.ts`), `src/app/components/entity/SpotlightOverlay.tsx`, `src/app/views/dict/DictionaryView.tsx`, `test/checks/`, `test/visual/test-dd-spotlight-grid.ts` | feature | ~4 | subtype member's spotlight surfaces basetype + sibling connections in a distinct style |


Docs per CP: update the CLAUDE.md feature↔doc map and any touched guide
(`commands.md` for keyboard zoom). Visual CPs (#2, #3, #5) add or extend a
`test/visual/` script.


## Risks


| Risk | L | Mitigation |
|------|---|-----------|
| #3 SVG scale rework regresses fit/drag/persist | med | Keep fit as the initial view + Home action; change only what the readout / `100%` maps to; re-run flow position-persistence + zoom + visual tests |
| #2 offset geometry collides with off-screen chip logic | med | Reuse `computeAnchor`; offset additively on the facing edge; keep scrollport/chip exclusion intact; unit-test the splitter |
| #4 `preventDefault` on ctrl+wheel breaks cytoscape's own zoom | med | Capture-phase listener that only blocks page-zoom; verify cytoscape still zooms; test both views |
| #6/#8 history fights GraphView's existing `entity=` write | high | One source of truth for `entity=`; modal open/close owns push/back; GraphView select routes through it, not a parallel write |
| Modal pushState pollutes back-stack on every FK hop | med | One entry per distinct entity; close uses `back()` to unwind, not a forward stack |


## Change log


### 2026-06-19 — CP7 added (#9 inherited 1:1 key-inheritance connections)


**What changed:** Added CP7 — the DD spotlight surfaces connections inherited via
subtype-cluster identity (a 1:1 key-inherited subtype shares its basetype's
relationships and its sibling subtypes), rendered visually distinct from direct FK
lines. Adds the #9 success criterion and the CP7 checkpoint row.

**Why:** The owner observed mid-run (item #9) that spotlighting a subtype showed
none of its parent's relationships or its siblings, wrongly implying no
relationship despite the shared key. Folded into this batch per the owner's
explicit choice ("Fold into this batch as CP7") over a deferred ticket. See the
design doc's "#9 inherited 1:1 key-inheritance connections" decision.


## Implementation log


### CP2 — Entity-modal history + URL sync (#6/#8)


`entity=<id>` in the URL hash is the single source of truth for "which entity
modal is open." The shell (`App.tsx`) is the single writer; GraphView no longer
writes `entity=`.

- `useHashRoute` ([`src/app/hooks/useHashRoute.ts`](../../src/app/hooks/useHashRoute.ts)) gained `openEntity(id)` (pushState carrying `entity=`, dedups when the hash already holds that id), `closeEntity()` (replaceState dropping `entity` — clean URL, no Back step), and an `onEntityChange(id | null)` popstate reconcile that opens/switches/closes the modal to MATCH the hash WITHOUT pushing.
- `App.tsx` routes every open surface through the single writer: graph tap (`onSelectEntity`), dict click, FK/`[[wiki]]` hop (`onNavigate`), flow `db:` store (`openEntityById`), and findings-panel row (`onPanelSelect`) all call `openEntity`. Modal close (`×`/Esc) and graph background tap (`onDeselectEntity`) call `closeEntity`. A one-shot mount effect opens the modal for an initial `entity=` deep-link (works on any view, not just graph).
- `GraphView.tsx` stopped writing `entity=`: tap → `onSelectEntity` only; bg tap → `onDeselectEntity` only; `navigateToEntity`/`panelNavigate` do cy select+center only. `applyHashState` restores cy viewport+selection but never opens the modal (the shell owns that). `scheduleHashWrite` re-merges the live `entity=` at flush time so a debounced viewport (zoom/pan) write never clobbers a shell-pushed `entity=`.
- Back vs close: Back walks the modal back-stack (B→A→none) via the popstate reconcile (no push); close clears the URL via replaceState and shows no modal.

Tests: [`test/checks/test-hash-router.ts`](../../test/checks/test-hash-router.ts) extended with `entity=` presence/absence round-trip; [`test/checks/test-modal-history.ts`](../../test/checks/test-modal-history.ts) (new, CI-runnable, skip-if-`dist/static`-absent Playwright) proves open→`entity=`, FK hop A→B pushes again, Back→A, Back→none, close clears. `bun run test` exits 0; no new `tsc --noEmit` errors vs baseline.

### CP3 — Zoom 100% = native 1:1 (#3)


`100%` now means native 1:1 — one diagram unit renders as one CSS pixel,
independent of model size. The initial view and the Home/reset button still
fit-to-screen, but the readout shows the TRUE scale (sub-100% on large models,
>100% on small ones).

- New pure helper [`src/flow-view/zoom-scale.ts`](../../src/flow-view/zoom-scale.ts) (`computeFitScale`, `screenScaleToPercent`, `percentToScreenScale`): the DFD SVG keeps its viewBox = world content box, so on-screen scale = `internalScale × fitScale`; the readout reports that true ratio and `setPercent(100)` sets `internalScale = 1 / fitScale` (native 1:1). Keeping the viewBox = world box leaves clientToWorld / pan / drag / minimap math untouched.
- Graph ([`GraphView.tsx`](../../src/app/views/graph/GraphView.tsx)): readout = `Math.round(cy.zoom()*100)`; `setPercent(pct)` → `cy.zoom(pct/100)`; Reset/Home still `cy.fit()` then reports the real percent via the `zoom` event (no forced 100). `zoomBaselineRef` normalization removed.
- Flow ([`FlowsView.tsx`](../../src/app/views/flow/FlowsView.tsx) + [`FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx)): `fitScale` threaded into the readout + `setPercent` inverse, re-read on container resize; MIN/MAX internal scale widened to 0.05/10 so a large model's fit and native 1:1 both stay reachable.
- [`ZoomControl.tsx`](../../src/app/components/ui/ZoomControl.tsx): comment/title updated to 1:1 semantics; Home tooltip stays "fit to screen".

Tests: [`test/checks/test-zoom-scale.ts`](../../test/checks/test-zoom-scale.ts) pins the pure helper (large→<1, small→>1, meet-axis, padding, degenerate guard, `setPercent(100)`=`1/fitScale`, round-trip). Visual: [`test/visual/test-cp22-zoom-control.ts`](../../test/visual/test-cp22-zoom-control.ts) + [`test/visual/test-cp23-flow-zoom-control.ts`](../../test/visual/test-cp23-flow-zoom-control.ts) updated to native-1:1 semantics (reset returns to the fit percent, not a forced 100). `bun run test` exits 0; no new `tsc` errors vs baseline (CP3 removed 3).

### CP4 — Pinch + Cmd/Ctrl zoom → canvas (#4)


Trackpad pinch and `Cmd`/`Ctrl` `+`/`-`/`0` now zoom the active diagram canvas
and never the browser page, on both the Data Graph (Cytoscape) and the Data
Flows view (custom SVG).

- **Pinch (`ctrl`/`meta` + wheel)** — both views register a NATIVE non-passive `wheel` listener on their canvas container that calls `e.preventDefault()` when `ctrlKey || metaKey`, killing the browser page-zoom default. The canvas's own zoom path still runs (Cytoscape's built-in wheel handler on graph; the React `onWheel` zoom math on flow) — `preventDefault` stops only the browser default, not the sibling/synthetic handler. A native listener is required because React registers `onWheel` as a PASSIVE root listener, so a `preventDefault` inside the React handler is silently ignored (the flow's old unconditional `onWheel` `preventDefault` did not actually block page-zoom). Graph: listener added inside the cy-init effect in [`GraphView.tsx`](../../src/app/views/graph/GraphView.tsx), cleaned up in the same teardown. Flow: a dedicated `useEffect` on the SVG ref in [`FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx); the now-redundant React `onWheel` `preventDefault` was removed (it was a passive no-op that warned).
- **Keyboard (`Cmd`/`Ctrl` `+`/`-`/`0`)** — the pure resolver [`shortcuts.ts`](../../src/app/logic/shortcuts.ts) gained three `ShortcutAction` variants (`zoomIn`/`zoomOut`/`zoomReset`). They resolve BEFORE the bare-key editable + modifier guards, so they fire even while a text field is focused, and they are gated on `ctrl`/`meta` ONLY (`alt`/`shift` held → null). Bare `=`/`-`/`0` (no modifier) → null — plain keystrokes are never hijacked. [`useKeyboardShortcuts`](../../src/app/hooks/useKeyboardShortcuts.ts) gained `onZoomIn`/`onZoomOut`/`onZoomReset` callbacks and `preventDefault`s on the matched action (kills browser page-zoom). The shell [`App.tsx`](../../src/app/App.tsx) routes them to the ACTIVE view's existing zoom handle (`graphViewRef`/`flowsViewRef` `zoomIn`/`zoomOut`/`resetZoom` — the same CP3 native-1:1 methods the ZoomControl buttons use); the Dictionary view has no canvas → no-op.

Tests: [`test/checks/test-shortcuts.ts`](../../test/checks/test-shortcuts.ts) extended (T11–T15): `Cmd`/`Ctrl` + `=`/`+`→`zoomIn`, `-`/`_`→`zoomOut`, `0`→`zoomReset` on graph AND flow; zoom resolves with `editable===true`; `alt`/`shift` (and `ctrl+alt`/`meta+shift` combos) → null; bare keys → null; exact 1-key action shape. Empirically verified in a real browser (throwaway Playwright probes): ctrl+wheel on graph leaves the page unzoomed (`defaultPrevented`) while `cy.zoom()` still changes; ctrl+wheel on flow changes the SVG inner transform; `Cmd`+`=`/`-`/`0` change `cy.zoom()` and the keydown default is prevented. `bun run test` exits 0; no new `tsc --noEmit` errors vs baseline. CP3 zoom math untouched.

### CP5 — DFD process node sizes to text (#5)


A DFD process node was a fixed rect (ELK fed `130×64`, the renderer drew
`120×68` — a pre-existing mismatch) with at most a 2-line label, so long names
("Confirm OTP And Create Individual", "Attach Memory to Project") spilled
outside the box. The process now sizes to its wrapped label, and the SAME
measured size feeds ELK so band spacing and edge routing stay correct.

- New pure helper [`processNodeSize(label)`](../../src/flow-view/flow-layout.ts) in `flow-layout.ts` (no DOM/React/Bun): greedy word-wrap (a too-long single word is hard-broken) into lines no wider than the inner text width, returning `{ lines, width, height }`. Width = `max(PROC_MIN_W=120, longest-line estimate + PROC_TEXT_LEFT(34, badge reserve) + PROC_TEXT_RIGHT_PAD(14))`, capped at `PROC_MAX_W=320` (a word past the cap is broken instead of widening further). Height = `max(PROC_MIN_H=68, lineCount·PROC_LINE_H(15) + PROC_TEXT_PAD_Y(38))` — the 38px vertical padding tunes the floor to hold exactly 2 lines (the historical max), so a 3rd line grows the box and the badge stays clear. Char-width estimate (`estProcessLineWidth`, ~0.55·11.5 px/char) matches the renderer's `measureText` style and the externals/stores `estW` precedent — headless ELK/Bun has no `measureText`. Short names floor identically; only long names grow.
- ELK + renderer now share ONE size: [`elk-flow-layout.ts`](../../src/flow-view/elk-flow-layout.ts) `nodeSize(process)` calls `processNodeSize` (replacing the fixed `130×64`); [`FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx) drops the fixed `PROC_W`/`PROC_H` constants — `ProcessNode`, `nodeBounds`, the viewBox/minimap passes, the fan-out anchors, and the edge routers (`orthogonalPath`/`chipAnchor`) all derive the process box from `processNodeSize(label)` via a shared `sizingLabel(node)` helper (process label / store name / external→undefined). `ProcessNode` renders ALL wrapped lines (no longer 2-max via the deleted `splitProcessLabel`), vertically centered, with the number badge + ⓘ/⤵ affordances repositioned against the grown box. The `130/120`+`64/68` mismatch is gone.
- Regression: process heights are now label-derived, so a band's nodes no longer share one exact center-y (a 3-line process is taller; ELK staggers centers by a few px). [`test/checks/test-cp4c-single-row-bands.ts`](../../test/checks/test-cp4c-single-row-bands.ts) (C16) was updated to assert the single-row STRUCTURE via vertical overlap — every node in a band shares a common horizontal strip (`max(top) < min(bottom)`) AND bands stay separated — rather than exact center-y equality. Justification: the size is now label-derived; the strip+separation check is an equivalent-or-stronger structural assertion that survives variable heights (it newly catches band-collapse, which the old exact-y test did not, while tolerating small intra-band stagger). The other DFD checks (`test-cp4a-*` C14 role-split, `test-cp4d-*` C17 frame alignment, `test-elk-flow-positions` C4 band ordering, `test-flow-leveling`) import `nodeSize` and re-derive sizes from it, so they adapted with no edit and still pass.

Tests: [`test/checks/test-process-node-size.ts`](../../test/checks/test-process-node-size.ts) (new) pins the pure helper — short label ("Login") floors at `120×68` in 1–2 lines; the long label grows (`120×83`, 3 lines), preserves all words in order, and EVERY wrapped line's estimated width ≤ the box inner text width (it actually fits); width ≥ longest-line + badge reserve + padding; a long single word still fits; empty label floors without throwing. A no-op helper returning the fixed size fails the long-label fit case. Visual: [`test/visual/test-process-node-size.ts`](../../test/visual/test-process-node-size.ts) (new) serves `models/llm-memory-db-mssql`, opens `memory-lifecycle`, asserts every process's wrapped text bbox sits inside its rect bbox (no overflow), and screenshots; falls back to the unit test (exit 2) if chromium can't launch. Verified in a real browser: all 6 processes incl. the 24-char "Attach Memory to Project" / "Filter Memories by Tags" wrap to 3 lines fully inside their boxes. `bun run test` exits 0; `bun run build:cli` succeeds; no new `tsc --noEmit` errors vs baseline.

### CP6 — DD spotlight separate lines (#2)


A spotlit DD browse-lens connection between the active card and another card no
longer collapses to ONE bezier. A bidirectional (`both`) or multi-edge bundle is
now fanned into SEPARATE `<path>` elements — one per edge/direction with offset
connection points — so neither the lines nor their arrowheads coincide. A
relationship is never hidden behind another, at rest ("always separate" — the
owner's chosen option). A single-edge `out`/`in` connection (the common case)
stays one un-offset line, preserving today's look exactly.

- New pure helper [`src/app/logic/spotlight-lines.ts`](../../src/app/logic/spotlight-lines.ts) — `separateSpotlightLines(base: BaseAnchor, directions: readonly LineDirection[]): SpotlightLineSpec[]`. No DOM/React/Bun (same discipline as `spotlight.ts`). Given the base facing-edge anchor (`{ x1, y1, x2, y2, anchor }` from `computeAnchor`) and the bundle's per-edge directions, returns one spec per direction, each carrying a SINGLE direction. Offset is perpendicular to the line axis: HORIZONTAL anchor (cards side by side) spreads the endpoints' y; VERTICAL anchor (cards stacked) spreads the x. Spread is symmetric about the original midpoint — line `i` is offset by `(i − (K−1)/2) · SPOTLIGHT_LINE_GAP` (`GAP = 14` px), so the centre of mass stays on the base anchor. `K === 1` → the base line unchanged (no offset); `K === 0` → `[]`. Both FK (`SpotlightEdge`) and flow (`FlowSpotlightEdge`) edges expose `direction: 'out' | 'in'`, so `.map(e => e.direction)` yields `LineDirection[]` with no casting.
- [`src/app/components/entity/SpotlightOverlay.tsx`](../../src/app/components/entity/SpotlightOverlay.tsx) — DOM measurement (`computeAnchor`) stays in the component; the FK and flow draw loops now derive the bundle's directions, call `separateSpotlightLines`, and emit ONE `<path>` per returned spec. Each path carries a single arrowhead (`out` → `marker-end`; `in` → `marker-start`); no path sets both. The same separation applies to the dashed flow lines. The `buildSpotlightConnections` / `buildFlowSpotlightConnections` bundling contract is untouched (still one bundle per `otherId`/`otherCardId`); the per-bundle pill second-pass (gated to `labelHoverCardId`, with collision-nudging) is unchanged and still reads the bundle's base `midX`/`midY`, so pill UX, the scrollport-intersection skip, and the off-screen chip aggregation are all preserved.
- Why the same single line stays unchanged: `count === 1` short-circuits before any offset math, returning the base anchor verbatim — the common single-FK look is bit-identical to before.

Tests: [`test/checks/test-spotlight-lines.ts`](../../test/checks/test-spotlight-lines.ts) (new) pins the pure helper — a `both` bundle (1 out + 1 in) → 2 specs with DISTINCT endpoints, one `marker-end`-only and one `marker-start`-only; a 2-out bundle → 2 distinct specs; a single edge → 1 spec with endpoints equal to the base (no offset); HORIZONTAL anchor offsets y (x fixed on facing edges) and VERTICAL offsets x (y fixed), each symmetric about the base midpoint; empty → `[]`; 3 edges → 3 distinct symmetric specs. A no-op helper returning one line fails the `both` case. [`test/checks/test-spotlight-connections.ts`](../../test/checks/test-spotlight-connections.ts) still passes (bundling contract intact). Visual: [`test/visual/test-dd-spotlight-grid.ts`](../../test/visual/test-dd-spotlight-grid.ts) extended — pins the external "Customer" card in `models/key-inherited` (which produces `both` FLOW bundles; the entity FK graph has no `both` bundle), asserts ≥2 `path.spotlight-line` elements, NO path with both `marker-start`+`marker-end`, every path with exactly one marker, ≥2 distinct start points, and ≥2 distinct geometries. Verified in a real browser (throwaway Playwright probe + screenshot): 7 separated paths, 0 double-ended; a horizontal `both` bundle offset its y by ±7 about the midpoint (678.30 / 692.30 at shared x), a vertical `both` bundle offset its x by ±7 about the midpoint (293.79 / 307.79 at shared y). `bun run test` exits 0 (78 checks); no new `tsc --noEmit` errors vs baseline. (The full `test/visual/test-dd-spotlight-grid.ts` has a PRE-EXISTING, unrelated CP10 failure — process-card count expects the `/api/flow` deep count which now includes synthetic context/L1 diagrams, vs. the browse grid that excludes them via `SYNTHETIC_DIAGRAM_IDS`; this is in a section that runs before the appended CP6 block and is independent of the spotlight-line change. The CP6 assertions were verified in isolation.)

### CP7 — DD spotlight inherits 1:1 key-inheritance relationships (#9)


A 1:1 KEY-INHERITED subtype shares its basetype's primary key — the child IS the
parent — so it transitively participates in the basetype's relationships and
relates to its sibling subtypes. The spotlight previously walked only the active
entity's DIRECT FK edges (`buildSpotlightConnections`), so a subtype looked
unrelated to its parent's relationships and to its siblings. CP7 surfaces those
INHERITED connections, rendered visually distinct from direct FK lines.

- New pure module [`src/app/logic/spotlight-inherited.ts`](../../src/app/logic/spotlight-inherited.ts) — `buildInheritedConnections(index: ModelIndex, entityId: string): InheritedConnection[]` (no DOM/React/Bun, same discipline as `spotlight.ts`). `InheritedConnection = { otherId, direction: 'out'|'in'|'both', via: string }`; exports `INHERITED_IDENTITY = 'identity'`. Cluster role resolved from the ModelIndex maps (`subtypeMemberToCluster`, `basetypeClusterById`) — no re-scan. **Active = subtype member:** surfaces (a) the basetype + each sibling member as identity links (`via='identity'`), and (b) the basetype's direct FK connections (`buildSpotlightConnections(index, basetypeId)`) with `via=<basetype id>`. **Active = basetype:** surfaces each member as an identity link, plus each member's direct FK connections with `via=<member id>`. **De-dup:** the active's OWN direct connections (`buildSpotlightConnections(index, entityId)`) form a baseline — EVERY inherited connection (identity links included) to an otherId the active already connects to directly is suppressed (direct wins, never duplicate a direct edge — the #9 criterion). In the key-inherited convention a subtype has a direct identifying FK to its basetype, so the basetype renders ONCE as that solid direct FK line, NOT also as a dotted inherited identity line; the sibling subtypes and the basetype's OTHER relationships (which are not direct edges of the active) still surface as inherited. For a basetype-active spotlight this also drops members that are already direct in-edges, leaving only the members' other relationships as inherited. Never points at the active entity itself; bundled (one connection per otherId, first-seen wins); sorted by otherId; non-cluster / unknown id → []. **Scope (v1):** subtype clusters only — general identifying-1:1 dependent extension tables are an explicit non-goal (noted in module header), per the design.
- [`src/app/components/entity/SpotlightOverlay.tsx`](../../src/app/components/entity/SpotlightOverlay.tsx) — new `inheritedConnections` prop + a THIRD line category. `computeInheritedLines` reuses `computeAnchor` + the scrollport-skip; the draw loop runs each inherited line through the CP6 `separateSpotlightLines` (a `both`/identity connection fans into two so they don't overlap) and emits DOTTED (`stroke-dasharray "2 4"`) paths in `--spotlight-line-inherited` (green), class `spotlight-line spotlight-line--inherited`, `data-kind="inherited"`, one arrowhead each (dedicated `arrow-inherited-*` markers). A `renderInheritedPill` (hover-revealed, joined into the CP14 collision-nudge pass) shows "shared key" (identity) or "via &lt;basetype&gt;" (transitive). Off-screen inherited connections become chips (`spotlight-chip--inherited`, distinguishable from FK/flow chips via `data-kind`).
- [`src/app/dom/theme-css-vars.ts`](../../src/app/dom/theme-css-vars.ts) sets `--spotlight-line-inherited` (`#34d399` dark / `#059669` light); [`src/app/styles.css`](../../src/app/styles.css) adds the fallback var (`:root` + `.theme-light`) and a `.spotlight-chip--inherited` modifier (dashed green border, italic green provenance text).
- [`src/app/views/dict/DictionaryView.tsx`](../../src/app/views/dict/DictionaryView.tsx) computes `inheritedConnections = buildInheritedConnections(modelIndex, activeId)` (entity-only useMemo), passes it to `SpotlightOverlay`, and folds inherited otherIds into `spotlitIds` (lit set) and `focusSet` so inherited cards light up and join focus mode — they ARE related via the shared key.

Tests: [`test/checks/test-spotlight-inherited.ts`](../../test/checks/test-spotlight-inherited.ts) (new, 6 assertions) pins the pure helper on a Party/Business/Individual cluster fixture where each member has a direct FK to its basetype — the member spotlight surfaces the sibling + the basetype's OTHER rels (with `via` provenance) as inherited but NOT the basetype itself (it's a direct FK edge of the member, so it renders once as the solid direct line) and NOT its own direct FK; the basetype spotlight surfaces the members' OTHER rels (`via=<member>`) but NOT the members themselves (they are direct in-edges); an otherId that is both direct AND a basetype rel appears only as direct (transitive de-dup); plain entity → []; unknown id → []; one connection per otherId. A no-op returning `[]` fails the subtype case (it must surface the sibling + the basetype's rels). [`test/checks/test-spotlight-connections.ts`](../../test/checks/test-spotlight-connections.ts) still passes (`buildSpotlightConnections` unchanged). Visual: [`test/visual/test-dd-spotlight-grid.ts`](../../test/visual/test-dd-spotlight-grid.ts) extended (CP7 section) — spotlights the `Business` subtype member in `models/key-inherited`, asserts ≥1 dotted `data-kind="inherited"` / `.spotlight-line--inherited` path in `--spotlight-line-inherited`, that every inherited line is dotted while the direct FK line stays solid, and screenshots. Verified in a real browser (throwaway probe): pinning `Business` drew EXACTLY 1 solid direct FK line to `Party` (the basetype, lit but NOT redrawn as a dotted inherited line — the #9 de-dup contract) + dotted green inherited lines to `Person` (sibling, `via=identity`, fanned in two by CP6 for its `both` direction) and to `Identity`/`PartyType`/`PaymentMethod`/`SalesInvoice`/`SalesOrder` (the basetype's OTHER relationships inherited via the shared key, `via=Party`) — 8 spotlight paths total (1 solid + 7 dotted). `bun run test` exits 0; no new `tsc --noEmit` errors vs baseline.

<!-- appended per checkpoint -->
