# Spec: DD spotlight grid

Design: `docs/design/dd-spotlight-grid.md`

The Dictionary view gains a second lens — **browse**: a compact card grid with a hover/click spotlight that dims unconnected cards, draws labeled leader lines to connected on-screen cards, and lists off-screen connections as scroll-to chips. The grid spans the **whole** dictionary — entities (grouped) plus flow nodes (processes, external entities, non-`db` data stores, in their own sections). The spotlight draws two relationship kinds, visually distinct: **FK edges** between entities (predicate + cardinality) and **data flows** between processes and their stores/externals/entities (data payload + direction). Because a `db:` store endpoint is an entity, a process spotlight reaches entity cards and vice-versa (cross-domain). The existing long-form document is the **read** lens and is byte-for-byte unchanged in behavior (search highlight, print, body links).

Scope note: CP1–CP7 shipped the entities-only foundation (FK spotlight). CP8–CP13 (this amendment) fix the leader-line anchor-edge selection and add flow nodes + the cross-domain data-flow spotlight. The contracts below describe the **current full feature**; the per-checkpoint table records the build order.

## Contracts

### Logic module — `src/app/logic/spotlight.ts` (pure, no DOM/React)

```ts
export type SpotlightEdge = {
  direction: 'out' | 'in';            // out: entityId holds the FK; in: other holds it
  predicate: Predicate;               // from ModelEdge
  cardinality: ModelEdge['cardinality'];
  identifying: boolean;
};

export type SpotlightConnection = {
  otherId: string;
  direction: 'out' | 'in' | 'both';   // merged across bundled edges
  edges: SpotlightEdge[];             // 1+ edges, bundled; insertion order: out edges first, then in
};

export function buildSpotlightConnections(index: ModelIndex, entityId: string): SpotlightConnection[];
```

- Sources: `index.edgesBySource.get(entityId)` (out) and `index.edgesByTarget.get(entityId)` (in). Nothing else — no array scans over `model.edges`.
- All edges to/from the same `otherId` bundle into ONE connection. `direction` is `'both'` when the bundle contains both out and in edges.
- Self-edges (`source === target === entityId`) are excluded.
- Result sorted by `otherId` ascending. Unknown entity / no edges → `[]`, no throw.

### Grid card — `src/app/components/entity/GridCard.tsx`

Compact card: entity name, classification badge (reuse `DictClassificationBadge`), group color accent (left border), PK column list, column count. ⓘ affordance opens the rich `SelectedEntityModal`: `DictionaryView` gains a new prop `onOpenEntity: (id: string) => void` (its prop interface currently has no entity-open callback — this is an interface addition), and `App.tsx` passes `openEntityById` for it at the existing `DictionaryView` render site. Card body hover/click drives the spotlight (below) — the ⓘ click must not also pin (stopPropagation).

### Flow-node grid cards (CP10) — `src/app/components/.../*GridCard.tsx`

Compact cards for the three flow-node kinds, same hover/click spotlight surface and ⓘ affordance as the entity card. The builder may add small components alongside `GridCard` or extend it with a `kind` — keep them compact and consistent with the entity card's shape.

- **Process card** — dotted number + process label + a kind accent. ⓘ opens the process's dialog (the existing `FlowNodeModal` path the read-lens process card uses).
- **External card** — external display name + an external/kind accent. ⓘ opens the external's `FlowNodeModal`.
- **Data-store card** — store display name + the `kind` color accent (reuse the flow-kind palette). ⓘ opens the store's `FlowNodeModal`. (Non-`db` only — `db:` stores are entity cards.)

The ⓘ routing for flow nodes reuses whatever the read lens already calls to open each kind's dialog; do not invent a new modal path. As with entities, the ⓘ click stops propagation so it doesn't also pin the spotlight.

### Lens toggle — in `DictionaryView`

- State `lens: 'read' | 'browse'`, default `'read'`, persisted to localStorage key `ignatius-dict-lens` (read once on mount; invalid stored value → `'read'`).
- Two-button segmented control rendered inside the existing sticky `.dict-search` bar (always visible while scrolled).
- `beforeprint` forces the read lens; `afterprint` restores the prior lens — same ref-based save/restore pattern as the existing CP10 search clear, registered in the same effect style (stable refs, empty deps).
- Browse lens renders, in order: entity group headers (existing order: `sort_key`, then alphabetical) each with a CSS grid of entity GridCards, then — when flows exist — a **Processes** section, an **External entities** section, and a **Data stores** (non-`db`) section, each with a CSS grid of the corresponding flow-node cards (CP10). Processes sort by dotted number (reuse `compareDottedProcesses`); externals/stores alphabetically. Processes/externals reuse the read lens's `allProcessesDeep` / `allExternals`.
- **Data stores: the browse grid shows EVERY non-`db` store referenced by the flows (CP18)** — the full deduped `storeByName` set (all `d.storeRefs` with `kind !== 'db'`, already computed in `DictionaryView` at the `storeByName` map but currently unused for rendering), NOT the read lens's `bodyHtml`-filtered `allNonDbStores`. A store referenced by a flow edge (e.g. `queue:OrderIntake`) but lacking a `stores/*.md` doc file at the model root MUST still appear as a compact grid card, because the spotlight can draw a line/chip to it and the DFD view already shows it; dropping it leaves a dead chip with no card to scroll to. The compact store card's ⓘ opens the store's `FlowNodeModal`, which renders gracefully for an undocumented store (name + kind + the processes that touch it via CP21) — it does not require a body.
  - **Concrete code sites that switch to the full `storeByName` set:** the browse-lens Data-stores card rendering (the `visibleStores` derivation), and the browse store visibility/search set (`visibleStoreNames`, both the no-search and search branches).
  - **Sites that STAY on `allNonDbStores` (read-lens, unchanged):** the read-lens store section rendering; `ddNonDbStoreNames` (CP25 read-lens IO endpoint clickability — an undocumented store stays non-clickable in the read-lens process card, which is correct); and `allKnownIds` (read-lens wiki-link upgrade). Do not flip these.
- The grid filters by the same committed search term — entities via `nodeMatchesSearch`, flow nodes via the existing `processMatchesSearch` / `externalMatchesSearch` / `storeMatchesSearch`; any section (or entity group) with zero matches collapses (header hidden), matching read-lens behavior.

### Flow connection logic — `src/app/logic/flow-spotlight.ts` (pure, no DOM/React)

```ts
export type FlowSpotlightEdge = {
  direction: 'out' | 'in';   // out: active node is the data SOURCE (from); in: active is the SINK (to)
  data: string;              // FlowEdge.data, array payloads joined with ", "
};

export type FlowSpotlightConnection = {
  otherCardId: string;       // grid card id of the other endpoint (see resolution below)
  direction: 'out' | 'in' | 'both';
  edges: FlowSpotlightEdge[]; // bundled; out edges first, then in
};

export function buildFlowSpotlightConnections(
  diagrams: FlowDiagram[],
  activeToken: string,       // an endpoint token (see token scheme below)
): FlowSpotlightConnection[];
```

**Canonical token scheme** (one form, no ambiguity). There are two id namespaces on the grid:

- **Entity card id** = the bare entity id `<name>` (matches the modelIndex node id and the read-lens `#entity-<id>` anchor). An entity's *flow-lookup token* is `db:<name>` — its flow connections are the `FlowEdge`s whose endpoint is `db:<name>`.
- **Flow-node card id** = `FlowEndpoint.raw`, i.e. the literal `"<kind>:<name>"` string (`proc:<id>`, `ext:<id>`, `cache:<name>`, `file:<name>`, …). A flow node's flow-lookup token equals its card id.

`activeToken` is therefore always a `"<kind>:<name>"` endpoint string (the entity case passes `db:<entityId>`).

- Walks every `FlowEdge` across all diagrams **and sub-DFDs** (reuse the same deep walk `buildFlowNodeUsageIndex` uses). For each edge where the active node is an endpoint (`from.raw` or `to.raw` equals `activeToken`), emit a connection to the *other* endpoint.
- **`otherCardId` resolution.** A `db:<name>` other-endpoint resolves to the entity card id `<name>` (this is the cross-domain link). Every other kind resolves to `<kind>:<name>` (the other endpoint's `raw`). So returned `otherCardId`s land in the correct id namespace and match grid card ids directly.
- Bundle all edges to the same `otherCardId` into ONE connection; `direction` is `'both'` when both out and in occur (a process that reads and writes the same store). Out edges precede in edges in `edges`.
- Self-edges excluded. Sorted by `otherCardId`. Unknown token / no edges → `[]`, no throw.
- This module is **search-agnostic and structural** — it returns every real `FlowEdge` connection regardless of what is currently rendered. The rendering layer (overlay/chips) is what filters to cards actually present on the grid and on-screen: a connection whose target card is absent from the grid (e.g. a card hidden by the active search filter) draws neither a line nor a chip — and this filter MUST be enforced so no dead chip ever renders for a card that isn't on the grid (CP18). After CP18 ships, every flow-referenced non-`db` store is a grid card, so the former common case of an absent store no longer occurs; the absent-card guard remains as the safety net for search-hidden cards. Resolution never depends on search state.

### Spotlight interaction — in `DictionaryView` (browse lens only)

- `hoverId` (mouseenter/mouseleave on cards) and `pinnedId` (click toggles; Esc or click on empty grid area clears). Active spotlight = `pinnedId ?? hoverId`. The active id is the **card id** per the token scheme above — a bare entity id for entity cards, a `"<kind>:<name>"` raw for flow-node cards.
- The active node's **connected-card set** is the union of: its FK connections (`buildSpotlightConnections`, only when the active card is an entity — keyed by the bare entity id) and its flow connections (`buildFlowSpotlightConnections`, called with the active card's flow-lookup token: `db:<entityId>` for an entity card, the card's own raw for a flow-node card). Every card that is neither the active card nor in that union gets a dim class (CSS opacity transition, selector-driven — no per-card inline style). For an entity, this means FK-related entities *and* the processes that touch it both stay lit.
- Lens switch and search-term change clear `pinnedId`.

### Focus / isolate mode (CP15) — in `DictionaryView` (browse lens only)

The grid is ordered by group then alphabetically, not by connectivity, so a node's connected cards scatter across the page and most fall off-screen. Focus mode is the scale answer: it collapses the rendered grid to just the active node's neighborhood, so the lines are few, short, and all on-screen at any model size.

- A **Focus** affordance is available while a card is pinned (a control on/near the active card, or a FAB item — builder's placement). Activating it sets `focusId = pinnedId`.
- While `focusId` is set, the browse grid renders ONLY the cards in `{focusId} ∪ connected-card-set(focusId)` — every other entity and flow-node card is removed from the grid (not merely dimmed). The connected-card-set is computed identically to the spotlight dimming rule in the Spotlight interaction contract above (FK ∪ flow connections via `buildSpotlightConnections` / `buildFlowSpotlightConnections`), so for a flow-node active card the neighborhood already includes its cross-domain `db:` entity cards, and for an entity it includes both FK entities and the processes that touch it. Section headers (entity groups + Processes/Externals/Stores) render only when they contain a visible card. The cards reflow to pack together, so the spotlight lines are short and there are no off-screen chips.
- The active card stays visually marked (spotlit); the neighbors render normally (no dimming needed — everything shown is connected). Leader lines + hover-reveal labels (CP14) work exactly as in the full grid.
- Exit focus: an explicit "show all" affordance, Esc, or unpinning clears `focusId` and restores the full grid. Search and focus are mutually exclusive: a search-term change while focused clears `focusId` (search wins), and activating Focus clears any active search term (focus becomes the active filter). So the two never compose.
- `focusId` is component state only — not in the URL hash (consistent with the lens/spotlight not being hash state).

### Leader-line overlay — `src/app/components/entity/SpotlightOverlay.tsx`

- One `<svg>` overlay spanning the grid. **Behavior contract: lines stay correctly anchored to their cards while the dictionary scrolls and across window resizes / grid relayouts** — no detached or lagging lines. Anchors are measured card rects (cards are variable height; never assume heights), recomputed via a rAF-throttled callback driven by a `ResizeObserver` on the grid container plus window resize. The positioning strategy (scroll-static overlay vs scroll-tracking) is the builder's, as long as the contract holds.
- For the active card, draws one path per connection whose target card intersects the `.dict-view` scrollport.
- **Anchor-edge selection (CP8).** The anchor edge on each card is the one *facing* the other card, chosen by their relative position: when the cards are vertically stacked (the vertical center-to-center gap dominates the horizontal one) anchor at the bottom edge of the upper card and the top edge of the lower card; otherwise anchor at the left/right edges. The bezier control points pull *perpendicular to the chosen edge* (vertically for top/bottom anchors, horizontally for left/right) so the line and its arrowhead **point into** the card rather than grazing the far edge. This fixes the prior always-left/right behavior, where a connection to a card directly above/below exited the side and the arrowhead entered the target's far edge (looked like it was exiting, not pointing at, the node). The arrowhead always sits at the anchor point on the *facing* edge.
- Direction encoding — FK lines: arrowhead at the far end for `out`, at the near end for `in`, both ends for `both`; `out` and `in` use distinct stroke colors (theme-var driven, dark+light). Data-flow lines: arrowhead points to the data sink (toward the `write` target / away from the `read` source).
- **Two line styles.** FK lines are solid, colored by `--spotlight-line-out` / `--spotlight-line-in`. Data-flow lines are dashed, colored by `--spotlight-line-flow` (a third theme var, dark+light, distinct from both FK colors) so a structural FK never reads as a data flow on the same canvas.
- **Labels are hover-revealed, not all-at-once (CP14).** At typical density many line midpoints land near each other and always-on pills pile into an unreadable stack. So: by default a leader line draws with NO label pill (line + arrowhead only). The pill is revealed for the connection(s) to whichever **connected (lit) card the pointer is over** — the primary trigger is `mouseenter` on a connected card's DOM node (NOT geometric proximity to a line; hovering an unrelated card the line merely crosses reveals nothing). The builder MAY additionally reveal on hovering the leader-line `<path>` itself (requires opting the path into pointer events), but that is optional — card-hover is the contract. At most one card's worth of pills shows at a time. Because pinned wins over hover (CP3: active = `pinnedId ?? hoverId`), in pinned mode hovering a connected card reveals that relationship's label without changing the active node — the "probe each relationship" interaction. When a single hovered card has multiple bundled edges (so multiple pills show together), apply a collision-avoidance nudge so they don't overlap. In **focus mode** (CP15), where only the neighborhood is rendered, pills may be shown always-on (the few cards leave room) — builder's choice, but the full-grid default is hover-reveal.
- Pill contents (when revealed) — FK: `fwd` text for out edges, `rev` for in; bundled multi-edges stack one label per edge, each with its own cardinality chip. Data-flow: the data payload string (`FlowEdge.data`; array payloads join with `, `); bundled read+write to the same node stack both.
- Cardinality chip display (FK only): the literal text `` `${cardinality.parent} → ${cardinality.child}` `` (e.g. `1 → many`), **always parent-first regardless of spotlight direction**. Orientation fact (verified in `parse.ts` `deriveCardinality`): `edge.source` is the child/FK-holding entity, `edge.target` is the parent/referenced entity; `cardinality.parent` describes the target side, `cardinality.child` the source side. So for an `out` edge the active card is the *child* side. Do not flip the chip by direction — the chip reads the relationship, not the hover. Data-flow lines carry no cardinality chip.
- Connections whose target card is OUTSIDE the scrollport render no line; they appear as chips (next contract).

### Off-screen chips

- Rendered on the active card: one chip per off-screen connection, `<arrow> <Name> · <label>` where the arrow glyph is ↑/↓ by target position. FK connections use the predicate (`fwd`/`rev`, `fwd ⇄ rev` for a both-bundle); flow connections use the data payload. Click scrolls the target card into view (`scrollIntoView` smooth, block center) and flashes it (temporary CSS class, animation ~1.2s, class removed on animationend).
- Chips do not change card layout of *other* cards (no grid reflow on hover); they overlay or extend only the active card.

### CSS — `src/app/styles.css`

New classes under the DictionaryView section: `.dict-lens-toggle`, `.dict-grid`, `.dict-grid-card`, dim/spotlit modifiers, `.spotlight-overlay`, chip + flash classes, plus flow-node card classes and the flow-section headers (CP10). Theme vars for line colors — `--spotlight-line-out` / `--spotlight-line-in` (FK, existing) and `--spotlight-line-flow` (data flow, new) — in both modes via `applyThemeCssVars` defaults, following the existing `--dd-search-highlight` pattern (runtime var + CSS fallback). The `@media print` block hides all browse-lens chrome (belt-and-braces on top of the forced read lens).

### DD chrome layout — outer scroll + fixed top search bar (CP17)

Two layout fixes to the Dictionary chrome, applying to BOTH lenses:

- **Outer container scrolls (scrollbar at the window edge).** Today `.dict-view` is the fixed full-height scroller AND carries `max-width: 1100px; margin: 0 auto`, so the scroll box is only 1100px wide and its scrollbar lands mid-page. Split the roles: `.dict-view` becomes the full-viewport-width fixed scroll container (`inset: 0; overflow-y: auto`, no max-width), and an inner content wrapper (`.dict-view-inner` or equivalent) carries `max-width: 1100px; margin: 0 auto` + the content padding. Result: the vertical scrollbar sits at the right edge of the window; the card content stays centered at ≤1100px.
- **Overlay anchoring is a requirement, not a hope.** After the restructure, `SpotlightOverlay` MUST still anchor every leader line to its card correctly under scroll and resize — the existing CP4/CP8 anchor-tracking assertions must still pass unchanged. (It measures viewport-space card rects, so absolute positioning should be unaffected, but this is a verified contract, not an assumption.)
- **Search + lens toggle become a fixed top bar.** Move `.dict-search` (input) and `.dict-lens-toggle` (Read/Browse) OUT of the scrolled content into a fixed bar at the top of the viewport, rendered by `DictionaryView` (so it only appears in the dict view) but positioned `fixed`. The prior sticky-search bleed CSS (negative margins, `top: -72px`) is removed. `.dict-view` top padding is adjusted so the first cards clear the fixed bar.
  - **Frosted background.** The bar carries `backdrop-filter: blur(10px)` (+ `-webkit-` prefix) like `.branding-block`, PLUS a *semi-transparent* background-color (e.g. `color-mix(in srgb, var(--color-background) 75%, transparent)`, or an rgba) — NOT a fully opaque fill and NOT fully transparent. The semi-transparent fill keeps the content readable through the blur and keeps the bar's computed `background-color` non-`rgba(0,0,0,0)` (so the sticky-search test's non-transparent-background check still holds).
  - **No collision with branding / theme toggle.** The bar is centered with a bounded width matching the content column (`max-width ≤ 1100px`, `margin: 0 auto`) so its edges never reach the branding block (fixed top-left) or the theme toggle (fixed top-right). Its z-index sits above the scrolled content but does not need to exceed the branding/toggle layer (`z-index: 50`) — branding and toggle remain on top and clickable. If the bounded-width approach still risks overlap at some widths, inset the bar's left past the branding and right past the toggle/FAB instead.
- **Focus bar** (CP15) is a normal-flow element rendered as the first child of the scrolled content (not positioned), so the `.dict-view` top padding that clears the fixed search bar already pushes it below the bar. Just confirm the top padding is sufficient that the focus bar (and first cards) never sit under the fixed bar.
- **Read-lens behavior unchanged**: the search input keeps the SAME React state binding and the CP-era debounce — CP9 highlight keys off the controlled state value (not the input's DOM location), and CP10 print still clears + restores it. The DOM move is purely presentational.

## Checkpoints

The visual test `test/visual/test-dd-spotlight-grid.ts` (Playwright, `models/key-inherited`, follows the `test-cp9-dd-search-highlight.ts` pattern — no `networkidle`, SSE keeps the connection open) is **built incrementally**: CP2 creates it with its own assertions; CP3–CP5 each extend it with theirs. Every checkpoint is therefore independently verifiable by running the script as it exists at that checkpoint.

| # | Deliverable | Verify |
|---|-------------|--------|
| CP1 | `src/app/logic/spotlight.ts` + `test/checks/test-spotlight-connections.ts` (bundling, both-direction merge, self-edge exclusion, sort, empty/unknown id, out-before-in edge order) | `bun test/checks/test-spotlight-connections.ts` |
| CP2 | Lens toggle + GridCard + grid rendering + `onOpenEntity` wiring. Visual test created with assertions: toggle renders in sticky bar; browse lens shows a grid card per entity (count vs `/api/model` nodes); search filters grid cards; lens persists across reload (localStorage); print emulation (`page.emulateMedia({ media: 'print' })`) shows read-lens DOM; ⓘ opens entity modal | typecheck (src/ adds no new errors) + `bun test/visual/test-dd-spotlight-grid.ts` |
| CP3 | Spotlight state + dimming. Test extended: hover a known entity and assert the lit set is EXACTLY {active} ∪ connected ids — compute the expected set in-page from `window.__MODEL__`-derived edges (or fetch `/api/model`), not hardcoded — and all other cards carry the dim class; pin survives mouse-out; Esc releases; empty-grid click releases; lens switch + search change clear pin. This count assertion is the validation gate for the design's "Known tension" (dimming makes line crossings tolerable) | `bun test/visual/test-dd-spotlight-grid.ts` |
| CP4 | `SpotlightOverlay` leader lines. Test extended: `<path>` count equals on-screen connection count for a pinned entity; predicate label text present (e.g. a known predicate from key-inherited); distinct stroke colors for out vs in; anchors track a window resize (resize viewport, assert line endpoint within tolerance of card rect) | `bun test/visual/test-dd-spotlight-grid.ts` |
| CP5 | Off-screen chips. Test extended: pin an entity with off-screen connections; chip rendered with arrow + name + predicate; click scrolls target into scrollport and flash class appears then clears | `bun test/visual/test-dd-spotlight-grid.ts` |
| CP6 | Full visual review: run the complete script; capture + REVIEW screenshots dark + light (spotlight active, pinned, chips visible); confirm read lens byte-identical behavior (CP9 highlight + CP10 print tests still pass) | `bun test/visual/test-dd-spotlight-grid.ts` + `bun test/visual/test-cp9-dd-search-highlight.ts` + screenshots reviewed |
| CP7 | Docs: CLAUDE.md feature-map row — Feature: "DD browse lens: spotlight grid (cards, hover/pin spotlight, predicate leader lines, off-screen chips)", Design: `dd-spotlight-grid`, Spec: `dd-spotlight-grid`, Guide: `—`, Skill: `—` | row present; `bun run typecheck` (src/ adds no new errors) + full `bun run test` |

CP8–CP13 (branch expansion): leader-line anchor-edge fix, then flow nodes + cross-domain data-flow spotlight. The visual test continues to be extended in place; each checkpoint is independently verifiable by running it.

| # | Deliverable | Verify |
|---|-------------|--------|
| CP8 | Anchor-edge selection fix in `SpotlightOverlay`: vertically-stacked cards anchor top↔bottom (facing edges), side-by-side anchor left↔right; bezier pulls perpendicular to the chosen edge. Test extended: pin an entity with a connected card directly above/below it (e.g. `PaymentMethod`→`PaymentMethodType`, which share a grid column), assert the line's endpoint on the target sits on its *facing* (bottom/top) edge — within half the target card's height of the facing-edge midpoint, and on the correct side (target above active → endpoint at target's bottom edge; the endpoint's distance to the facing edge is much smaller than to the far edge) | `bun test/visual/test-dd-spotlight-grid.ts` |
| CP9 | `src/app/logic/flow-spotlight.ts` + `test/checks/test-flow-spotlight-connections.ts`: `buildFlowSpotlightConnections(diagrams, token)` — deep walk, endpoint→card-id resolution (esp. `db:`→entity), bundling, both-direction merge, self-edge exclusion, sort, empty/unknown token. Build literal `FlowDiagram[]` fixtures like `test-entity-usage-index.ts` does | `bun test/checks/test-flow-spotlight-connections.ts` |
| CP10 | Flow-node grid sections + compact cards (Processes/Externals/Data stores; sort; search filter; ⓘ routes to the existing per-kind dialog). Test extended: browse lens shows a Processes section with a card per process (count vs `/api/flow`); search filters them; ⓘ on a process opens its dialog | `bun test/visual/test-dd-spotlight-grid.ts` |
| CP11 | Unified spotlight + dimming across kinds: active flow node lights its data-flow-connected cards; active entity lights FK-connected entities AND processes that touch it. Test extended: pin a process, assert lit set = {process} ∪ its flow-connected card ids (incl. at least one `db:` entity card) computed from `/api/flow`; pin an entity that a process writes, assert that process stays lit | `bun test/visual/test-dd-spotlight-grid.ts` |
| CP12 | Data-flow leader lines: dashed, `--spotlight-line-flow` color (dark+light), data-payload label, arrow to sink; entity active card renders BOTH solid FK lines and dashed data-flow lines; off-screen flow connections render as chips. Test extended: pin a process, assert a dashed `.spotlight-line` to an entity card (reached via a `db:` endpoint) with the data payload as label; assert flow line stroke = flow var, distinct from FK vars; cross-domain chip present when target off-screen | `bun test/visual/test-dd-spotlight-grid.ts` |
| CP13 | Full visual review dark+light (process spotlight reaching an entity card; entity spotlight showing FK + data-flow lines together; anchor-fix on a stacked pair) — screenshots REVIEWED; read-lens regressions (CP9 highlight, CP10 print, sticky-search) still PASS. Docs: update the CLAUDE.md feature-map row to name flow nodes + cross-domain; spec implementation-log entry | `bun test/visual/test-dd-spotlight-grid.ts` + `bun test/visual/test-cp9-dd-search-highlight.ts` + `bun test/visual/test-cp10-dd-print.ts` + screenshots reviewed + full `bun run test` |

CP14–CP15 (declutter + scale): hover-reveal labels, then focus/isolate mode. Same incremental visual test.

| # | Deliverable | Verify |
|---|-------------|--------|
| CP14 | Hover-reveal labels in `SpotlightOverlay`: leader lines draw with NO pill by default; the pill(s) for a connection reveal when the pointer is over that connected (lit) card; multiple bundled pills on one hovered card are collision-nudged so they don't overlap. Works in pinned mode (hovering a connected card reveals its label without retargeting). Test extended: pin a known entity that has ≥1 on-screen connected card (e.g. the same entity CP4 uses) and assert at least one `<path>` exists, then assert ZERO label pills are rendered initially; hover a connected card, assert its pill(s) appear and disappear on mouse-out; for a card with ≥2 bundled edges, assert the revealed pills' bounding boxes don't overlap | `bun test/visual/test-dd-spotlight-grid.ts` |
| CP15 | Focus / isolate mode: a Focus affordance while pinned sets `focusId`; the browse grid then renders only `{focusId} ∪ connected-card-set`, headers only for non-empty sections, cards reflow to pack; exit via show-all / Esc / unpin / search clears it; activating Focus clears any active search. Test extended using the 140-node synthetic model (`bun scripts/gen-synthetic-model.ts --n 140 --out tmp/<dir>`, serve it): pin a high-degree node (pick the max-degree node from `/api/model` edges), activate Focus, assert the rendered grid-card count == |{active} ∪ connected| (everything else removed from DOM, not just dimmed) and zero off-screen chips; exit restores the full card count. Capture + REVIEW a focus-mode screenshot on the synthetic hub showing few cards + short labeled lines | `bun test/visual/test-dd-spotlight-grid.ts` |

CP16 (final review): full visual review dark+light of CP14+CP15 on both key-inherited and the synthetic hub; read-lens regressions still PASS; update the CLAUDE.md feature-map row to also name **hover-reveal labels** and **focus/isolate mode**; spec implementation-log entry. Verify: the full visual test + the two read-lens regression tests + full `bun run test`.

CP17 (DD chrome layout): outer-scroll restructure + fixed top search bar, per the "DD chrome layout" contract.

| # | Deliverable | Verify |
|---|-------------|--------|
| CP17 | `.dict-view` full-width scroll container + inner max-width content wrapper (scrollbar at window edge); `.dict-search` + `.dict-lens-toggle` lifted to a fixed top bar with semi-transparent + `backdrop-filter` frosted background, centered/bounded so it never overlaps branding or theme toggle; sticky-bleed CSS removed; read-lens behavior unchanged. Test assertions (concrete): (a) the scroll container `clientWidth` ≥ viewport width − 20px (scrollbar at the WINDOW edge, NOT ~340px short at the 1100px box); (b) the search bar is `position: fixed` and its `getBoundingClientRect().top` is unchanged (±2px) after a deep scroll; (c) `getComputedStyle(bar).backdropFilter` matches `/blur\(\d+px\)/`; (d) the bar's computed `backgroundColor` is NOT `rgba(0, 0, 0, 0)`; (e) the inner content wrapper `getBoundingClientRect().width` ≤ 1100px and is horizontally centered; (f) both Read and Browse render correctly; (g) the no-overlap check (precondition: pin a card, then activate Focus so the focus bar is in the DOM — fail if it isn't) — assert the focus bar's `boundingBox().y` ≥ the search bar's `boundingBox().y + height`; (h) the CP4/CP8 anchor-tracking assertions still pass. Update `test/visual/test-dd-sticky-search.ts` for the fixed (not sticky-within-content) bar — keep the non-transparent-bg + content-scrolls-behind + debounce checks, drop any sticky-margin-specific assertion. Re-confirm read-lens regressions (CP9 highlight, CP10 print) and the full CP2–CP15 grid. Screenshots reviewed dark+light | `bun test/visual/test-dd-spotlight-grid.ts` + `bun test/visual/test-dd-sticky-search.ts` + `bun test/visual/test-cp9-dd-search-highlight.ts` + `bun test/visual/test-cp10-dd-print.ts` + screenshots reviewed |

CP18 (complete store population + dead-chip fix): the browse-grid Data Stores section shows EVERY flow-referenced non-`db` store; chips/lines never render for a card absent from the grid.

| # | Deliverable | Verify |
|---|-------------|--------|
| CP18 | Browse-grid Data Stores section renders the full deduped `storeByName` set (all non-`db` `d.storeRefs`), not the `bodyHtml`-filtered `allNonDbStores` — so an undocumented store like `queue:OrderIntake` appears as a compact card (kind color, ⓘ → `FlowNodeModal`). The store-card spotlight-token set, focus connected-set, and search filter all use this full set (see the named code sites in the contract). ALSO: enforce the absent-card guard so a spotlight chip/line is rendered ONLY when the target card is actually present in the grid (no dead "Scroll to X" chip). Read lens unchanged. New test assertions in `test/visual/test-dd-spotlight-grid.ts` (key-inherited has `queue:OrderIntake` undocumented): (a) browse lens shows a Data-stores card with `data-flow-token="queue:OrderIntake"`; (b) pin `Validate-Customer` (1.1), assert its `OrderIntake` connection (chip or line) resolves to that EXISTING card, and clicking the chip scrolls the card into view (not a dead link); (c) assert that for the pinned node, every rendered chip's target token corresponds to a card present in the grid (no chip whose `data-flow-token`/entity id is absent from the DOM); (d) re-run read-lens regressions (CP9 highlight, CP10 print) unchanged. Screenshot the Data Stores section showing OrderIntake, reviewed | `bun test/visual/test-dd-spotlight-grid.ts` + `bun test/visual/test-cp10-dd-print.ts` + screenshots reviewed |

## Non-goals

- Subtype-cluster membership as a drawn connection.
- Process-to-process lines via shared stores (SSADM has no direct process↔process flow; we draw only the actual `FlowEdge`s, so a shared store shows as two lines through the store card, never a synthesized process↔process line).
- Path-finding between two pinned cards (future).
- Hash/URL state for the lens or spotlight.
- Any change to read-lens rendering, CP9 search highlight internals, or CP10 print behavior beyond the lens force/restore wrapper.

## Change log

- 2026-06-12 — Initial spec.
- 2026-06-12 — Spec-review round 1: contracted `onOpenEntity` prop addition; cardinality chip orientation pinned to verified parse.ts fact (source=child, target=parent), parent-first always; overlay anchoring restated as behavior contract (positioning strategy is builder's); visual test made incremental so CP2–CP5 are independently verifiable; CP3 lit-set count assertion added as the validation gate for the design's known tension; CP7 feature-map row contents named.
- 2026-06-12 — Branch-expansion amendment (CP8–CP13). Scope grew from entities-only to the whole dictionary: flow nodes (processes/externals/non-`db` stores) join the grid and the cross-domain data-flow spotlight links processes to entity cards via `db:` endpoints. Body rewritten to current full scope; "processes/externals/stores on the grid" removed from non-goals; new contracts added (flow connection logic, flow grid cards, two line styles, unified spotlight). Also folds a CP4 anchoring bug fix (CP8): leader lines now anchor on the facing edge by relative card position (top/bottom vs left/right) instead of always left/right — a connection to a card directly above/below no longer exits the side and enters the target's far edge.
- 2026-06-12 — Spec-review round 2 (expansion): pinned a single canonical token scheme (entity card id = bare id, flow-node card id = `FlowEndpoint.raw` `"<kind>:<name>"`; entity flow-lookup token = `db:<id>`; `db:` other-endpoint resolves to bare entity id) and reconciled the Spotlight-interaction section to it; stated `buildFlowSpotlightConnections` is search-agnostic/structural (rendering filters to present cards; search-hidden never alters resolution); noted `allNonDbStores` is the `bodyHtml !== undefined` population (no widening); tightened the CP8 facing-edge tolerance.
- 2026-06-13 — Declutter spec-review round: fixed the CP4 implementation-log line that still described always-on midpoint pills (marked superseded by CP14); CP14 trigger pinned to card `mouseenter` (line-hover optional, not geometric proximity); CP15 connected-set tied explicitly to the unified spotlight rule (cross-domain for flow-node active); CP15 search/focus entry+exit made mutually exclusive both ways; CP15 count assertion fixed to the synthetic hub only (key-inherited too small to falsify); CP14 test entity constrained to one with an on-screen connection; CP16 row text named.
- 2026-06-13 — Declutter + scale amendment (CP14–CP16).
- 2026-06-13 — DD chrome layout amendment (CP17). Two layout fixes: the scroll container moves from the 1100px-wide content box to the full viewport width (scrollbar at the window edge, not mid-page), with content centered in an inner max-width wrapper; the search input + Read/Browse toggle lift from sticky-inside-content to a fixed top bar with the frosted `backdrop-filter` background used by the branding/floating chrome, between branding and the theme toggle. Sticky-bleed CSS removed; read-lens behavior unchanged.
- 2026-06-13 — Store-population fix amendment (CP18). A user spotted that `queue:OrderIntake` (a flow-referenced store with no `_stores/*.md` doc file) was missing from the browse grid's Data Stores section yet the spotlight still drew a dead chip to it. Root cause: the grid used the `bodyHtml`-filtered `allNonDbStores`. Fixed: the browse grid now shows EVERY non-`db` store referenced by the flows (full `storeByName`), so undocumented stores appear as compact cards; and the chip/line rendering enforces the absent-card guard so no dead chip ever renders. The earlier CP10/CP9 notes that said undocumented stores are "not a grid card" are superseded. Read lens unchanged.
- 2026-06-13 — CP17 spec-review round: overlay anchoring restated as a verified requirement (not a remark); frosted bar pinned to semi-transparent bg + `backdrop-filter` (keeps the non-transparent-bg test valid; `.branding-block` is blur-only); collision rule made concrete (centered, bounded ≤1100px, branding/toggle stay on top at z-50); focus bar clarified as normal-flow first child (top padding handles clearance); CP17 verify assertions made falsifiable (clientWidth ≥ viewport−20px, backdrop-filter regex, focus-bar-below-search boundingBox check, anchor assertions still pass). A scale test (140-node synthetic model, hub pinned) confirmed always-on label pills pile up and that high-degree nodes on the arbitrary grid scatter their neighbors. Label-pill contract changed from always-on to **hover-reveal** (default hidden; revealed for the hovered connected card's connection(s); bundled pills collision-nudged). Added a **focus/isolate mode** contract: pinning + Focus collapses the rendered grid to the active node's neighborhood (cards removed, not dimmed), so lines stay few/short and nothing goes off-screen at any model size. CP14 (hover-reveal), CP15 (focus mode), CP16 (final review) added.

## Implementation log

Shipped CP1–CP7 via the autopilot subagent loop (worktree `dd-spotlight-grid`). All seven checkpoints green; every reviewer finding addressed in-iteration (none deferred).

- **CP1** `src/app/logic/spotlight.ts` + `test/checks/test-spotlight-connections.ts` — pure `buildSpotlightConnections(index, id)`, bundles per `otherId` (out-before-in, `both` when mixed), self-edges excluded, sorted. 11 assertions. Reviewer PASS first round.
- **CP2** `GridCard.tsx` + lens toggle in `DictionaryView` + `onOpenEntity` wiring in `App.tsx`. Browse/read lenses, localStorage `ignatius-dict-lens`, print forces read. Findings folded: print save/restore resets `savedLensRef` after restore; reader legend gated to read lens; ⓘ-modal test assertion tightened to `.modal-backdrop`.
- **CP3** spotlight state + dimming. Blocking finding fixed: dropped `pointer-events: none` from the dim class (dimmed cards stay interactive — hover retargets, ⓘ still opens); spotlight state moved above `switchLens`; `hoverId` cleared on lens switch.
- **CP4** `SpotlightOverlay.tsx` — leader lines, amber out / teal in (theme vars `--spotlight-line-out`/`--spotlight-line-in`, dark+light), arrowheads encode direction (`auto-start-reverse` so in-arrows point at the active card), midpoint pill stacks one predicate label per bundled edge with a parent-first cardinality chip (the always-on placement here was **superseded by CP14 hover-reveal** — pills now hidden by default, revealed on connected-card hover); rAF-throttled anchoring on scroll/resize/ResizeObserver. Blocking finding fixed: in-arrowhead orientation. Added per-path stroke-mapping + rev-text + cardinality-orientation assertions.
- **CP5** off-screen chips — connections outside the scrollport render as chips (arrow + name + predicate; `fwd ⇄ rev` for a both-bundle) instead of lines; click scrolls + flashes the target; a connection is exactly line-or-chip via a shared on-screen set.
- **CP6** light-mode visual coverage added to the test (theme toggled via the real `.theme-toggle`); read-lens regressions (CP9 search highlight, CP10 print, sticky-search + debounce) all still PASS.
- **CP7** CLAUDE.md feature-map row + this log.

CP8–CP13 (branch expansion — flow nodes + cross-domain) shipped via the same loop; every reviewer finding addressed in-iteration.

- **CP8** Leader-line anchor-edge fix: lines pick the facing edge by relative card position (vertically-stacked → top/bottom, side-by-side → left/right) with the bezier pulling perpendicular, so a connection to a card directly above/below points into the facing edge instead of exiting the side into the far edge. Test asserts the endpoint lands on the facing-edge midpoint of a stacked pair. Findings folded: AND-matcher + robust last-coord extraction in the test; tie-break + degenerate-case comments.
- **CP9** `src/app/logic/flow-spotlight.ts` + `test/checks/test-flow-spotlight-connections.ts` — pure `buildFlowSpotlightConnections(diagrams, token)`: deep-walks every `FlowEdge` across diagrams + sub-DFDs, resolves endpoints to grid card ids (`db:<name>`→bare entity id for cross-domain, else `kind:name` raw), bundles per `otherCardId`, joins array payloads. 15 assertions (T8 strengthened to assert out-before-in for the `both` case).
- **CP10** Flow-node grid sections (`FlowNodeGridCard.tsx`): Processes / External entities / Data stores cards in the browse lens, sorted, search-filtered, ⓘ → existing per-kind dialog, each card carrying its `kind:name` token + spotlight props. Blocking finding fixed: the read-lens "Process Model" block was gated only by `hasDiagrams`, so it duplicated under the grid in browse — now gated to `lens === 'read'`; test asserts zero read-lens process headings in browse, present in read.
- **CP11** Unified cross-kind spotlight: connected set = FK connections (entity-active) ∪ flow connections (`buildFlowSpotlightConnections` with `db:<id>` for an entity or the card's own token). Pinning a process lights its stores/externals/entity cards (cross-domain) and dims the rest; pinning an entity keeps its FK entities and the processes that touch it lit. Finding folded: CP11 test strengthened to exact equality over rendered cards (both subset directions); `FlowDiagramRaw.edges` typed to drop an `as unknown as` cast.
- **CP12** Dashed cross-domain data-flow lines: `--spotlight-line-flow` (dark+light) dashed paths with the data payload as label and the arrow at the sink, target resolved across both id namespaces (`data-entity-id` / `data-flow-token`); entity active cards render solid FK + dashed flow lines together; off-screen flow connections become payload chips; facing-edge anchoring (CP8) shared between both line kinds.
- **CP13** Light-mode visual coverage for the flow features (process spotlight, dashed flow lines, FK+flow coexistence, anchor-fix stacked pair); read-lens regressions (CP9 highlight, CP10 print, sticky-search) re-confirmed; CLAUDE.md row updated to name flow nodes + cross-domain; this log.

CP14–CP16 (declutter + scale) shipped via the same loop. A scale test (140-node synthetic hub) had confirmed always-on pills pile up and high-degree nodes scatter their neighbors.

- **CP14** Hover-reveal labels: leader lines draw label-free by default; a connection's pill (FK predicate + cardinality, or flow payload) reveals only when the pointer is over that connected card, via a `labelHoverCardId` signal distinct from the active-node hover (so it works in pinned mode without retargeting). Bundled pills on one hovered card are collision-nudged. Existing CP4/CP12 pill-text assertions updated to hover-first. Finding folded: a CP4.2 fallback that could silently pass was tightened to scroll-and-assert.
- **CP15** Focus / isolate mode: a Focus control (in the focus bar, shown while pinned) collapses the browse grid to `{active} ∪ connected-set` (cards removed from the DOM, headers only for non-empty sections), so a 140-node hub shows as its ~11-card neighborhood with every line on-screen and zero off-screen chips. Focus and search are mutually exclusive both ways; Esc / unpin / Show all / search-change all exit. Three blocking findings fixed: unpin now clears focus; activating Focus while a search is active no longer races the search-clear effect (sentinel ref); added tests for the unpin-exit and activate-while-search paths. Screenshot provenance corrected to capture the synthetic hub (not key-inherited).
- **CP16** Final review: CP14+CP15 reviewed dark + light (synthetic hub focus; light-mode focus bar + cross-domain lines); read-lens regressions re-confirmed; CLAUDE.md row updated to name hover-reveal labels + focus mode; this log.

CP17 (DD chrome layout) shipped via the same loop, in response to two user-reported layout issues.

- **CP17** Outer-scroll + fixed top search bar: `.dict-view` is now the full-viewport-width fixed scroll container (scrollbar at the window edge) with a `.dict-view-inner` max-width:1100px centered content wrapper; the search input + Read/Browse toggle live in a fixed top bar (`.dict-search-bar`) with a semi-transparent + `backdrop-filter` frosted background, centered/bounded so it never overlaps the branding (top-left) or theme toggle (top-right). Sticky-bleed CSS removed. Off-screen chips now clamp below the fixed bar (resolves known-limitation #1). The bar's bottom border was removed per user request (clean blend into the page). Read-lens behavior unchanged (CP9/CP10 re-confirmed; the search input keeps its React state binding + debounce, only its DOM location moved). 8 CP17 assertions (clientWidth at window edge, fixed-bar position, backdrop-filter, non-transparent bg, centered inner wrapper, Read+Browse, focus-bar-below-bar, anchor re-confirm).

Known v1 limitations: On a very high-degree hub the leader lines all converge on the active card's single facing-edge anchor point and bunch there; focus mode keeps them on-screen and hover-reveal keeps labels uncluttered, but distributing anchor points along the edge is a future refinement. Deferred. (The earlier always-on-pill-overlap limitation is resolved by CP14 hover-reveal; the off-screen-chips-overlap-top-bar limitation is resolved by CP17's clamp.)
