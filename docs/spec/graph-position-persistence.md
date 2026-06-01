# Graph node position persistence


## Goal


Persist user-dragged graph node positions in the browser and restore them on reload — but only while the model's structure is unchanged. On any structural change, fall back to ELK auto-layout. Backend derives a structural `layoutKey`; frontend keys localStorage by it.


## Non-goals


- Cross-browser / cross-machine sharing or committing arrangements to the repo.
- Multiple named layouts, or layout history/undo.
- IndexedDB (documented as a later migration trigger, not built now).
- Changing zoom/pan persistence (the hash-router already owns that).
- Reconciling a changed structure onto old positions — re-layout instead.


## Success criteria


- [ ] A pure `layoutFingerprint(model)` exists beside `parse.ts`, returns a short stable string, and is unit-tested: identical topology → identical key; an added/removed node, or a changed/added/removed `source>target` edge → different key.
- [ ] The fingerprint is invariant to non-structural edits: changing predicate text, columns/AKs/pk, entity description/body, group, or theme does **not** change the key (asserted in tests).
- [ ] `/api/model` response includes a `layoutKey` field derived from the same function.
- [ ] Static `graph` output injects `window.__LAYOUT_KEY__` (beside `window.__MODEL__`), and a static reload restores a previously-saved arrangement for the same model.
- [ ] No hashing code ships in the frontend bundle — `App.tsx` only reads the key from the payload / window global.
- [ ] Dragging a node and reloading (live and static) restores the dragged positions when the structure is unchanged.
- [ ] After a structural change, reload uses ELK auto-layout (saved positions for the old key are ignored, never partially applied).
- [ ] A FAB menu item ("Reset layout") clears the saved arrangement for the current key and re-runs auto-layout (re-fit included).
- [ ] Saved arrangements are pruned to the last N fingerprints so localStorage does not grow unbounded.
- [ ] `bun run typecheck` and `bun run test` pass.


## Approaches


| # | Approach | Sketch | Cost | Risk |
|---|----------|--------|------|------|
| A | Backend-derived structural-fingerprint key + frontend localStorage (chosen) | Pure `layoutFingerprint` in Bun; ship via payload + window global; FE save-on-drag / restore-on-layoutstop keyed by it | low | fingerprint must capture exactly the layout-determining inputs |
| B | Frontend computes fingerprint | Hash fn in browser bundle | low-med | two definitions of "structural" can drift; bundle bloat |
| C | Per-node reconciliation on reload | Restore matched nodes, place new ones | high | fragile partial-restore states; the problem we designed out |
| D | IndexedDB store | Async DB keyed by fingerprint | med | async ceremony in sync cy-init path; quota unused at this size |


## Recommendation


**A.** The fingerprint is a pure function of the `Model`, and both model-delivery paths (`/api/model` in `server.ts:79-82`, `generateGraph` injection in `generators/graph.ts:95`) originate in Bun — so derive once server-side, ship the key, keep the browser dumb. All-or-nothing restore (key match → restore all; mismatch → re-layout) removes reconciliation (C) entirely. localStorage over IndexedDB (D) because position data is ~25KB at 1000 entities vs a ~5MB budget, and localStorage is synchronous — fitting the synchronous `layoutstop` restore path. See `docs/design/graph-position-persistence.md` for the fingerprint contract and the IndexedDB migration trigger.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Pure `layoutFingerprint(model)` module (FNV-1a over sorted node ids + sorted `source>target` pairs) + unit tests for structural-vs-cosmetic sensitivity | new `src/layout-fingerprint.ts`, `test/checks/test-layout-fingerprint.ts` | atomic-builder | ~2 | `bun test/checks/test-layout-fingerprint.ts` green; same-topology→same-key, moved-edge→different-key, predicate/column/description edits→same-key |
| 2 | Ship the key from both backends | `src/server.ts` (`/api/model` adds `layoutKey`), `src/generators/graph.ts` (inject `window.__LAYOUT_KEY__`), window typing | atomic-builder | ~3 | `bun run typecheck`; `/api/model` JSON has `layoutKey`; static graph.html contains `window.__LAYOUT_KEY__` |
| 3 | Frontend persistence: read key, save positions on drag-end (debounced), restore in the existing `layoutstop` block when the stored key matches, localStorage helper with last-N pruning | `src/App.tsx`, optional small `src/layout-store.ts` helper | atomic-builder | ~2 | Playwright visual check in `test/visual/`: drag node → reload → position restored; structural change → ELK layout |
| 4 | "Reset layout" FAB menu item — clears saved entry for current key, re-runs auto-layout + re-fit | `src/App.tsx` | atomic-surgeon | 1 | reset clears the arrangement and returns to auto-layout (visual check) |


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Fingerprint omits a real layout-determining input → stale positions restored onto a shifted graph | low | Contract table in design doc; tests assert the in/out set; failure mode is benign (re-layout), not a broken graph |
| `layoutstop` restore races ELK / fires before positions settle | low | Reuse the existing `cy.one('layoutstop', …)` seam (App.tsx:1220) already proven for hash zoom/pan restore |
| Restoring positions skips `cy.fit`, leaving nodes off-screen | med | Decide fit behavior on restore (fit-to-restored-bounds) explicitly during checkpoint 3 |
| localStorage growth across many structural revisions | low | Last-N pruning on save (checkpoint 3) |
| Static arrangements not shareable surprises users | low | Documented non-goal; reset control gives an escape hatch |


## Change log


<!-- Populated on first amendment after approval. -->


## Implementation log


### shipped — 2026-06-01


Built across 4 checkpoints (6 loop iterations incl. 2 fix rounds) of /subagent-implementation. Commits (chronological):

- `780a0ae` — CP-1 `layoutFingerprint` pure FNV-1a module (sorted node ids + sorted `source>target` pairs) + 14-assertion test
- `52ae567` — CP-2 ship `layoutKey` from `/api/model` and the static `window.__LAYOUT_KEY__` injection; single fingerprint source across both paths (review findings closed in-iteration: layoutKey test assertion + JSON.stringify injection)
- `4d2bef8` — CP-3 frontend persistence: `layout-store.ts` (single-key map, monotonic-clock newest-10 prune, storage+clock DI), App.tsx save-on-drag (debounced, teardown-cleared) + restore-before-fit; unit test + visual check (fix round folded in: saveTimer teardown leak, deterministic prune test)
- `5f7dd11` — CP-4 "Reset layout" FAB action: clears the key's entry and re-runs ELK; cancels pending drag-save first (save-timer race fix from review); ELK opts extracted to a shared const
- `ce9dc76` — follow-ups F-1 (isolate added-edge fingerprint test) + F-2 (FNV signed/unsigned comment)


**Out-of-scope work performed during this build:** none. (Discovered unrelated in-progress "open browser on serve" changes in the working tree — `src/cli.ts`, `src/serve-port.ts`, `src/open-browser.ts`, `test/checks/test-open-browser.ts`, `docs/guides/*` — left untouched, not part of this feature.)


**Unforeseens:**

- `dist/static/` bundle was stale; orchestrator rebuilt it to run the Playwright visual checks end-to-end (verified: drag→reload restores within ±10px; reset returns to ELK; reset+reload stays at ELK).
- Reset path had a save-timer race (drag → reset within the 400ms debounce re-persisted the stale arrangement). Caught in review, fixed by cancelling the pending timer before clearing the store.
- Pre-existing `test/checks/test-cli-binary.ts` failure (compiled binary reports v0.3.0 vs package.json v0.4.0) is a stale-binary issue unrelated to this work — fixed by `bun run build:cli`, not done here.


**Deferred items still open:** none. F-1/F-2 fixed (`ce9dc76`), F-3 fixed in CP-3 fix round.
