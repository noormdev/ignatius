# DFD edge-hover data reveal

## Problem

DFD edges carry the data passed between processes, stores, and externals. Since
the dfd-overhaul, long data labels are length-gated: an inline chip renders only
when the label is ≤ `SHORT_LABEL_MAX` (22 chars). Longer labels — notably `db:`
column lists — are suppressed off-canvas (`lines = []`, `hasHiddenLabel = true`)
to keep dense diagrams readable. The only way to read that suppressed data today
is the browser-native SVG `<title>` tooltip: unstyled, delayed ~1s, easy to miss,
and capped to a single text blob.

The user wants hovering a connection to reveal **the actual data flowing across
it** — the full contents — immediately and legibly, without re-cluttering the
canvas or requiring a click.

Implements issue #14.

## Goals / Non-goals

- **Goals**
  - On hover over a DFD edge, reveal the full data-flow contents (every item,
    even when the inline chip is suppressed or per-item truncated).
  - Legible at any zoom level (the gated `db:` column lists are the whole point).
  - One item per line; a `source → target` header for orientation.
  - No new canvas clutter when not hovering; no extra click.
- **Non-goals**
  - Editing flow data from the hover surface (issue: out of scope).
  - Changing the inline-chip length gate (`SHORT_LABEL_MAX`) itself (issue: out
    of scope). Inline chips render exactly as today.
  - Node-hover **data aggregation** (a panel of all in/out data for a node). The
    issue's "and/or its endpoint nodes" is satisfied by the edge; node hover keeps
    its existing dim/highlight focus behaviour untouched.
  - Touching the ERD (DG) graph hover — DFD only.

## Current behaviour (grounded)

| Concern | Where | Today |
|---------|-------|-------|
| Edge data | `flow-parse.ts:37,39-44` | `FlowEdge.data: string \| string[]` |
| Joined to label | `flow-layout.ts:285` | `edge.data.join(', ')` → `FlowElementData` edge `label: string` (array lost) |
| Inline gate | `elk-flow-layout.ts:160,171-173` | `isInlineLabel = label.length <= 22` |
| Suppression | `FlowDiagramSvg.tsx:1389,1392` | gate false → `lines=[]`, `hasHiddenLabel=true` |
| Hover state | `FlowDiagramSvg.tsx:883` | `hover: { kind:'node'\|'edge'; id } \| null` — drives dim/highlight only |
| Hover reveal | `FlowDiagramSvg.tsx:685` | native `<title>{label}` (delayed, unstyled) |
| Contract attr | `FlowDiagramSvg.tsx:680-681` | `data-contract`, `data-contract-type` on edge `<g>` |
| Edge click | `FlowDiagramSvg.tsx:1565` | drags the label chip only — no dialog |

So an `hover` state and edge pointer handlers already exist (for dimming). The
gap is a *styled, immediate, multi-line* reveal of the full data.

## Approaches

| # | Approach | Sketch | Cost | Risk |
|---|----------|--------|------|------|
| A | **HTML overlay tooltip** | Capture pointer client coords on edge hover; render a `position:fixed` styled div (sibling of the SVG) listing the data lines + header. | low | tooltip flicker / off-screen clipping near viewport edges |
| B | In-SVG `<g>` tooltip | Draw the box as an SVG group in world coords near the edge `chip` point. | low | text scales with zoom — illegible when zoomed out, the exact failure we're fixing |
| C | Expand the inline chip on hover | On hover, swap the suppressed chip for the full multi-line chip in place. | med | shifts/overlaps neighbouring nodes; re-clutters; fights the gate the overhaul added |

## Recommendation

**Approach A — HTML overlay tooltip.** Zoom-independent legibility is a hard
requirement (the gated content is long `db:` column lists); only a screen-space
HTML element gives constant, readable size. It mirrors the existing
`SpotlightOverlay` precedent (a fixed-position overlay reading hover state). B
fails the legibility goal; C re-introduces the clutter the gate removed.

Mechanics:

- Preserve the **structured** data: add `dataLines: string[]` to the edge variant
  of `FlowElementData` in `buildFlowData` (`flow-layout.ts`) — the array, not the
  lossy `join(', ')`. Thread it onto `EdgeRender`. A pure `normalizeEdgeData(data)`
  helper does the string/array normalisation and is unit-tested.
- Extend the edge hover handlers to capture pointer client coords; store
  `{ edgeId, x, y }`. Render the tooltip from that state.
- Tooltip shows for any edge whose data is non-empty (consistent for inline and
  gated edges alike — the chip truncates per item; the tooltip never does).
- **Replace** the native `<title>` reveal with the styled tooltip (removing the
  delayed, duplicate native box). Keep `data-contract`/`data-contract-type`
  unchanged — they remain the programmatic/accessibility carrier and back the CI
  edge-label assertions. The C13 "disclosed on hover" contract still holds, now
  via the styled tooltip; update the one visual test that asserted `<title>`.

Keep the existing dim/highlight-on-hover focus exactly as-is — the tooltip is
additive.

## Verification

- Pure unit: `normalizeEdgeData` — string, `string[]`, empty/undefined.
- Real-browser Playwright check (CI-runnable, `test/checks/`, skip-if-dist-absent,
  mirrors the keyboard-shortcuts check): hover a known gated `db:` edge in the
  proving model, assert the styled tooltip appears containing the full column
  list; assert it hides on leave; assert `data-contract` still present.
- Visual screenshot (`test/visual/`) for human inspection per the project's
  "Visual changes" rule.

## Open questions

- None blocking. The `source → target` header uses node display labels already
  resolved in the `edgeRenders` builder (`fromNode`/`toNode`).
