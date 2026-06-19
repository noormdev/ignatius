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


- [ ] #1 — A served/exported model named `Foo` produces `document.title` `Foo` (live tab and static-export HTML `<title>`); a nameless model falls back to `Ignatius`. A check asserts the static-export `<title>`.
- [ ] #2 — When a spotlit DD card has a bidirectional (`both`) or multi-edge connection to another card, the overlay draws ≥2 distinct `<path>` elements with distinct connection points (no shared endpoint) — not one path with arrowheads at both ends. A unit test on the splitting/geometry helper proves separation; a visual screenshot confirms.
- [ ] #3 — The readout shows true scale: at Cytoscape `zoom===1` / SVG `scale===1` it reads `100%`, regardless of model size. The initial view fits and reports its real (non-100%) percentage on a large model. Home/reset fits-to-screen. `setPercent(100)` yields 1:1.
- [ ] #4 — Trackpad pinch (`ctrl`+wheel) and Cmd/Ctrl `+`/`-`/`0` zoom the canvas and never the browser page, on both DG and DFD. A unit test covers the resolver's new zoom actions; the page does not zoom (`preventDefault`).
- [ ] #5 — A process named `Confirm OTP And Create Individual` renders fully inside its box (no overflow); the box grows to fit and ELK spacing reflects the measured size. A unit test pins the sizing helper; a visual screenshot confirms.
- [ ] #6/#8 — Opening an entity modal pushes a history entry carrying `entity=<id>`; browser Back returns to the previous modal/state; closing the modal removes `entity=` from the URL.
- [ ] No new `tsc --noEmit` errors vs baseline; `bun run test` exits 0; `bun run build:cli` succeeds.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est | Verifies |
|---|-----------|-------------|-------|-----|----------|
| 1 | HTML title from model name | `src/app/index.html`, `src/generators/app.ts`, `src/server/server.ts`, SPA runtime title (`src/app/App.tsx` or a hook), `test/checks/test-app-title.ts` | feature | ~5 | export `<title>`=name; fallback `Ignatius`; suite green |
| 2 | Entity-modal history + URL sync | `src/app/App.tsx`, `src/app/hooks/useHashRoute.ts`, `src/app/hash-router.ts`, `src/app/views/graph/GraphView.tsx` (reconcile `entity=` write), test | feature | ~5 | open pushes `entity=`; Back works; close clears param |
| 3 | Zoom 100% = native 1:1 | `src/app/views/graph/GraphView.tsx`, `src/app/views/flow/FlowsView.tsx`, `src/flow-view/FlowDiagramSvg.tsx`, `src/app/components/ui/ZoomControl.tsx` | feature | ~4 | readout true scale; Home fits; `setPercent(100)`→1:1 |
| 4 | Pinch + Cmd/Ctrl zoom → canvas | `src/app/views/graph/GraphView.tsx`, `src/flow-view/FlowDiagramSvg.tsx`, `src/app/logic/shortcuts.ts`, `src/app/hooks/useKeyboardShortcuts.ts`, `src/app/App.tsx`, `test/checks/test-shortcuts.ts` | feature | ~6 | resolver zoom actions; no page zoom on either view |
| 5 | DFD process node sizes to text | `src/flow-view/elk-flow-layout.ts`, `src/flow-view/FlowDiagramSvg.tsx`, `test/checks/` | feature | ~3 | long name fits; ELK `nodeSize` reflects measured box |
| 6 | DD spotlight separate lines | `src/app/components/entity/SpotlightOverlay.tsx`, `src/app/logic/spotlight.ts` (if split), `test/checks/` | feature | ~3 | ≥2 distinct paths/points for `both`/multi-edge |


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


<!-- empty on creation -->


## Implementation log


<!-- appended per checkpoint -->
