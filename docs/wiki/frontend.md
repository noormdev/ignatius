---
type: Domain
description: React 19 unified SPA (graph / dictionary / flow) under src/app — shell, views, components, pure logic, hooks, and DOM helpers
---

# frontend

## What it does

`src/App.tsx` was decomposed from a 5241L monolith into a layered [`src/app/`](../../src/app) tree. The entry point is [`src/app/App.tsx`](../../src/app/App.tsx) (808L). [`src/app/main.tsx`](../../src/app/main.tsx) is the React entry point. Layer rule: shell → views → components → ui → logic/dom (downward only).

The unified SPA collapses three surfaces — graph (ERD), dict (data dictionary), and flow (DFDs) — into one React app: `GraphView`, `DictionaryView`, and `FlowsView` stay mounted simultaneously (graph/flow toggle `isActive`; dict toggles CSS `display:none`) so search text, scroll position, and canvas state survive view switches. `useHashRoute` owns the URL hash as the single source of truth for view, selected entity, zoom, pan, and DFD deep-links.

## Artifacts

No user-facing Claude Code skill/command artifacts in this domain.

## CLI code

### Shell

- [`src/app/App.tsx`](../../src/app/App.tsx) (808L) — state, view-switch, modal hosting, composition. Owns `openEntityById` (with `fromFlow` flag), `modelIndex`/`modelIndexRef` useMemo/ref pair, `appErrorsByEntityId` Map, `appAllFlowNodeIds`, `entityUsageIndex` useMemo, and `pendingScrollProcessIdRef` for dict process-scroll. `dictViewRef` (`DictionaryViewHandle`) and `handleToggleLayoutMode` are shared between the FAB button and the keyboard shortcut `l`. `showHelp` boolean state wires the `?` top-bar button (`.help-toggle`) and `onHelp` passed to `useKeyboardShortcuts`; renders `HelpModal` when true. **Keyboard pan:** `handleKeyboardPan(dx, dy)` routes the resolver's `{type:'pan'}` action to the active canvas — `graphViewRef.current?.panBy(dx, dy)` on graph, `flowsViewRef.current?.panBy(dx, dy)` on flow, no-op on dict. Interacts with `GraphView`, `DictionaryView`, and `FlowsView` exclusively through typed imperative handles (`GraphViewHandle`, `DictionaryViewHandle`, `FlowsViewHandle`).
- [`src/app/main.tsx`](../../src/app/main.tsx) (12L) — React root mount, reads `window.__MODEL__`/`__THEME_MODE__` globals in static mode.
- [`src/app/hash-router.ts`](../../src/app/hash-router.ts) (95L) — exports `parseHash`/`serializeHash`, `ViewName`, `HashState`. `HashState` carries `view?: 'graph'|'dict'|'flow'`, `entity?`, `zoom?`, `pan?`, `dfd?`. Format: `#view=<graph|dict|flow>&entity=<id>&zoom=<n>&pan=<x>,<y>&dfd=<diagram-id>`.
- [`src/app/globals.d.ts`](../../src/app/globals.d.ts) (46L) — `window.__MODEL__`, `__THEME_MODE__`, `__IGNATIUS_MODE__` (`'live'|'static'`), `__LAYOUT_KEY__`, `__FLOW_MODEL__`, `__FLOW_LAYOUT_KEYS__`, `__IGNATIUS_CY__`, `__IGNATIUS_CY_GEN__`, `__IGNATIUS_FLOW_READY__`, `__IGNATIUS_FLOW_GEN__`, `__IGNATIUS_ACTIVE_FLOW_DFD__`, `__IGNATIUS_PERF__`.
- [`src/app/index.html`](../../src/app/index.html) — Bun HTML entry point; imported directly by [`src/server/server.ts`](../../src/server/server.ts) (`import index from '../app/index.html'`) as the `Bun.serve()` route.

**Cross-view search (graph-flow-search):** the shell owns per-surface search state that survives view switches. Graph search: `graphSearchTerm`/`graphSearchIncludeBody` plus `graphSearchCursorRef` (Enter-to-cycle cursor, reset on term/toggle change); `graphSearchMatches` is `null` when inactive or a `Set` (possibly empty) when active — `entityMatches` from [`src/app/logic/search.ts`](../../src/app/logic/search.ts) runs over `model.nodes`. Flow search: `flowSearchTerm`/`flowSearchIncludeBody`; `flowSearchResults` calls `searchFlowDiagrams`; `flowSearchTokens` is threaded into `FlowsView`'s `searchTokens` prop. Neither graph nor flow search state touches the model, layout fingerprint, layout-store, or URL hash. `bannerRef` measures the global-error banner's rendered height via `ResizeObserver` and writes it into the `--search-bar-top` CSS custom property so `SearchBar` sits below the banner.

**Branding gutter (fix, 2026-08-01):** the branding block is `position: fixed`, out of document flow, so no stylesheet can know how much room to leave for it. A `brandingRef`-measuring `useEffect` (App.tsx L335-354) publishes the block's measured width as the `--branding-gutter` CSS custom property (via `ResizeObserver`, re-published on `[branding, logoSrc]` change since a theme swap can change logo width) so the Dictionary view's full-bleed search bar can indent past it below ~1920px viewport width, where the two previously shared a row and the z-50 branding block painted over the z-30 search input. [`src/app/styles.css`](../../src/app/styles.css)'s `.dict-search-bar-inner` computes `padding-left: max(2rem, calc(16px + var(--branding-gutter, 0px) + 12px - var(--dict-bar-left-slack)))`.

### Hooks

- [`src/app/hooks/useModelData.ts`](../../src/app/hooks/useModelData.ts) (173L) — exports `useModelData(opts?)`. Unified SSE subscription + model/flow fetch + findings state. Static mode reads `window.__MODEL__`/`__FLOW_MODEL__` once on mount. Live mode boots with parallel `/api/model` + `/api/flow`, then re-fetches on every `model-changed` SSE event. Returns `{ model, findings, flowDiagrams, flowFindings, layoutKeyRef, bannerDismissed, setBannerDismissed }`. **StrictMode double-fetch guard:** the boot `useEffect` declares a local `let ignore = false`, set `true` in its cleanup; every `setState` inside the boot and SSE-handler promise chains is gated on the flag to survive React StrictMode's dev-mode mount→cleanup→mount double-invoke.
- [`src/app/hooks/useHashRoute.ts`](../../src/app/hooks/useHashRoute.ts) (121L) — exports `useHashRoute(opts?)`. Owns hash read/write and `popstate` back/forward restoration. `entity=` in the hash is the single source of truth for the modal stack: `openEntity(id)` pushes history (deduped when the hash already carries the same entity), `closeEntity()` replaces it. `popstate` invokes `onEntityChange(id | null)` to reconcile the shell without pushing another history entry. Returns `{ view, setView, openEntity, closeEntity }`.
- [`src/app/hooks/useThemeMode.ts`](../../src/app/hooks/useThemeMode.ts) (36L) — exports `useThemeMode(themeConfig?, model?)`. Seeds from `window.__THEME_MODE__` or localStorage; calls `applyThemeCssVars` on change (also on `model` identity change). Returns `{ themeMode, toggleTheme }`.
- [`src/app/hooks/useKeyboardShortcuts.ts`](../../src/app/hooks/useKeyboardShortcuts.ts) (101L) — registers exactly ONE global `keydown` listener for the unified SPA shortcuts (g/d/f/l/b/?//` `/Cmd-Ctrl-k/arrows). Stale-closure hazard avoided via a `configRef` updated each render. Editable guard returns true when focus is in `INPUT`/`TEXTAREA`/`SELECT`/`contenteditable` or inside `.modal`. Dispatches through `resolveShortcut` from [`src/app/logic/shortcuts.ts`](../../src/app/logic/shortcuts.ts). Imported only by `App.tsx`.

### Logic (pure, no DOM/React)

- [`src/app/logic/doc-resolver.ts`](../../src/app/logic/doc-resolver.ts) (125L) — exports `buildFlowDocResolver(diagrams, getEntityModel)` and `splitDocToken(token)`. `FlowDocResult` discriminated union: `entity`/`node`/`doc`. Keyed by stable id/slug so `title:` overrides don't break `[[wiki-link]]` resolution.
- [`src/app/logic/flow-node-ids.ts`](../../src/app/logic/flow-node-ids.ts) (28L) — exports `buildAllFlowNodeIds(diagrams, entityModel?)`. Returns `ReadonlySet<string>` merging all process/external/non-db-store ids with ERD entity ids.
- [`src/app/logic/color.ts`](../../src/app/logic/color.ts) (39L) — exports `hexToRgba` and `blendHex`.
- [`src/app/logic/search.ts`](../../src/app/logic/search.ts) (272L) — search-matcher logic for all three surfaces. Dictionary matchers (`nodeMatchesSearch`, `processMatchesSearch`, `externalMatchesSearch`, `storeMatchesSearch`) always match id/label/columns/body, no opt-in flag. Graph/Flows matchers are a deliberately different, title-first UX: `entityMatches(node, term, includeBody)` matches only `node.id` by default, body only when `includeBody` is true; `flowProcessMatches`, `flowExternalMatches`, `flowStoreMatches`, `flowDiagramMatches` follow the same pattern. Exports `FlowSearchResultKind`, `FlowSearchResult`, and `searchFlowDiagrams(diagrams, term, includeBody)`, which recursively walks every diagram and its `subDfds` (parent before children); diagrams in `SYNTHETIC_DIAGRAM_IDS` (from [`src/flows/flow-derive-levels.ts`](../../src/flows/flow-derive-levels.ts)) are excluded from results but still walked so their leaf `subDfds` are reached.
- [`src/app/logic/finding-rows.ts`](../../src/app/logic/finding-rows.ts) (48L) — finding-row formatting logic extracted from `FindingsPanel`.
- [`src/app/logic/relationship-key.ts`](../../src/app/logic/relationship-key.ts) (21L) — exports `relationshipRowKey(edge: ModelEdge): string`. Stable, collision-free React key for relationship rows; encodes source, target, and sorted `on` FK pairs to handle dual-FK tables.
- [`src/app/logic/spotlight.ts`](../../src/app/logic/spotlight.ts) (101L) — pure `buildSpotlightConnections(index, entityId): SpotlightConnection[]`, direct (non-inherited) FK connections for the DD browse-lens spotlight overlay. Uses `edgesBySource`/`edgesByTarget` only. Self-edges excluded; all edges to the same otherId bundle into one connection; unknown entityId → `[]`.
- [`src/app/logic/flow-spotlight.ts`](../../src/app/logic/flow-spotlight.ts) (136L) — pure `buildFlowSpotlightConnections(diagrams, activeToken): FlowSpotlightConnection[]`. Token scheme `"<kind>:<name>"`; entity cards pass `"db:<entityId>"`. Walks all diagrams + sub-DFDs recursively.
- [`src/app/logic/shortcuts.ts`](../../src/app/logic/shortcuts.ts) (159L) — pure keyboard-shortcut resolver, no DOM/React/Bun/Node imports. Exports `resolveShortcut(e, view, editable): ShortcutAction | null`, the `ShortcutAction` discriminated union, and `ShortcutKeyEvent`. Keymap: g/d/f view switch, l toggleLayout (graph only), b toggleLens (dict only), [`/`](../..) search, `?` help, Cmd/Ctrl+`=`/`-`/`0` zoom, Cmd/Ctrl+k search, arrow keys → `{type:'pan', dx, dy}` on graph/flow only. `PAN_STEP = 10`, `PAN_STEP_FAST = 50` (Shift+arrow). Key matched on `e.key.toLowerCase()` for capslock-insensitivity.
- [`src/app/logic/spotlight-lines.ts`](../../src/app/logic/spotlight-lines.ts) (100L) — pure geometry helper separating overlapping spotlight-overlay lines. Exports `separateSpotlightLines(base, directions): SpotlightLineSpec[]`, `SPOTLIGHT_LINE_GAP = 14`. K=1 leaves the base line unchanged; K>1 applies a symmetric perpendicular offset so the centre of mass stays on the base anchor. Imported by [`src/app/components/entity/SpotlightOverlay.tsx`](../../src/app/components/entity/SpotlightOverlay.tsx).
- [`src/app/logic/spotlight-inherited.ts`](../../src/app/logic/spotlight-inherited.ts) (266L, grew from 220L — junction-barrier fix) — pure key-inheritance LINEAGE logic for the DD browse lens and DG graph. No DOM/React/Bun/Node imports. **Key edge** = an edge whose FK columns (`Object.keys(edge.on)`) are ALL ⊆ the child (source) node's primary key (`index.pkByNode`) — a subset test implementing IDEF1X identifying semantics, catching identifying-1:1 AND identifying-1:many (proper-subset FK). **Associative-entity barrier (current behavior, replaces the earlier flat connected-component model):** `isAssociative(index, nodeId)` returns true when a node has key edges to 2+ distinct parents whose FK columns together cover its entire PK (a pure junction/link table, e.g. `Project_Tag`) — `buildLineageWithPredecessors`'s BFS treats any such node as a traversal BARRIER (reachable, but the walk stops there) except at the start node itself. Without this barrier, a junction like `Tag` welds every tagged parent entity into one lineage component. `buildLineageWithPredecessors` is a BFS over key edges (undirected) that also records, per member, the nearest key-edge predecessor on the shortest path from the active entity. `buildInheritedConnections(index, entityId): InheritedConnection[]` excludes the entity itself and its direct real-edge neighbors (`directNeighbors`, solid-line connections); `via` is `INHERITED_IDENTITY` when the predecessor is the active entity itself, else the nearest key-edge kin id (for a "via `<kin>`" pill label); `direction` is always `'out'` (the line points FROM the active card OUTWARD to the member — the union retains `'in'`/`'both'` only for shape compatibility). Result sorted ascending by `otherId`; singleton lineage (no key-edge kin) → `[]`. A prior `?lineage=legacy` escape hatch (`src/app/logic/lineage-mode.ts`, a pass-through walk for A/B comparison during review) was removed once the barrier rule was validated — `buildInheritedConnections` now takes only `(index, entityId)`, no mode parameter.

### DOM helpers

- [`src/app/dom/body-links.ts`](../../src/app/dom/body-links.ts) (70L) — exports `resolveBodyClick(e, scrollFn)` (shared body-click handler for entity/process/external/store DD body divs — intercepts `a[data-entity]` and `.entity-link--missing` spans) and `upgradeMissingLinksInContainer(container, knownIds)` (rewrites `.entity-link--missing` spans to live `<a>` anchors once the target id is known).
- [`src/app/dom/theme-css-vars.ts`](../../src/app/dom/theme-css-vars.ts) (114L) — exports `applyThemeCssVars(theme, mode)` and mode-aware color constants including `SPOTLIGHT_LINE_INHERITED`. Sets all CSS custom properties on `document.documentElement`, including spotlight vars `--spotlight-line-out`, `--spotlight-line-in`, `--spotlight-line-flow`, `--spotlight-line-inherited`. Called by `useThemeMode`.

### UI components (`components/ui/`)

- `Modal.tsx` (42L) — shared modal primitive (title + onClose + children).
- `ZoomControl.tsx` (69L) — view-agnostic zoom readout. Props: `percent`, `onZoomIn`, `onZoomOut`, `onSetPercent(pct)`, `onReset`. Clicking the readout opens an inline commit-on-Enter/blur text input.
- `FabMenu.tsx` (209L) — per-view FAB menus, items view-gated. `kbd-hint` badges surface keyboard shortcuts inline.
- `HelpModal.tsx` (138L) — view-aware orientation overlay built on `Modal`. Three branches (graph/dict/flow), each documenting that surface's search behavior and closing with a `shortcutRows(view)`-driven keyboard section.
- `SearchBar.tsx` (147L) — exports `SearchBar` (`forwardRef<SearchBarHandle, SearchBarProps>`) and `SearchBarHandle` (`{ focus(): void }`). Shared search-bar chrome for the Graph and Flows surfaces: debounced (200ms) `<input type="search">`, a `role="switch"` "Include descriptions" toggle, a match-count readout, and a `children` slot for a results dropdown.

### Flow search components

- `components/flow/FlowSearchResults.tsx` (73L) — exports `FlowSearchResults({ results, onSelect })`. Rows arrive pre-grouped by diagram (contiguous), capped at `DISPLAY_CAP = 20` with a "+N more" line. One-letter kind badge per row (P/E/S/D).

### Entity components (`components/entity/`)

- `EntityModal.tsx` (129L) — exports `SelectedEntityModal`.
- `EntityCard.tsx` (139L) — exports `DictEntitySection`.
- `ClassificationBadge.tsx` (25L) — exports `DictClassificationBadge`.
- `ColumnsTable.tsx` (159L) — columns table, `variant='modal'|'dict'`.
- `ChildrenTable.tsx` (115L) — children/subtype table, `variant='modal'|'dict'`; uses `relationshipRowKey`.
- `ExamplesAccordion.tsx` (69L) — examples accordion, `variant='modal'|'dict'`.
- `GridCard.tsx` (87L) — exports `GridCard`, compact entity card for the DD browse lens.
- `FlowNodeGridCard.tsx` (209L) — exports `ProcessGridCard`, `ExternalGridCard`, `StoreGridCard`.
- `SpotlightOverlay.tsx` (1095L, the largest single component in the domain) — exports `SpotlightOverlay`. Position:fixed SVG + chips container over the DD browse grid. FK connections draw SOLID bezier paths (direction-coded stroke, arrowhead placement, predicate + cardinality pills). Flow connections draw DASHED paths (`--spotlight-line-flow`). Inherited (lineage) connections draw DOTTED paths in `--spotlight-line-inherited`, computed via `computeInheritedLines` from `buildInheritedConnections`'s output, with a provenance pill ("shared key" for `INHERITED_IDENTITY`, else "via `<kin>`"). Off-screen connections (target card outside the scrollport) render as clickable directional chips instead of a line — `computeChips`/`computeFlowChips`/`computeInheritedChips`. Anchors re-measured every rAF-throttled frame via `ResizeObserver` on the grid container, `window resize`, and scroll on `.dict-view`. Calls `separateSpotlightLines` (`logic/spotlight-lines.ts`) so overlapping edge bundles render as offset parallel paths.

### Process components (`components/process/`)

- `IoTable.tsx` (134L) — exports `FlowIoTable`.
- `KindMarker.tsx` (31L) — exports `FlowKindMarker`.
- `ProcessExamples.tsx` (66L) — exports `FlowProcessExamplesSection`.
- `ProcessCard.tsx` (86L) — process DD card (`DictProcessSection`).
- `ProcessesTable.tsx` (41L) — exports `DictProcessesTable`.
- `ProcessesSection.tsx` (43L) — exports `ProcessesSection`.

### Flow-node components (`components/flow-node/`)

- `FlowNodeModal.tsx` (119L) — structured flow node dialog (process / external / non-`db` store).
- `FlowDocModal.tsx` (30L) — plain markdown doc dialog for unresolved wiki-links.
- `ExternalCard.tsx` (26L) — external node card.
- `StoreCard.tsx` (26L) — non-`db` store card.

### Findings

- `components/findings/FindingsPanel.tsx` (93L) — `<FindingsPanel>` renders only when `totalFindings > 0`; collapses to a badge; present across all three views.

### Views

- `views/graph/GraphView.tsx` (1455L) — exports `GraphView` (forwardRef) and `GraphViewHandle`/`LayoutMode` types. Owns the full Cytoscape lifecycle, navigator lifecycle, zoom adapter, hash wiring, preset-layout cache-skip, ELK cost scaling. `GraphViewHandle` exposes `navigateToEntity`, `panelNavigate`, `resetLayout`, `applyLayoutMode`, `zoomIn`, `zoomOut`, `setPercent`, `resetZoom`, `panBy`, `retheme`. `wheelSensitivity: 0.2`. **Lineage trigger is SHIFT+HOVER, not click/select:** `cy.on('mouseover', 'node')` branches on `evt.originalEvent?.shiftKey` — shift held draws ephemeral `edge.inherited`-class cy edges via `buildInheritedConnections` plus 3-tier focus opacity; no shift is a plain direct-neighbor dim. A plain click never draws lineage. **3-tier focus opacity:** direct (full opacity), inherited/ancestral (`.inherited-dim`, 0.5), unrelated (`.faded`, 0.2). **Cross-view search:** accepts `searchMatches: ReadonlySet<string> | null`; `applySearchClasses` applies dedicated `.search-match`/`.search-dim` classes, kept separate from the hover-tier and lineage classes so search dimming survives hover/lineage/tap/relayout.
- `views/graph/organic-layout.ts` (648L) — organic (fCoSE-based) layout engine built on `cytoscape-fcose`. `ORGANIC_FALLBACK_THRESHOLD = 500` entities before falling back to layered. `buildScratchCore` runs the multi-seed layout search on a headless mirror core so only winning positions touch the live core; `groupRegions: true` (entity count ≥ 150) wraps each color family in an invisible compound parent so fCoSE decomposes large models into per-family sub-layouts. `arrangeOrganic(cy, iters)` is the post-settle local-polish pipeline (expand, fan subtype clusters, dock leaves/isolates, deoverlap). `gradeEdgeSpans(cy)` grades every edge's `span` (`'near'|'mid'|'far'`) by percentile within the layout's own length distribution, for `styles.ts`'s length-graded de-emphasis.
- `views/graph/navigator.ts` (53L) — `mountNavigator`/`teardownNavigator`/`NavigatorInstance`, cytoscape-navigator lifecycle helpers. `teardownNavigator` calls `nav._removeCyListeners?.()` before `nav.destroy()` to avoid a resize-listener leak that fires on a destroyed core.
- `views/graph/styles.ts` (243L) — `buildStyles(groups, theme, mode)` → cytoscape stylesheet array. `.faded` (0.2), `.inherited-dim` (0.5), `edge.inherited` dotted at 0.5 opacity. Length-graded de-emphasis on `edge[span]`. Graph search: `SEARCH_MATCH_BORDER` gold/yellow border on `.search-match`, `.search-dim` at 0.2 opacity, both pushed last in the stylesheet array to win the cascade.
- `views/graph/markers.ts` (202L) — exports `drawWarningBadges(cy, svg, entityIds: Set<string>)`, `createMarkerOverlay(container)`, `updateMarkers(cy, svg, theme, mode?)`.
- `views/graph/wrap-label.ts` (42L) — `wrapEntityLabel`: underscores → spaces; names longer than ~13 chars break at PascalCase/acronym/digit boundaries.
- `views/graph/layout-store.ts` (108L) — exports `PositionMap`, `StorageLike`, `LayoutStoreHandle`, `createLayoutStore(storage?, now?)`. Single localStorage key `ignatius-layout-positions`; newest-10 pruning on save. `PositionMap` is also imported directly by [`src/flow-view/FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx).
- `views/dict/DictionaryView.tsx` (1452L) — `DictionaryView` is a `forwardRef` exposing `DictionaryViewHandle { toggleLens(); focusSearch(); }`. Keep-mounted via CSS `display:none`. Imports `SYNTHETIC_DIAGRAM_IDS` from [`src/flows/flow-derive-levels.ts`](../../src/flows/flow-derive-levels.ts) to exclude synthesized context/L1 diagrams from the DD sidebar. Owns DD CSS Custom Highlight search, `beforeprint`/`afterprint` print handling, DD sidebar process nesting. **Browse lens** (`'read'|'browse'`, persisted to localStorage): entity groups + Processes/External Entities/Data Stores sections; spotlight state `hoverId`, `pinnedId`, `labelHoverCardId`, `focusId`. FK connections from `buildSpotlightConnections`; flow connections from `buildFlowSpotlightConnections`; inherited (lineage) connections from `buildInheritedConnections`, gated behind a document-level `shiftHeld` boolean (Shift keydown/keyup + window blur reset) — without Shift held, no inherited card lights up or gets surfaced as a chip.
- `views/flow/FlowsView.tsx` (900L) — exports `FlowsView` (forwardRef) and `FlowsViewHandle`. Owns `FlowChrome` chrome + the imperative SVG renderer lifecycle ([`src/flow-view/FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx)). Calls `buildFlowDocResolver` + `buildAllFlowNodeIds`. `renderDiagram` calls `computeElkLayout(diagram, { workerFactory })` from [`src/flow-view/elk-flow-layout.ts`](../../src/flow-view/elk-flow-layout.ts) and passes `elkPositions`/`elkEdgeRoutes` into `FlowDiagramSvg`; falls back to a banded `computeFlowLayout` only on ELK failure. `FlowsViewHandle` exposes `selectDiagramById`, `resetLayout`, `zoomIn`, `zoomOut`, `setPercent`, `resetZoom`, `panBy`, `openFlowToken`. **Cross-view search:** accepts `searchTokens: ReadonlySet<string> | null`, threaded into the renderer via a live-update hook (`onRegisterSearchTokens`) that re-renders in place without tearing down the drill-down stack. **`disposed` teardown guard:** `initFlowGraphCore` declares `let disposed = false`; the async `renderDiagram` checks it before and after every `await computeElkLayout(...)` to guard against an orphaned continuation resuming after React StrictMode's dev-mode mount→cleanup→mount (the shared container stays mounted across view switches, so an unguarded orphan would inject a second live React root into it).
- `views/flow/LegendModal.tsx` (204L) — `LegendModal` component; imports `DARK_PALETTE`/`LIGHT_PALETTE`/`FlowPalette` from [`src/flow-view/FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx).

### Other facts

- **View routing:** [`src/app/hash-router.ts`](../../src/app/hash-router.ts) exports `parseHash`/`serializeHash`; `useHashRoute` owns the popstate listener and hash write.
- **`fromFlow` context flag:** `openEntityById(id, fromFlow = false)` — when `true`, the modal's FK links, body `[[wiki-links]]`, and process-usage links stay in-place over the Flows view instead of switching to graph/dict.
- **Kind-colored stores/externals:** `FlowsView` calls `resolveFlowKindPalette(themeMode, themeConfig?.flowKinds)` from [`src/theme/theme-defaults.ts`](../../src/theme/theme-defaults.ts) and passes the palette into `FlowDiagramSvg`.
- **ModelIndex wiring:** `buildModelIndex(model)` ([`src/model/model-index.ts`](../../src/model/model-index.ts)) is called once per Model in `App.tsx` via `useMemo`; `modelIndexRef` mirrors the live value for cy-init closures.
- **Preset-layout cache-skip:** on a repeat graph load whose `layoutKey` matches a saved position set in `layout-store`, cy is constructed with `layout: { name: 'preset' }` and ELK does not run.
- [`src/app/styles.css`](../../src/app/styles.css) (2830L) — full SPA stylesheet. `@media print` block, `::highlight(dd-search-highlight)`, `.dict-process-direction` badges, `.flow-minimap-wrapper`, `.zoom-control`, `.kbd-hint`, `.flow-edge-tooltip`, `.help-toggle`/`.help-modal`/`.help-section*` (help overlay), DD chrome (`.dict-view`, `.dict-search-bar`, `.dict-browse-lens`, `.dict-grid-card`, `.spotlight-overlay`, `.spotlight-line*`), the shared Graph/Flows `.viewer-search-bar`/`.viewer-search-results` chrome, and the `.dict-search-bar-inner` branding-gutter padding rule (see Branding gutter above).

## Docs

- [`docs/design/unified-app.md`](../design/unified-app.md) — collapsing graph/dict/flow into one React surface.
- [`docs/design/app-tsx-decomposition.md`](../design/app-tsx-decomposition.md) — the original `App.tsx` monolith breakup into [`src/app/`](../../src/app).
- [`docs/design/src-root-organization.md`](../design/src-root-organization.md) — where [`src/app/`](../../src/app) sits among the repo's other domains.
- [`docs/design/key-inheritance-lineage.md`](../design/key-inheritance-lineage.md) — the lineage feature implemented by `logic/spotlight-inherited.ts` (including the associative-entity barrier rule).
- [`docs/design/graph-flow-search.md`](../design/graph-flow-search.md) — the cross-view search feature (graph-flow-search) spanning `App.tsx`, `SearchBar`, and both view components.
- [`docs/design/dd-spotlight-grid.md`](../design/dd-spotlight-grid.md) — the Dictionary browse-lens spotlight grid and `SpotlightOverlay`.
- [`docs/design/dict-navigation.md`](../design/dict-navigation.md) — Dictionary sidebar/navigation behavior.
- [`docs/design/graph-position-persistence.md`](../design/graph-position-persistence.md) — the `layout-store`/`layoutFingerprint` node-position persistence design.
- [`docs/design/help-overlay.md`](../design/help-overlay.md) — the `HelpModal` orientation overlay.
- [`docs/design/keyboard-nav-shortcuts.md`](../design/keyboard-nav-shortcuts.md) — the `useKeyboardShortcuts`/`shortcuts.ts` design.
- [`docs/design/viewer-fab-ux.md`](../design/viewer-fab-ux.md) — the `FabMenu` design.
- [`docs/design/viewer-ux-polish.md`](../design/viewer-ux-polish.md) — spotlight-line separation and related overlay polish.
- [`docs/design/branding.md`](../design/branding.md) — the branding block / logo / footer system.
- [`docs/design/wiki-entity-links.md`](../design/wiki-entity-links.md) — `[[wiki-link]]` resolution in entity/process bodies, implemented by `logic/doc-resolver.ts`.

## Coupling

- **model** ([`src/model/parse.ts`](../../src/model/parse.ts), `model-index.ts`, `validate.ts`) — `App.tsx` and most views/components import `Model`, `ModelNode`, `ModelEdge`, `ModelIndex`, `buildModelIndex`, and validation `RULES`/`EntityError` directly. A change to the `Model` or `ModelIndex` shape forces changes throughout [`src/app/`](../../src/app).
- **flows** ([`src/flows/flow-derive-levels.ts`](../../src/flows/flow-derive-levels.ts), `flow-parse.ts`, `flow-validate.ts`) — `DictionaryView` and `FlowsView` import `SYNTHETIC_DIAGRAM_IDS` and flow-diagram types; `logic/flow-node-ids.ts` and `logic/search.ts` build on flow diagram shapes. A change to flow diagram structure or leveling forces changes here.
- **flow-view** ([`src/flow-view/`](../../src/flow-view) — separate domain, ELK/SVG rendering) — `FlowsView.tsx` and `LegendModal.tsx` are the sole importers, pulling in `FlowDiagramSvg`, `FlowChrome`, `computeElkLayout`, `screenScaleToPercent`/`percentToScreenScale`, and the `DARK_PALETTE`/`LIGHT_PALETTE` constants. Coupling runs both ways: [`src/flow-view/FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx) imports the `PositionMap` type from [`src/app/views/graph/layout-store.ts`](../../src/app/views/graph/layout-store.ts). A change to `FlowDiagramSvg`'s prop contract or ELK layout output forces a change in `FlowsView.tsx`.
- **theme** ([`src/theme/theme-defaults.ts`](../../src/theme/theme-defaults.ts)) — `App.tsx`, `dom/theme-css-vars.ts`, `hooks/useThemeMode.ts`, `views/graph/styles.ts`, `views/graph/markers.ts`, `views/flow/LegendModal.tsx`, `views/flow/FlowsView.tsx`, `views/dict/DictionaryView.tsx`, and `components/entity/FlowNodeGridCard.tsx` all consume `semanticColors`/`resolveFlowKindPalette`/theme config types. A theme-shape change ripples widely through this domain.
- **server** ([`src/server/`](../../src/server)) — [`src/server/server.ts`](../../src/server/server.ts) imports [`src/app/index.html`](../../src/app/index.html) directly as its `Bun.serve()` HTML route; the frontend build/dev flow is driven by the server domain, not a separate bundler step.
- **generators** — no direct import coupling found from [`src/app/`](../../src/app); the generated static HTML/model output is what static mode's `window.__MODEL__`/`window.__FLOW_MODEL__` globals are populated with, so a change to what the generator embeds can affect `useModelData`'s static-mode read path.

## Conventions worth knowing

- **Layer rule (downward only):** shell (`App.tsx`) → views (`views/*/`) → components (`components/*/`) → ui (`components/ui/`) → logic/dom (`logic/`, `dom/`). Lower layers never import from higher layers; `logic/` and `dom/` never import React or DOM directly into pure functions.
- **Pure logic modules are DOM/React-free by discipline:** `logic/spotlight.ts`, `logic/spotlight-inherited.ts`, `logic/spotlight-lines.ts`, `logic/shortcuts.ts`, `logic/search.ts`, `logic/flow-spotlight.ts`, `logic/doc-resolver.ts`, `logic/finding-rows.ts`, `logic/relationship-key.ts`, `logic/color.ts`, `logic/flow-node-ids.ts` — each is browser-safe and independently unit-testable, called from `App.tsx` or the view components.
- **Views own imperative handles, not the shell:** `GraphView`, `DictionaryView`, and `FlowsView` are all `forwardRef` components exposing a typed `*ViewHandle` interface; `App.tsx` never reaches into their internals directly.
- **`variant='modal'|'dict'` prop convention:** entity/process display components (`ColumnsTable`, `ChildrenTable`, `ExamplesAccordion`) render the same data differently depending on whether they're inside the `EntityModal` popup or the Dictionary page — one component, two render modes, rather than separate components.
- **Ref-mirrors avoid stale closures:** `modelIndexRef`, `entityModelRef`, `openEntityByIdRef`, `hoveredNodeIdRef` (in `GraphView`) all mirror `useState`/`useMemo` values into refs so long-lived imperative callbacks (Cytoscape event handlers, SSE handlers) always read the current value without re-running setup effects.
- **`null` vs `Set` search-state contract:** both `graphSearchMatches` and `flowSearchTokens` follow "`null` = no active search, nothing dims" vs "`Set` (possibly empty) = active search" — consumers (`GraphView`, `FlowsView`/`FlowDiagramSvg`) branch on this exact contract rather than checking string emptiness independently.
