# Viewer FAB UX


## Problem

The interactive server viewer (`ignatius serve`) currently shows only the graph. There's no in-app way to:

1. Switch to the data dictionary view without restarting the CLI in a different mode.
2. Bookmark or share a specific entity / pan / zoom state.
3. Get spatial orientation within the canvas at typical pan/zoom levels (no minimap).

The existing FAB (bottom-right floating button) opens a static legend modal. It's an under-used surface that could host more navigation.


## Goals / Non-goals

- **Goals**
    - Single FAB consolidates: mode toggle (dict ↔ graph), legend, minimap toggle, share-link copy.
    - Dict view served by the same running process, no CLI restart.
    - URL hash encodes mode, focused entity, and view transform — reload + paste survive.
    - Minimap shows full canvas + current viewport rect; click-pans the main view.
    - Static dict HTML reused as the dict surface — the existing `generateDict()` output is served verbatim by a new server route.

- **Non-goals**
    - Interactive React-based dict (entity click → graph focus, scrollspy in dict, etc — those are separate concerns; see `dict-side-nav` follow-up).
    - Multi-window or split-pane (graph + dict side-by-side).
    - Hash state for dict view (dict mode uses native `#entity-X` anchors already; we don't re-encode that as hash params).
    - Mobile FAB redesign (FAB stays bottom-right on all viewports for now).


## User-facing behavior


### Mode toggle

- FAB menu has a "View" toggle: `Graph` / `Dict`.
- Selecting Dict navigates to `/dict` (server endpoint that returns generated dict HTML for the current model).
- Selecting Graph navigates back to `/`.
- Mode is reflected in URL path, not hash, so each mode has its own history entry and back/forward works as expected.

### Hash router

- Hash format: `#entity=<id>&zoom=<n>&pan=<x>,<y>`.
- On page load, parse hash → restore selection + view transform.
- On user interaction (tap node, pan, zoom): debounce 300ms → write hash via `history.replaceState` (no new history entry per pan tick).
- Missing fields are tolerated: `#entity=Party` alone is valid, `#zoom=1.5` alone is valid.
- Pan/zoom restore happens AFTER layout settles to avoid race against ELK.

### Minimap

- Bottom-left, fixed, ~150×150px, semi-transparent so it doesn't fight the FAB.
- Toggled on/off via FAB menu; default state: off (avoid surprise UI for current users).
- Implementation: `cytoscape-navigator` plugin (~10KB, drop-in, integrates with Cytoscape's pan/zoom).
- Hidden on viewports < 768px (no useful real estate on mobile).

### Share-link copy

- FAB menu has "Copy link" that copies `window.location.href` (with current hash) to clipboard.
- Brief toast / inline confirmation ("Copied!") on success.

### FAB menu

- Replaces current single-purpose legend button.
- Click FAB → menu expands upward (legend was a modal; new behavior is an inline vertical menu pinned to FAB).
- Menu items: View toggle (Graph/Dict), Legend (opens existing modal), Minimap toggle, Copy link.
- Click outside or press Esc dismisses menu.
- Menu items get icons + labels.


## Architecture

```mermaid
flowchart LR
    URL["URL: /<path>#<hash>"] --> Router[Router]
    Router -->|path "/"| GraphView[Graph SPA]
    Router -->|path "/dict"| DictHTML[Server-rendered dict]
    GraphView -->|reads hash| HashState[Hash state]
    HashState -->|entity| Selection
    HashState -->|zoom,pan| Viewport
    GraphView --> FAB
    FAB --> ModeToggle
    FAB --> Legend
    FAB --> MinimapToggle
    FAB --> CopyLink
    MinimapToggle -->|on| Navigator[cytoscape-navigator]
    Navigator -->|viewport rect| Cy[Cytoscape instance]
    Selection --> Cy
    Viewport --> Cy
```


### Server routes

- `GET /` — graph SPA (existing, unchanged).
- `GET /dict` — **new**. Calls `generateDict(model, mode, { modelsDir })` server-side, returns the HTML. The static dict already supports both themes — query `?theme=light|dark` overrides; defaults to whichever the request came from (cookie or referer hash; simplest: default to dark, accept `?theme=` override).
- `GET /api/model` — existing JSON, unchanged.
- `GET /api/asset?path=` — existing, unchanged.
- `GET /events` — existing SSE, unchanged.


### Hash router contract

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `entity` | string (entity id) | no | If set + matches an existing node, that node becomes selected; on first load also `cy.center(node)`. Unknown id is silently ignored. |
| `zoom` | float | no | Clamped to Cytoscape's zoom bounds (existing min/max). |
| `pan` | "x,y" string | no | Two floats. Unparseable → ignored. |

- Writer: debounced 300ms, uses `history.replaceState` so back-button still walks page-level history, not pan ticks.
- Reader: parsed once on mount, applied after `cy.on('layoutstop')` fires.
- Listener: `window.addEventListener('popstate')` and `window.addEventListener('hashchange')` to re-apply on external nav (e.g. user pastes a new hash in dev tools).


### Minimap

- `cytoscape-navigator` plugin, dependency added to `package.json`.
- Mounted at a fixed `.minimap` div, positioned bottom-left.
- Plugin handles its own resize / theme adaptation via CSS — verify it picks up our theme variables, override `--minimap-bg` if needed.
- Toggle state persisted to `localStorage` under `ignatius-minimap` so the user's preference survives reloads.


### FAB menu

- Convert the current `.fab` from "opens modal" to "opens inline menu".
- Menu container: vertical flex, anchored to FAB, appears above it (slides up).
- Each menu item is a button with icon + label. Reuse `.theme-toggle` styling primitives where possible.
- Esc + click-outside dismiss.
- Legend re-opens as a separate modal layered above the menu (existing modal stays unchanged).


## Open questions

(none — user resolved approach via pressure-test / clarify round)


## Approaches considered and rejected

| Rejected | Why |
|----------|-----|
| Interactive React dict component | Larger lift, duplicates static-dict logic, blocks ship on full dict reimplementation. Static-dict-via-endpoint is much smaller and ships the user value immediately. |
| Hand-rolled minimap | Real implementation work (HiDPI, viewport rect math, click-pan). cytoscape-navigator is ~10KB and battle-tested. |
| Three separate buttons (no menu) | More chrome at bottom-right, fights the footer. Menu pattern scales as we add more items. |
| Mode toggle in top header | Top header is already crowded (branding + theme toggle). FAB menu keeps it under one consolidated control. |
| Hash for everything (mode + state) | Mode = path is more aligned with browser semantics (back/forward, browser tab title can differ per mode if we want it). Hash stays scoped to view-state within graph. |
