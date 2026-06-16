# DFD edge-hover data reveal

## Goal

Hovering a DFD edge reveals the full data-flow contents — one item per line, with
a `source → target` header — in a legible, zoom-independent styled tooltip. This
brings back the data that the dfd-overhaul gated off-canvas for long labels
(notably `db:` column lists), without re-cluttering the canvas or requiring a
click. Long labels also keep a truncated `…` inline marker on the canvas, so it
is always visible where more data lives. Implements issue #14.

## Non-goals

- No editing of flow data from the hover surface.
- No change to the `SHORT_LABEL_MAX = 22` threshold value itself (it remains the
  truncation point), and no change to short labels — labels ≤ 22 chars still
  render in full inline.
- No node-hover data-aggregation panel; node hover keeps its existing
  dim/highlight focus behaviour unchanged.
- No change to the ERD (DG) graph hover — DFD viewer only.

## Approach

See `docs/design/dfd-edge-hover-data.md`. Chosen: an HTML `position:fixed` overlay
tooltip (zoom-independent legibility), reading the existing edge `hover` state plus
captured pointer coords; structured data preserved via a new `dataLines: string[]`
on the edge element rather than the lossy joined label.

## Success criteria

- [ ] `normalizeEdgeData(data: string | string[] | undefined): string[]` is a pure, exported helper (no DOM/React imports) that returns the data items as an array: `string[]` passes through, a `string` splits on `", "`, empty/undefined → `[]`. Unit-tested for all three cases plus a single-item string.
- [ ] The edge variant of `FlowElementData` carries `dataLines: string[]`, populated in `buildFlowData` (`src/flow-view/flow-layout.ts`) from the original `edge.data` via `normalizeEdgeData`. The existing joined `label` string is unchanged.
- [ ] `EdgeRender` in `FlowDiagramSvg.tsx` carries `dataLines` (and the source/target display labels needed for the header), threaded from the edge element / `fromNode`/`toNode`.
- [ ] On pointer hover over an edge (its `<g>` or its chip), a styled HTML tooltip appears showing every item of `dataLines` (one per line) under a `<sourceLabel> → <targetLabel>` header. The tooltip appears for any edge whose `dataLines` is non-empty — including long `db:` column-list edges whose inline chip shows only the truncated `…` preview.
- [ ] Long edge labels (> 22 chars) render an inline chip showing a truncated preview — the first ~22 chars followed by `…` — instead of being suppressed off-canvas. The `…` signals that more data is available on hover. Short labels (≤ 22 chars) are unchanged (full inline). Such truncated edges still carry `data-contract-type="hidden"` so the contract-text attribute and the hover check continue to identify them.
- [ ] The tooltip is `position: fixed` (screen space), so its text size is constant regardless of the SVG zoom level, and it is anchored near the hovered pointer location. It is removed on pointer leave.
- [ ] The native SVG `<title>` reveal on the edge `<g>` is removed (superseded by the styled tooltip). `data-contract` and `data-contract-type` attributes remain on the edge `<g>`, unchanged.
- [ ] The existing dim/highlight-on-hover focus behaviour is preserved (hovering still dims unrelated nodes/edges).
- [ ] A CI-runnable Playwright check (`test/checks/test-dfd-edge-hover.ts`, skip-if-dist-absent) against the served proving model proves, in the real browser: hovering a known gated `db:` edge shows the styled tooltip containing the full column-list text; the tooltip is absent before hover and after pointer-leave; the edge `<g>` still exposes `data-contract`.
- [ ] The visual test `test/visual/test-cp2-dfd-edge-labels.ts` is updated so any assertion that depended on the `<title>` element instead asserts the styled hover tooltip / `data-contract` (the contract is still reachable). No CI check regresses.
- [ ] A `test/visual/` screenshot script captures the tooltip over a dense diagram for human inspection.
- [ ] `bun run test` passes (all `test/checks/*.ts`, exit 0). `bun run build:cli` succeeds.
- [ ] Touched source files introduce **zero** new `tsc --noEmit` errors vs. the baseline (`tmp/baseline-typecheck.log`).
- [ ] CLAUDE.md feature map gets a "DFD edge-hover data reveal" row; `docs/guides/flows.md` notes the hover behaviour.

## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Pure `normalizeEdgeData` + `dataLines` on edge element | `src/flow-view/flow-layout.ts`, `test/checks/test-edge-hover-data.ts` | atomic-implementer (feature) | 2 | helper returns correct array per data shape; `buildFlowData` populates `dataLines` |
| 2 | Hover tooltip in the renderer + browser check + screenshot | `src/flow-view/FlowDiagramSvg.tsx`, `src/app/styles.css`, `test/checks/test-dfd-edge-hover.ts`, `test/visual/test-dfd-edge-hover.ts`, `test/visual/test-cp2-dfd-edge-labels.ts` | atomic-implementer (feature) | 5 | real browser: hover gated db: edge → styled tooltip with full contents; hide on leave; `data-contract` intact; dim/highlight preserved |
| 3 | Docs: feature map + flows guide | `CLAUDE.md`, `docs/guides/flows.md` | atomic-implementer (surgical) | 2 | feature-map row + guide hover note present |
| 4 | Inline truncated `…` preview for long labels (reverses suppression) | `src/flow-view/FlowDiagramSvg.tsx` (+ truncation helper), `test/checks/test-cp2-edge-label-strategy.ts`, `test/visual/test-cp2-dfd-edge-labels.ts`, `docs/guides/flows.md` | atomic-implementer (feature) | 3-4 | long label → single-line `first~22…` chip; short unchanged; hover still shows full; gate tests + C5/C13 updated |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Tooltip flickers as pointer crosses casing/line/chip layers of one edge | med | Key the tooltip on the edge id from `hover` state (already one state for the whole edge `<g>`); chip and path share the same `onHoverChange`. Hysteresis not needed if both layers report the same edge id. |
| Tooltip clipped at viewport edge | med | Clamp the fixed position within the window; offset from the pointer; verify in the Playwright check near a corner edge if feasible, else accept clamp. |
| Removing `<title>` breaks an assertion | low | Only `test/visual/test-cp2-dfd-edge-labels.ts` asserts `<title>` (visual, not CI). Update it in CP2. CP2 implementer greps `test/` for `<title>`/`data-contract` before removing. |
| In-SVG vs HTML overlay coordinate confusion | low | Use pointer `clientX/clientY` directly for the fixed overlay — no viewBox transform math needed. |
| Lossy split if a data item contains `", "` | low | `normalizeEdgeData` passes `string[]` through untouched; only legacy single-string data splits, matching the existing inline-chip behaviour. |

## Implementation log

- CP1 — pure `normalizeEdgeData(data): string[]` (array passthrough; string split on `", "`; empty/undefined → `[]`) + `dataLines: string[]` on the edge `FlowElementData` variant, populated in `buildFlowData`; the joined `label` left unchanged. 10-assertion unit test (`5834fa3` docs, `1d2d891` code). Reviewer PASS; one 🔵 (`!` non-null in test) fixed in-iteration via a narrowing guard.
- CP2 — styled `position:fixed` HTML hover tooltip listing every `dataLines` item under a `source → target` header; appears for any edge with non-empty data incl. gated `db:` column lists; native `<title>` removed, `data-contract` kept; dim/highlight focus preserved; CI Playwright check (`test/checks/test-dfd-edge-hover.ts`, readiness-polled) + screenshot + cp2 visual-test update (`1dd7fb7`). Reviewer CHANGES_REQUESTED (1🔴 3🟡 2🔵) — ALL fixed in one surgical pass: timer-leak-on-unmount; `text-overflow: ellipsis` truncation removed (full lists wrap, `max-width` 360); CI sleeps → readiness polls; visual-file Bun-typing tsc errors → `serveCommand` import; stale comment; box-shadow matches the file's hardcoded-rgba convention. Re-review VERDICT: PASS. CI check 7/7; tooltip screenshot verified (full text, no clip).
- CP3 — CLAUDE.md feature-map row + `docs/guides/flows.md` hover note (`d493dbe`). Reviewer PASS; one 🔵 (prose overclaimed the trigger) fixed in-iteration ("a data flow edge that carries data").
- CP4 — inline truncated `…` preview for long labels, reversing the dfd-overhaul off-canvas suppression: long labels render `[truncateLabel(label, 22)]` (first ~21 chars + `…`), short unchanged, `hasHiddenLabel`/`data-contract` intact; updated the `test-cp2-edge-label-strategy.ts` gate unit test (suppression → truncated-preview, non-tautological) and `test-cp2-dfd-edge-labels.ts` C5/C13; flows-guide note (`80462d2` spec, `66692f2` code). Added at the ship gate per user feedback. Reviewer VERDICT: PASS, 0 findings. Screenshot verified (truncated chips on canvas + full data on hover).
- Verify: `build:cli` clean; `bun run test` exit 0 (973 PASS, 0 FAIL — incl. live hover browser check + gate unit test); tsc 456 total (= baseline, ZERO in touched files); `ignatius validate` clean on the proving model (38 entities) and key-inherited (24 entities).

**Squashed to 12a188c — 2026-06-16.** Per-iteration SHAs above are historical (unreachable from any branch).

## Change log

### 2026-06-16 — inline truncated `…` preview for long labels

**What changed:** Long edge labels (> 22 chars) now render a truncated inline chip — the first ~22 chars + `…` — instead of being suppressed off-canvas. The hover tooltip (already built) still shows the full contents; the `…` is the affordance pointing to it. Short labels (≤ 22) are unchanged. Added as Checkpoint 4; updates the `test-cp2-edge-label-strategy.ts` gate unit test and the dfd-overhaul C5/C13 visual assertions (`test-cp2-dfd-edge-labels.ts`).

**Why:** User feedback at the ship gate — the all-or-nothing gate (full inline vs. fully hidden) made it unclear which edges carried hidden data. A persistent `…` marker shows where more data lives on every dense edge.

**Superseded:** The original spec's non-goal "inline chips render exactly as today" / "long labels suppressed off-canvas (`lines = []`)". The 22-char threshold itself is retained as the truncation point.
