# Keyboard navigation shortcuts

## Goal

Plain-key keyboard shortcuts in the unified SPA for the three high-frequency
navigation toggles: jump between Graph/Dictionary/Flows views, toggle the DG
layout (organic ↔ hierarchical), toggle the DD lens (read ↔ browse). Bare-key
shortcuts never fire while typing or under a modifier chord. Implements issue
#13.

The resolver also owns **modifier-gated canvas zoom** (viewer-ux-polish #4,
CP4): `Cmd`/`Ctrl` + `=`/`+` / `-`/`_` / `0` steal the browser's page-zoom
chord and route it to the active view's canvas zoom instead. These are a
distinct guard class from the bare keys (see Keymap).

## Non-goals

- Per-node / per-edge keyboard navigation inside a diagram.
- Remappable / configurable bindings.
- A theme-toggle shortcut (not one of the issue's three asks).
- The help-overlay component itself (modal, content, top-bar button) — a separate feature owned by `docs/spec/help-overlay.md`. This resolver owns only the `?` key binding that opens it.

## Keymap (contract)

**Bare keys** (no modifier, not while typing):

| Key | Action | Active when |
|-----|--------|-------------|
| `g` | view → `graph` | any view |
| `d` | view → `dict` | any view |
| `f` | view → `flow` | any view |
| `l` | toggle DG layout `organic ↔ hierarchical` | `view === 'graph'` |
| `b` | toggle DD lens `read ↔ browse` | `view === 'dict'` |
| `/` | focus the active view's search input (graph bar, flow bar, or the Dictionary's search box) | any view |

Bare keys bail (no action) when: `ctrlKey || metaKey || altKey || shiftKey`, OR
focus is an editable target (`input` / `textarea` / `select` /
`contenteditable` / inside an open `.modal`). `l` and `b` resolve to no action
when their view is not active. View jumps are idempotent. `/` needs no Shift
(unlike `?`), so it resolves through the ordinary bare-key switch with no
special guard slot; typing `/` inside any editable target inserts the literal
character instead of firing the shortcut. `Cmd`/`Ctrl` + `k` is a second,
always-on route to the same `{ type: 'search' }` action — see "Modifier-gated
zoom + search" below. The search feature itself (bars, matching, dimming) is
owned by `docs/spec/graph-flow-search.md`; this resolver owns only the `/`
and `Cmd`/`Ctrl`+`k` key bindings and the shell's focus-routing dispatch.

**Modifier-gated zoom + search** — resolved *before* the bare-key guards, so
the editable guard does **not** block them (they are not typed characters),
and they require `ctrl`/`meta` (the opposite of the bare-key modifier guard):

| Chord | Action | Routed to |
|-------|--------|-----------|
| `Cmd`/`Ctrl` + `=` or `+` | `zoomIn` | active canvas (graph cy / flow SVG); dict no-op |
| `Cmd`/`Ctrl` + `-` or `_` | `zoomOut` | active canvas; dict no-op |
| `Cmd`/`Ctrl` + `0` | `zoomReset` (fit) | active canvas; dict no-op |
| `Cmd`/`Ctrl` + `k` | `search` | the active view's search input — same target as `/` |

Gated on `ctrl`/`meta` only — `alt` or `shift` held disqualifies (→ null). Bare
`=`/`-`/`0`/`k` with no modifier → null (plain keystrokes are never hijacked;
bare `k` is simply unmapped). The hook `preventDefault`s on the matched action
so the browser never page-zooms or fires its own "focus search" behavior on
`Cmd`/`Ctrl`+`k`.

**Help key** — resolved *after* the editable guard but *before* the bare-key
modifier guard, because the character itself requires Shift:

| Key | Action | Active when |
|-----|--------|-------------|
| `?` (Shift+`/`) | `help` (open the view-aware help overlay) | any view, not while typing |

Gated off `ctrl`/`meta`/`alt` (Shift is inherent, so it is not disqualifying).
Suppressed in editable context (typing a literal `?` in the search box never
opens the overlay). The overlay content/component is owned by
`docs/spec/help-overlay.md`; this resolver owns only the key binding.

**Arrow-key panning** — resolved in the same slot as `?` (after the editable
guard, before the bare-key modifier guard), because Shift is the step
multiplier here, not a suppressor:

| Key | Action | Active when |
|-----|--------|-------------|
| `←` `→` `↑` `↓` | `{ type: 'pan', dx, dy }` — pan the active canvas by `PAN_STEP` (5) screen px in the arrow's direction; `PAN_STEP_FAST` (25) with Shift held | `view === 'graph'` or `view === 'flow'`, not while typing |

`(dx, dy)` is the direction the **viewport** moves; consumers slide their
content the opposite way (`GraphViewHandle.panBy` → `cy.panBy({ x: -dx, y: -dy })`;
`FlowsViewHandle.panBy` → the flow SVG's registered zoom/pan control, which
converts screen px to viewBox units with the same mapping as the pointer
drag-pan). The action fires on every `keydown`, so OS auto-repeat gives
continuous scrolling while a key is held. Gated off `ctrl`/`meta`/`alt`
(OS text/history chords like `Cmd`+`←` pass through), suppressed in editable
context (the text cursor keeps moving in inputs), and `null` on the dict view
(the Dictionary is a native scroll container — hijacking arrows would break
page scroll). `PAN_STEP`/`PAN_STEP_FAST` are exported constants in
`src/app/logic/shortcuts.ts`.

## Success criteria

- [ ] `resolveShortcut(event, view, editable)` is a pure function in `src/app/logic/shortcuts.ts`, no DOM/React imports, exporting a `ShortcutAction` discriminated union.
- [ ] `resolveShortcut` returns the correct action for every row of the keymap, `null` for unmapped keys, `null` whenever any modifier is held, `null` when `editable` is true, and `null` for `l`/`b` when the active view is wrong.
- [ ] `DictionaryView` is a `forwardRef` exposing `DictionaryViewHandle { toggleLens(): void }`; `toggleLens` flips `read ↔ browse` via the existing `switchLens` (so its hover/pin/focus resets still run) and persists to `ignatius-dict-lens`.
- [ ] A `useKeyboardShortcuts` hook registers exactly one global `keydown` listener, computes the `editable` guard from the event target / `document.activeElement`, calls `resolveShortcut`, dispatches the action through shell-supplied callbacks, and `preventDefault`s only on a matched action. Listener is removed on unmount.
- [ ] Shell (`App.tsx`) wires the hook: `g`/`d`/`f` → `setView`; `l` → the existing layout-toggle path (`setLayoutMode` + `graphViewRef.applyLayoutMode`); `b` → `dictViewRef.toggleLens()`.
- [ ] A Playwright check (`test/checks/test-keyboard-shortcuts.ts`) against the served app proves, in the real browser: `g`/`d`/`f` change the active view (hash + visible view); `l` in Graph changes the layout mode; `b` in Dict flips the lens; a keystroke while the DD search input is focused does **not** switch view.
- [ ] Discoverability: the controls that already own each action show their key hint — FAB view items (`g`/`d`/`f`) and layout toggle (`l`), and the DD lens control (`b`). No new overlay.
- [ ] `bun run test` passes (all `test/checks/*.ts`, exit 0).
- [ ] Touched source files (`App.tsx`, `DictionaryView.tsx`, `FabMenu.tsx`, new `logic/shortcuts.ts`, new `hooks/useKeyboardShortcuts.ts`) introduce **zero** new `tsc --noEmit` errors vs. the baseline (`tmp/baseline-typecheck.log`; these files start at 0).
- [ ] CLAUDE.md feature map gets a "Keyboard navigation shortcuts" row; a brief mention added to the relevant user guide (`docs/guides/commands.md` or controls guide).
- [ ] `Cmd`/`Ctrl` + `k` resolves to `{ type: 'search' }` in the same pre-editable-guard slot as the zoom chords (gated on `ctrl`/`meta`, not `alt`/`shift`), so it focuses the active view's search input even while a text field is already focused elsewhere; `test-shortcuts.ts` covers Cmd+k/Ctrl+k → search, editable-bypass, alt/shift → null, and bare `k` (no modifier) → null.
- [ ] Arrow keys resolve to `{ type: 'pan', dx, dy }` on graph/flow per the keymap (5px, 25px with Shift; dict → null; editable → null; ctrl/meta/alt → null); both view handles expose `panBy(dx, dy)` and the shell routes to the active canvas. `test-shortcuts.ts` covers the resolver rows (T25–T29); `test-keyboard-shortcuts.ts` proves in the browser that ArrowRight moves `cy.pan()` by exactly −5px, Shift steps 25px, the flow SVG inner translate moves opposite the viewport with a 5× Shift ratio, and arrows stay inert while a search input is focused.

## Approaches

See `docs/design/keyboard-nav-shortcuts.md`. Chosen: pure resolver + thin hook;
DD lens reached via a new `DictionaryViewHandle` (forwardRef), mirroring
`GraphViewHandle`/`FlowsViewHandle`. Rejected: hoisting lens state to the shell.

## Recommendation

Pure `resolveShortcut` carries all decision logic (keymap + guards) and is unit
tested exhaustively. The `useKeyboardShortcuts` hook is the only DOM-coupled piece
(activeElement guard, listener lifecycle). End-to-end behavior is verified by a
real-browser Playwright check, per the project's "test the actual runtime" lesson.

## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Pure shortcut resolver + exhaustive unit test | `src/app/logic/shortcuts.ts`, `test/checks/test-shortcuts.ts` | atomic-implementer (feature) | 2 | resolver returns correct action / null per keymap + guards |
| 2 | DD lens handle + global hook + shell wiring + browser check | `src/app/views/dict/DictionaryView.tsx`, `src/app/hooks/useKeyboardShortcuts.ts`, `src/app/App.tsx`, `test/checks/test-keyboard-shortcuts.ts` | atomic-implementer (feature) | 4 | real-browser: g/d/f switch view, l toggles layout, b toggles lens, typing is inert |
| 3 | Discoverability hints + docs | `src/app/components/ui/FabMenu.tsx`, `src/app/views/dict/DictionaryView.tsx`, `CLAUDE.md`, `docs/guides/commands.md` | atomic-implementer (surgical) | 3-4 | hints render on FAB + lens control; feature-map + guide rows present |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Letter key fires while typing in search → view jumps unexpectedly | med | `editable` guard in `resolveShortcut`; Playwright check asserts typing is inert |
| `forwardRef` conversion of the 720L+ `DictionaryView` introduces a regression | low | Surgical wrapper only; existing render path untouched; `bun run test` + browser check |
| Playwright check flakiness on view-change timing | med | Assert on the hash + a stable visible-view selector with `waitForFunction`, not a sleep |
| `b`/`l` global keys interfere with the DD browse-lens `Escape` flow | low | Keymap uses no `Escape`; context-gated; existing Escape listeners untouched |

## Implementation log

- CP1 — pure `resolveShortcut` resolver + 33-assertion unit test (`5bcecd7` plan, `2c6442f`). Reviewer PASS; one `as`-cast 🟡 in the test fixed in-iteration.
- CP2 — `DictionaryViewHandle { toggleLens }` (forwardRef), `useKeyboardShortcuts` hook (single window listener, latest-config-in-ref to avoid stale closures, editable/modifier guards), shell wiring, real-browser Playwright check (`c67b2f7`). Reviewer PASS, 0 findings.
- CP3 — `kbd-hint` discoverability badges on FAB (G/D/F/L) + DD lens (B), `.kbd-hint` themed via existing vars, feature-map row, commands guide (`ca1ac15`). Reviewer PASS; 2 🔵 markdown-blank-line nits were false positives (blanks already present, awk-confirmed).
- Verify: `build:cli` clean; `bun run test` exit 0 (604 PASS incl. live browser check 9/9); 0 new typecheck errors in shipped code; `ignatius validate` clean.

**Squashed to aacc155 — 2026-06-16.** Per-iteration SHAs above are historical (unreachable from any branch).

- CP4 (viewer-ux-polish #4) — extended `resolveShortcut` with modifier-gated zoom actions (`zoomIn`/`zoomOut`/`zoomReset` added to the `ShortcutAction` union), resolved before the bare-key editable/modifier guards and gated on `ctrl`/`meta` (not `alt`/`shift`). `useKeyboardShortcuts` gained `onZoomIn`/`onZoomOut`/`onZoomReset` callbacks; shell routes them to the active view handle (graph → `GraphViewHandle`, flow → `FlowsViewHandle`, dict → no-op). `test/checks/test-shortcuts.ts` extended (T11–T15) covering both modifier keys × graph/flow, editable-bypass, alt/shift→null, bare-key→null, exact action shape. The full keyboard-zoom contract is owned by `docs/spec/viewer-ux-polish.md` (CP4); this spec carries the resolver-level keymap.

## Change log

- 2026-06-19 — Added the modifier-gated zoom keymap + guard class (CP4, viewer-ux-polish #4). The original bare-key keymap (g/d/f/l/b) is unchanged.

### 2026-06-20 — `?` help key added to the resolver

**What changed:** `resolveShortcut` now returns `{ type: 'help' }` for `?`, and the `ShortcutAction` union + `useKeyboardShortcuts` (`onHelp` callback) carry it. `?` is resolved after the editable guard but before the bare-key modifier guard (its character inherently needs Shift), gated off `ctrl`/`meta`/`alt`. `test-shortcuts.ts` T16 covers it. The overlay it opens is a separate feature (`docs/spec/help-overlay.md`).

**Why:** First-time viewers need an in-app orientation; `?` is the conventional help key.

**Superseded:** the non-goal "A help / cheat-sheet overlay" — the resolver now owns the `?` binding; the overlay itself moved to its own spec.

### 2026-07-14 — `/` search-focus key added to the resolver

**What changed:** `resolveShortcut` now returns `{ type: 'search' }` for `/`, added to the `ShortcutAction` union and the bare-key keymap table. Unlike `?`, `/` needs no Shift, so it resolves through the ordinary bare-key switch (after both guards) rather than a special pre-modifier-guard slot. `useKeyboardShortcuts` carries an `onSearch` callback; the shell (`App.tsx`) routes it to the active view's search input — the graph/flow `SearchBar`'s focus handle, or `DictionaryViewHandle.focusSearch()` on the Dictionary. `test-shortcuts.ts` T17–T19 cover it (bare key on every view, ctrl/meta/alt → null, editable → null).

**Why:** the graph-flow-search feature (`docs/spec/graph-flow-search.md`, SC8) adds search bars to all three views and needs a keyboard shortcut to focus them; `/` is the conventional search-focus key. The search feature itself (bars, matching, dimming, results) is owned by that spec — this resolver owns only the key binding.

### 2026-07-14 — `Cmd`/`Ctrl`+`k` joins the modifier-gated slot as a second search-focus route

**What changed:** `resolveShortcut` now also returns `{ type: 'search' }` for `Cmd`/`Ctrl` + `k`, resolved in the same pre-editable-guard slot as the zoom chords (gated on `ctrl`/`meta`, not `alt`/`shift`) — so it focuses the active view's search input even while typing elsewhere, unlike bare `/` which stays suppressed in editable context. The section formerly titled "Modifier-gated zoom" is now "Modifier-gated zoom + search" to reflect the added row. `test-shortcuts.ts` covers Cmd+k/Ctrl+k → search, editable-bypass, alt/shift → null, and bare `k` (no modifier) → null.

**Why:** user feedback on the live graph-flow-search branch (`docs/spec/graph-flow-search.md` CP5, SC8) — `Cmd`/`Ctrl`+`K` is the conventional "focus search" chord in modern web apps and users expect it to work regardless of where focus currently is.

### 2026-07-14 — Arrow-key canvas panning

**What changed:** `resolveShortcut` now returns `{ type: 'pan', dx, dy }` for the arrow keys on the graph and flow views — `PAN_STEP` (5) screen px per keydown, `PAN_STEP_FAST` (25) with Shift, resolved in the same post-editable/pre-modifier-guard slot as `?` since Shift is the step multiplier rather than a suppressor; ctrl/meta/alt chords and the dict view fall through to null. The body gained an "Arrow-key panning" keymap section. `useKeyboardShortcuts` carries an `onPan(dx, dy)` callback; the shell routes it to a new `panBy(dx, dy)` on `GraphViewHandle` (→ `cy.panBy` negated) and `FlowsViewHandle` (→ the flow SVG's registered zoom/pan control, screen-px→viewBox conversion shared with the pointer drag-pan). `test-shortcuts.ts` T25–T29 cover the resolver; `test-keyboard-shortcuts.ts` tests 5–7 prove the browser behavior on both canvases plus the editable guard.

**Why:** user request — the DG and DFD canvases were mouse-only for scrolling; arrow keys with keydown auto-repeat give continuous keyboard scrolling, and Shift gives a faster stride.
