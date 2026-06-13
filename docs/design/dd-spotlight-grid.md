# DD spotlight grid

## Problem

The Dictionary view is a reading document: full attribute tables, business narratives, examples. It is good for depth and printing, but carries no sense of *shape* — which entities relate to which, and how densely. Shape currently lives only in the Graph view, which in turn carries no narrative. There is no middle altitude.

## Concept

Add a second lens to the Dictionary view: **browse** — a compact card grid with a hover/click *spotlight*. The existing long-form document becomes the **read** lens and is unchanged.

In the browse lens:

- Each entity renders as a compact card (name, classification badge, group accent, PK, column count) on a responsive CSS grid, grouped under the existing group headers.
- Hovering a card spotlights it: all unconnected cards dim; SVG leader lines are drawn from the card to every *connected, on-screen* card, labeled with the relationship predicate and cardinality, with direction encoded by arrowhead and color.
- Connections to *off-screen* cards render as chips on the spotlighted card ("↓ Invoice · bills") that scroll to and flash the target.
- Clicking a card pins the spotlight (survives mouse-out); Esc or clicking empty grid releases it.

The predicates are the payoff: a spotlit `Party` literally reads as business sentences radiating outward — `makes →` to `Payment`, `← is owned by` from `Account`. This is the project's predicate philosophy made visible (predicates encode business language, not ORM verbs).

### Flow nodes and the cross-domain spotlight

The grid is not just the ERD's shape — it is the *whole* dictionary's shape. Processes, external entities, and non-`db` data stores join the entity cards, each with its own compact card and spotlight. Their connections are data flows (parsed `FlowEdge`s), labeled with the flowing data and pointed by direction.

The payoff specific to this collapse is **cross-domain**: a `db:` data-store endpoint *is* an entity. So spotlighting a process draws a data-flow line straight to the **entity card** it reads or writes, and spotlighting an entity lights up the processes that touch it. That process↔entity view exists in neither the Data Graph (no processes) nor the DFD (which shows a `db:` store as a plain store node, never the rich entity). The unified grid is the only surface where "process `2.3 Capture Payment` writes the `Payment` entity" is a drawn line. The data already exists (`FlowEdge`, `buildEntityUsageIndex`, `buildFlowNodeUsageIndex`); the grid + spotlight + overlay machinery is shared with the entity case.

## Rules

- **Read lens is untouched.** Long-form rendering, DD search highlight (CP9), and the print flow (CP10) behave exactly as today. Printing always prints the read lens: `beforeprint` forces read, `afterprint` restores the prior lens (same save/restore pattern as the CP10 search clear).
- **Search spans both lenses.** The grid filters by the same committed search term and matcher (`nodeMatchesSearch`) as the read lens.
- **The grid spans the whole dictionary.** Entities AND flow nodes — processes, external entities, and non-`db` data stores — appear as cards. Entities are grouped under the existing group headers; flow nodes get their own sections (Processes / External entities / Data stores) below. (A `db:` store is an entity, so it lives in its entity group, not a store section.)
- **Two relationship kinds, visually distinct.** *FK edges* (entity↔entity) come from `modelIndex.edgesBySource` / `edgesByTarget`, labeled with predicate + cardinality. *Data flows* (process↔store/external, and process↔entity via `db:` endpoints) come from the parsed `FlowEdge`s, labeled with the data payload + direction. The two use different line styles (solid vs dashed) and colors so a structural FK never reads as a data flow. Subtype-cluster membership is not drawn.
- **Direction is first-class.** FK: outgoing (this entity holds the FK) vs incoming (referenced by) — arrowhead orientation plus color; mutual pairs bundle into one line with both labels. Data flow: write (process → store) vs read (store → process) — arrowhead toward the data sink.
- **Multi-edges bundle.** Two or more edges between the same pair (e.g. `Order.billing_address` + `Order.shipping_address` → `Address`, or a process that both reads and writes a store) draw one line with stacked labels, never parallel strands.
- **Lines anchor to the facing edges of measured rects.** Card rects are measured from the DOM (cards are variable height). The anchor edge is chosen by the two cards' relative position: vertically-stacked cards anchor top↔bottom, side-by-side cards anchor left↔right — always the edge facing the other card, with the bezier pulling perpendicular to that edge so the line *points at* the node rather than grazing past it. Anchors recompute on scroll/resize/relayout via ResizeObserver + rAF throttle.

## Shape

- Lens state lives in `DictionaryView` (`'read' | 'browse'`), persisted to localStorage so the choice survives reloads. It is not part of the URL hash: a lens is a viewing preference, not a location.
- The lens toggle is a two-button segmented control in the existing sticky search bar — always visible while scrolling.
- Pure connection derivation (`buildSpotlightConnections`) is a framework-free logic module under `src/app/logic/`, unit-tested in `test/checks/` like `model-index` before it.
- The card's ⓘ affordance opens the existing rich `SelectedEntityModal`; the card body itself is the spotlight surface (hover/click-to-pin).

## Approaches considered

1. **Grid mode toggle inside the DD** (chosen) — DD gets two lenses; everything else stays put. Lowest risk, clearly a Dictionary concern.
2. Replace the DD top level with the grid, expanding cards in place — rejected: the long-form reading/printing flow is genuinely good and CP10 depends on it.
3. A fourth top-level view — rejected: Graph/Dict/Flows is the right cardinality; this is a Dictionary lens, not a new place.

## Known tension

Grid placement is arbitrary (group order + alphabetical), so leader lines will cross unrelated cards. That is inherent to grid-not-graph; the dimming is what makes it tolerable. The reference implementation (Understand-Anything's dashboard) dodges this by drawing edges only in true graph views — we accept the crossings because the spotlight dims everything the lines cross.

A scale test (140-node synthetic model, a degree-10 hub pinned) confirmed the limits of dimming alone: a high-degree node's neighbors scatter across the page (alphabetical order, not connectivity), the lines grow long and cross everything, most neighbors fall off-screen as chips, and always-on label pills pile into an unreadable stack near line convergence points. Two mechanisms answer this without abandoning the grid:

- **Hover-reveal labels** bound the text — pills are hidden by default and shown only for the connected card under the pointer, so density never produces a pile-up.
- **Focus / isolate mode** is the real scale answer — pinning a node and focusing collapses the rendered grid to just that node's neighborhood, so the lines stay few and short and nothing goes off-screen, at any model size. The spotlight is a *local subgraph* primitive (one node's neighborhood at a time), unlike the Data Graph which draws the whole edge set; focus mode makes that primitive hold up at scale.

## Prior art

`tmp/Understand-Anything` (Egonex-AI) informed three rules: edge bundling between node pairs (`utils/edgeAggregation.ts`), measured-DOM anchoring (their two-stage ELK layout), and the outgoing/incoming visual split (`NodeInfo.tsx`'s wikilinks vs backlinks).
