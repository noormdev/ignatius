# Viewer FAB UX — spec


## Goal

Extend the `ignatius serve` interactive viewer with four cohesive chrome features: a server-side `/dict` route, URL-hash state pinning, an expandable FAB menu consolidating navigation actions, and an opt-in cytoscape-navigator minimap.


## Non-goals

- Interactive React-based dict (entity click → graph focus, scrollspy, side nav).
- Multi-window or split-pane (graph + dict side-by-side).
- Hash state for dict view (dict mode uses native `#entity-X` anchors; not re-encoded as hash params).
- Mobile FAB redesign (FAB stays bottom-right on all viewports).
- Dict reading-experience improvements (branding overlap, side nav) — separate spec.


## Success criteria

- Visiting `/dict` in the running server returns valid, complete dict HTML with entity sections, attribute tables, and the generated model's branding.
- Visiting `/dict` with no query parameter returns dark-mode dict styling; visiting `/dict?theme=light` returns light-mode dict styling.
- Navigating to `/dict` via the FAB mode toggle and pressing the browser back button returns to the graph view at `/`.
- Loading `/#entity=Party` selects the Party node and centers the viewport on it.
- Loading `/#zoom=1.5&pan=200,100` restores that zoom level and pan position after layout settles (no race against ELK).
- Unknown entity ids in the hash (`#entity=NoSuchThing`) are silently ignored — no error, graph loads normally.
- Panning or zooming updates the URL hash (debounced) without adding new browser history entries; reload restores the same view.
- Pasting a new hash in the URL bar (or `history.back()` to a prior hash state) re-applies entity selection and view transform without a full page reload.
- Clicking the FAB expands an inline vertical menu above it with four items: View toggle (Graph/Dict), Legend, Minimap toggle, Copy link.
- Pressing Esc or clicking outside the open FAB menu dismisses it.
- "Copy link" copies the current `window.location.href` (with hash) to clipboard and shows a brief "Copied!" confirmation.
- Toggling the minimap on via the FAB menu renders the cytoscape-navigator panel at bottom-left; clicking inside the minimap pans the main viewport.
- Minimap toggle state persists across reloads (`localStorage` key `ignatius-minimap`); default state is off.
- Minimap is hidden on viewports narrower than 768px.


## Approach

The chosen approach from the design: the server gains a `GET /dict` route that calls the existing `generateDict()` server-side and returns the HTML directly — no new static file generation step, no CLI restart. The graph SPA gains a hash-router module (parse on mount post-`layoutstop`, debounced write on viewport/selection change via `history.replaceState`). The existing single-purpose FAB button is converted to an expandable inline menu that hosts the mode toggle, legend trigger, minimap toggle, and copy-link action. The minimap is implemented via the `cytoscape-navigator` plugin (~10 KB), added as a new `package.json` dependency and mounted at a fixed bottom-left `.minimap` container.


## Checkpoints

| # | Checkpoint | Files / areas | Agent | Est. | Verifies |
|---|------------|---------------|-------|------|----------|
| 1 | Server `/dict` route + mode link | `src/server.ts`, `src/App.tsx` (temporary dict link) | atomic-builder | ~1h | Visiting `/dict` returns complete dict HTML; `/` graph still loads; a link in the graph view navigates to `/dict`; browser back returns to graph |
| 2 | Hash router — entity + zoom + pan | `src/App.tsx` (or extracted module), `src/server.ts` unchanged | atomic-builder | ~1.5h | `/#entity=<id>` selects + centers node post-layoutstop; `/#zoom=<n>&pan=<x>,<y>` restores view; unknown id is silently ignored; pan/zoom updates hash without new history entry; reload restores state |
| 3 | FAB menu refactor | `src/App.tsx`, `src/styles.css` | atomic-builder | ~1h | FAB click expands inline vertical menu above FAB; Esc + click-outside dismiss; Legend item still opens existing modal; Copy link copies href + shows "Copied!" confirmation |
| 4 | Minimap via cytoscape-navigator | `package.json`, `src/App.tsx`, `src/styles.css` | atomic-builder | ~1h | Minimap renders at bottom-left when toggled on; viewport rect tracks main pan/zoom; click-pan works; toggle state persists in localStorage; hidden below 768px |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Hash restore races ELK layout (viewport applied before nodes positioned) | Medium | Apply pan/zoom/selection inside `cy.on('layoutstop')` callback, not on mount |
| `cytoscape-navigator` CSS variables conflict with existing `--color-*` theme vars | Low | Inspect plugin stylesheet; override `--minimap-bg` and related vars in `styles.css` if needed |
| `generateDict()` called on every `/dict` request may be slow on large model sets | Low | Dict generation is synchronous and fast in practice; no caching needed for serve mode |
| FAB menu z-index fights Cytoscape canvas or legend modal | Low | Explicit `z-index` layers in `styles.css`; legend modal already has a working z-index stack |
| Mode-toggle browser-history semantics | Low | Navigating Graph → Dict → back lands at `/` (the graph URL with its hash state at that moment), not a sub-state of dict; this is the intended semantic — document and verify the round-trip in CP-1 |


## Change log

<!-- empty during drafting; first entry on first post-approval amendment -->
