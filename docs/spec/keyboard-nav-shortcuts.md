# Keyboard navigation shortcuts

## Goal

Plain-key keyboard shortcuts in the unified SPA for the three high-frequency
navigation toggles: jump between Graph/Dictionary/Flows views, toggle the DG
layout (organic ↔ hierarchical), toggle the DD lens (read ↔ browse). Shortcuts
never fire while typing or under a modifier chord. Implements issue #13.

## Non-goals

- Per-node / per-edge keyboard navigation inside a diagram.
- Remappable / configurable bindings.
- A theme-toggle shortcut (not one of the issue's three asks).
- A help / cheat-sheet overlay.

## Keymap (contract)

| Key | Action | Active when |
|-----|--------|-------------|
| `g` | view → `graph` | any view |
| `d` | view → `dict` | any view |
| `f` | view → `flow` | any view |
| `l` | toggle DG layout `organic ↔ hierarchical` | `view === 'graph'` |
| `b` | toggle DD lens `read ↔ browse` | `view === 'dict'` |

Bail (no action) when: `ctrlKey || metaKey || altKey || shiftKey`, OR focus is an
editable target (`input` / `textarea` / `select` / `contenteditable` / inside an
open `.modal`). `l` and `b` resolve to no action when their view is not active.
View jumps are idempotent.

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

## Change log

<!-- empty on creation -->
