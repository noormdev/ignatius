# DFD polish round 4 (CP24–26)


## Goal


Fourth flow polish round on `flow-edge-routing`, all in the Data Dictionary's process surface: nest
sub-processes under their parent in the sidebar, make process IO endpoints clickable in the DD card (not just
the dialog), and render the per-process in/out sample data (CP16 examples) in the DD card too.


Additive — no engine change. Ships commit-only on `flow-edge-routing`, no push/merge.


## Non-goals


- Restructuring the flow parse model (no new `parentId` field). Parent ↔ sub-process is derivable from the
  dotted number prefix (`1.1`'s parent is `1`) and the existing `subDfds` nesting.

- Changing the process DIALOG (`FlowNodeModal`) — CP20 already made its IO endpoints clickable and CP16 already
  shows its examples. This round brings the DD CARD (`DictProcessSection`) to parity.

- A new examples authoring shape. CP26 renders the SAME `FlowProcess.examples` CP16 defined.


## Success criteria


- [ ] In the DD sidebar, sub-processes nest under their parent: processes are ordered hierarchically by dotted
  number (`1`, then `1.1`, `1.2`, then `2`, `3`) and each is indented by its depth, so `1.1 Validate Customer`
  and `1.2 Record Order` sit beneath `1 Create Sales Order` — mirroring the entity subtype indent
  (`.dict-nav-subtype`). Clicking any still scrolls to that process.

- [ ] In the DD process card, every IO endpoint is clickable: `db:` scrolls to the entity (as today), and
  external / non-entity-store endpoints (Customer, OrderIntake) link to their DD section (external/store),
  instead of rendering as plain text. Endpoints with no DD section stay plain (no dead links).

- [ ] The DD process card shows the process's in/out sample-data tables (the CP16 `examples`) — one table per
  in/out flow, after the IO table / body — matching what the process dialog shows. A process without
  `examples:` shows no extra section.

- [ ] The process DIALOG behavior is unchanged and still works for sub-DFD processes (Customer/ext + queue
  store endpoints clickable there too — verify the sub-DFD case, since the resolver walks `subDfds`).

- [ ] No regression: entity DD cards, CP20 dialog clickability, CP16 dialog examples, search/print, sidebar
  entity subtype nesting.

- [ ] `bun run typecheck` zero NEW errors (no `as`/`any`/`!`); `bun run test` green; `bun run build:bundle` ok.

- [ ] Each visual checkpoint has a `test/visual/` proof against `models/key-inherited` (the `order-to-cash`
  flow: process `1 Create Sales Order` with sub-processes `1.1 Validate Customer` (ext Customer + queue
  OrderIntake) and `1.2 Record Order`). Light + dark.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 24 | Nest sub-processes in the DD sidebar | `src/App.tsx` (`DictionaryView` process nav ~2920–2954), `src/styles.css` (reuse/extend `.dict-nav-subtype`) | atomic-builder | ~2 | 1.1/1.2 ordered + indented under 1; click still scrolls (visual) |
| 25 | Clickable IO endpoints in the DD card | `src/App.tsx` (`DictProcessSection` ~2375–2430 / `FlowIoTable` wiring) | atomic-builder | ~1 | Customer + OrderIntake link to their DD section in the DD card; db unchanged; unresolved stay plain (visual) |
| 26 | Process sample data in the DD card | `src/App.tsx` (`DictProcessSection` renders `FlowProcessExamplesSection`) | atomic-surgeon | 1 | process card shows in/out example tables; no-examples → nothing (visual) |


## Sidebar nesting reference (CP24 — canonical)


Today the process nav (`DictionaryView`, App.tsx ~2920–2954) renders `visibleProcs` FLAT, in depth-first
traversal order (top-level in folder order, then sub-DFD children appended) — so `1.1`/`1.2` appear after `3`,
unindented.


Fix: order the process list HIERARCHICALLY by dotted number so each parent is immediately followed by its
descendants (`1`, `1.1`, `1.2`, `2`, `3` — natural dotted-number sort: compare segment-by-segment numerically),
and INDENT each row by its depth (number of dotted segments − 1), reusing the entity subtype indent treatment
(`.dict-nav-subtype` = `margin-left` + smaller font; scale the margin by depth for >2 levels). Parent ↔ child is
the dotted-number prefix (`1.1` is under `1`). No model change. Clicking a row still scrolls to
`#process-<id>` exactly as now.


## DD-card endpoint clickability reference (CP25 — canonical)


`DictProcessSection` (App.tsx ~2413) renders `<FlowIoTable process={...} allProcesses={...}
onScrollToEntity={...} />` — it does NOT pass `onOpenToken`/`canOpenToken`, so `FlowIoTable`'s non-db branch
(~2294–2317) always renders plain text. db endpoints link via the `onScrollToEntity` fallback.


Fix: in the DD card context, make non-db endpoints navigate to their DD section. The DD already has sections for
externals and stores and an `onScrollToSection(id)` that resolves entity/external/store/process prefixes —
route non-db endpoints through it. Two viable wirings (builder's call):

- Pass `onOpenToken` + `canOpenToken` into the DD's `FlowIoTable` where `onOpenToken(token)` maps the endpoint
  token (`ext:Customer`, `queue:OrderIntake`) to its DD section id and calls `onScrollToSection`, and
  `canOpenToken` returns true only when that section exists; OR
- Give `FlowIoTable` a DD-mode non-db cell that links to the section id directly.

Whichever: Customer + OrderIntake become links to their DD external/store sections; a non-db endpoint with no DD
section stays plain text (no dead link). db endpoints unchanged.


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Dotted-number sort breaks on non-numeric or missing numbers | med | sort defensively (numeric segment compare with fallback); processes without a number keep stable order; never throw |
| DD section id for a store/external doesn't match the endpoint token | med | derive the section id from the same id the DD section uses (`external-<id>`, `store-<name>` — confirm in code); only linkify when the section element/id exists |
| Indent depth visually collides with the group label | low | cap/scale margin sensibly; screenshot both modes |


## Change log


<!-- first amendment after approval logged here -->


## Implementation log


### Shipped — 2026-06-09


Built across 3 checkpoints via the autopilot subagent loop, commit-only on `flow-edge-routing`. Commits
(chronological):


- `c2b191c` — spec for the round-4 batch
- `8b3c725` — CP24 nest sub-processes under their parent in the DD sidebar (hierarchical dotted-number sort + depth indent)
- `a32854c` — CP25 link external/store IO endpoints to their DD section in the DD card (data-driven resolvability)
- `0d64547` — CP26 show per-process sample-data tables in the DD card (reuse `FlowProcessExamplesSection`)


**Out-of-scope work performed during this build:** none.


**Unforeseens — surprises that emerged during implementation:**

- **Concurrent session.** Midway through round 4 the scratchpad dir vanished (twice) and untracked files
  appeared — `docs/{design,spec}/noorm-flow-discovery.md` plus a `CLAUDE.md` feature-map row + frontmatter — none
  authored by this run. Almost certainly a parallel Claude session running `/atomic-plan` on a "noorm flow +
  discover" skill feature in the same repo. Left entirely untouched; all round-4 commits stage only their own
  files by explicit path, so nothing crossed over.
- **CP25 — OrderIntake stays plain in the DD card.** A doc-less transient queue store (`queue:OrderIntake`,
  no `stores/OrderIntake.md`) has no DD section to scroll to, so it correctly renders as plain text (no dead
  link), while Customer (which has an external section) links. In the process DIALOG all three endpoints link
  (the flow resolver uses the full node graph, not DD sections). Open question surfaced to the user: should
  referenced doc-less stores get a DD section so they're navigable everywhere?


**Deferred items still open:**

- Whether doc-less referenced stores should get a DD section (CP25 open question — user decision).
- From round 3: the cytoscape `Core` typing defect (`dfd-polish-round3-cytoscape-typing`).
- From round 1: `unified-app-polish-stack-entities-dfd`, `unified-app-polish-flow-modal-light-mode`.


**Squashed to `681c942` — 2026-06-09.** The per-checkpoint SHAs in this log are historical — unreachable from any branch after the `flow-edge-routing` branch was squashed to a single commit.
