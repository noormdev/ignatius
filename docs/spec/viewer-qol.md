# Viewer quality of life


## Goal


Viewer fixes: markdown typography, a persisted settings store with a Settings modal that also holds the theme, a sidebar edge tab, scroll memory for the dictionary and its sidebar, themeable Mermaid diagrams in markdown bodies, export of the model as currently seen, a focus trap in every modal, keyboard shortcuts for the previous layout, layout reset, copy link and group hide, a Hide / Show button per group, and keycaps in the help overlay.


## Non-goals


- Migrating existing `ignatius-*` localStorage keys into `ignatius-settings`.
- Per-column hiding.
- An "Export HTML" item in static mode.
- Mermaid anywhere but markdown bodies.
- Changing `ignatius export` CLI flags or output when no view state is passed.


## Success criteria


**Focus trap**

- [x] `Modal` renders `role="dialog"`, `aria-modal="true"` and `aria-labelledby` set to its `<h1>`'s id.
- [x] While a `Modal` is the top of `modalStack`, Tab from the last focusable element moves focus to the first, Shift+Tab from the first moves to the last, and focus that lands outside the modal (click on the backdrop excluded) is pulled back to the first focusable element. A stacked modal traps; the one beneath it does not react.
- [x] On unmount, focus returns to the element focused when the modal mounted, when that element is still connected.

**Markdown typography**

- [x] Every markdown site listed in the design (`App.tsx` groups modal, `DictionaryView` group desc, externals, stores, `EntityModal`, `EntityCard`, `FlowNodeModal`, `FlowDocModal`, `StackDialog`, `ChangesPanel`, `ProcessCard`) carries class `md` beside its existing wrapper class.
- [x] `.md` in `styles.css` defines: `line-height: 1.65`; paragraph and list bottom margin `0.85em`; `li + li` top margin `0.3em`; nested lists without bottom margin; `h1`–`h6` scale with top margin `1.4em` and bottom margin `0.5em`; first child top margin 0 and last child bottom margin 0; `pre` (non-shiki) styled like `.shiki`; `blockquote` with a left border in `--color-border` and muted text; `hr`; `img { max-width: 100% }`; tables spaced `0.85em` from neighbours; direct-child paragraphs, lists, blockquotes and headings capped at `max-width: 72ch` (tables, code and diagrams keep the full width). Colours only from existing CSS variables.
- [x] Wrapper rules for `p`, `ul`, `ol`, `li`, `h1`–`h6` under `.doc-body`, `.dict-entity-body`, `.flow-node-body` and `.flow-node-body--process` that `.md` replaces are removed. `.doc-section h2` (section labels outside markdown) is unchanged.
- [x] Screenshots of an entity body, a process body and the entity modal in both themes show the new rhythm (`test/visual/screenshot-md-typography.ts`).

**Settings**

- [x] `src/app/logic/settings.ts` exports `Settings` (`{ alwaysOpenExamples: boolean }`), `DEFAULT_SETTINGS`, `parseSettings(raw: string | null): Settings` (invalid JSON, non-object, or a wrong-typed field → that field's default) and `SETTINGS_STORAGE_KEY = 'ignatius-settings'`.
- [x] Settings live in a module-level store in `src/app/hooks/useSettings.ts`, seeded once from localStorage. `useSettings()` reads it through `useSyncExternalStore` and returns `[settings, update(patch)]`. `update` merges into the current store value (two patches in one tick both land), writes JSON to localStorage (write errors swallowed), and notifies subscribers. No provider is needed, so every React root (the app shell and the flow dialog root) reads the same settings.
- [x] A FAB item "Settings" in every view opens `SettingsModal` (built on `Modal`). It groups settings into titled sections of bordered cards, one row per setting with a label and a hint on the left and the control on the right. **Appearance** holds Theme, a Light/Dark segmented control over native radios that calls `useThemeMode`'s `setTheme` (stored in `ignatius-theme`). **Content** holds "Always open examples", a `role="switch"` checkbox. The header has no theme button; the help button takes its corner and `--toggle-region` is the help button's span. Screenshots: `test/visual/screenshot-settings.ts`.
- [x] With `alwaysOpenExamples` on, `ExamplesAccordion` (both variants) and `ProcessExamples` render every `<details>` open; off keeps the `<= 3` rule.
- [x] The setting survives reload.

**Sidebar tab**

- [x] In the Dictionary view with the sidebar closed, a `button.dict-nav-tab` (aria-label "Open sidebar") is fixed to the right edge, vertically centred. It shows a three-line icon above the text "Sidebar". At rest only a 10-16 px lip is on-screen: a 4 px `--color-link` left edge and a dotted grip, with the icon and label at opacity 0. On `:hover` or `:focus-visible` it is fully on-screen and the icon and label show, with a transform transition under 200 ms that is disabled under `prefers-reduced-motion`. An invisible hover target extends 16 px left of the tab, so the lip is easy to catch.
- [x] Clicking it opens the sidebar. While the sidebar is open the tab is not rendered.
- [x] `.dict-nav-panel` gains a close button (aria-label "Close sidebar") in its top row.
- [x] Open state persists in localStorage `ignatius-dict-nav-open` (`'true'`/absent). FAB "Toggle sidebar" keeps working.
- [x] The tab is hidden at `max-width: 768px` and in print, like the panel.

**Scroll memory**

- [x] `src/app/hooks/useScrollMemory.ts` exports `useScrollMemory(ref, key, deps)`. It saves `ref.current.scrollTop` to sessionStorage under `key` at most once per animation frame. When `deps` change, it restores the saved value in a layout effect, then again on the next animation frame if the first attempt was clamped.
- [x] `.dict-view` uses key `ignatius-scroll-dict`, restored on mount, when `view` becomes `'dict'`, and when `model` changes. `.dict-nav-panel` uses `ignatius-scroll-dict-nav`, restored on mount, when it opens, and when `model` changes.
- [x] Playwright check `test/checks/test-scroll-memory.ts`: scroll the dictionary to 2000 px, then (a) touch a model file and wait for the SSE reload, (b) switch to Graph and back, (c) reload the page. After each, `scrollTop` is within 4 px of 2000. Same for the sidebar after a reload.

**Mermaid**

- [x] Both markdown-it instances render a fence whose info string is `mermaid` as `<div class="mermaid-diagram">ESCAPED_SOURCE</div>`. Other fences are unchanged. Covered by `test/checks/test-mermaid-fence.ts` for an entity body and a process body.
- [x] `src/app/mermaid-entry.ts` imports `mermaid` and assigns it to `window.__IGNATIUS_MERMAID__`. `build:bundle` also builds it to `dist/static/mermaid.js` (stable name, minified). `mermaid` is a dependency in `package.json`.
- [x] The server serves `GET /static/mermaid.js` (`text/javascript`) from the embedded file. `embedded-bundle.ts` loads it alongside the other bundle files as `mermaidJs`.
- [x] `src/app/logic/mermaid-render.ts`: `loadMermaid()` resolves `window.__IGNATIUS_MERMAID__` and, when absent in live mode, injects `<script src="/static/mermaid.js">` once and awaits it. `renderMermaidIn(root, style)` renders every `.mermaid-diagram:not([data-rendered])` with `mermaid.render`. It sets `data-rendered` and keeps the source in `data-source`, so a theme change can re-render. A failed render shows the source in a `pre` plus the error text inside `.mermaid-diagram.mermaid-error`.
- [x] `useMermaid(rootRef, model, themeMode)` in the app shell: observes the root with a `MutationObserver`, initialises Mermaid with `startOnLoad: false`, `securityLevel: 'strict'`, `theme: 'base'`, `look: 'classic'`, `flowchart.wrappingWidth: 200`, `sequence.actorFontWeight: 600` and the resolved `MermaidStyle` (`themeVariables` plus `themeCSS`). On theme-mode change it re-renders all diagrams. It loads nothing when no `.mermaid-diagram` exists.
- [x] `src/theme/mermaid-theme.ts`: `MermaidThemeConfig = { stroke_width?: number; radius?: number; shadow?: boolean; node_fills?: string[]; dark?: Record<string, string | number>; light?: … }` on `ThemeConfig.mermaid`. `resolveMermaidStyle(theme, mode)` returns `{ themeVariables, themeCSS }`. The palette's `background`, `surface`, `text` and `textMuted` reach both only after `SAFE_MERMAID_VALUE`; an unsafe one is replaced by the default and reported by `mergeTheme`.
    - `node_fills` default `DEFAULT_MERMAID_FILLS`: the dark-mode `semanticColors` independent, dependent, subtype and associative `fg` plus `defaultFlowKinds.dark.queue.fg` (`#58a6ff`, `#d29922`, `#3fb950`, `#f0883e`, `#c4b5fd`), the same in both modes. Each label is coloured against the surface it sits on: a node label black or white, whichever contrasts more with its fill; composite-state and cluster titles palette `text`; ER attribute labels black on their light rows; a Mermaid slot that one colour serves for every fill (gantt task text, pie section text) black or white, whichever has the better worst-case contrast across the fills.
    - `resolveMermaidThemeVariables(theme, mode)` returns the defaults below, overridden by `theme.mermaid[mode]`:

    | Mermaid variable | Default |
    |---|---|
    | `fontFamily` | the app's body font stack |
    | `fontSize` | `14px` |
    | `background`, `clusterBkg`, `edgeLabelBackground` | palette `background` |
    | `primaryColor`, `secondaryColor`, `tertiaryColor` | node fills 1, 2, 3 |
    | `primaryTextColor` | black or white on node fill 1 |
    | `primaryBorderColor`, `clusterBorder` | `#000000` |
    | `lineColor` | palette `text` in light mode, `textMuted` in dark mode |
    | `textColor` | palette `text` |
    | `noteBkgColor` | node fill 3 |

    Beyond the table, the defaults name every diagram family's variables (sequence actors, signals, label boxes, notes, activation; state; class; ER; gantt; pie `pie1`–`pie12`; git `git0`–`git7`; `cScale0`–`cScale11`; quadrant; xy chart; sankey), so no family falls back to Mermaid's built-in colours. Categorical series cycle the node fills. ER attribute rows are white and a 12% tint of fill 1.
    - The theme CSS, built from the resolved variables: node outlines `#000000` at `stroke_width` px (default 3), corner radius `radius` px (default 8), `drop-shadow(3px 5px 8px …)` dark in both modes unless `shadow: false`, node fills cycled per node by `nth-child`, stores (cylinder) on fill 1 and decisions (rhombus) on fill 2, the end state's inner dot black, node labels weight 600 (sequence actor names through `sequence.actorFontWeight: 600` in `mermaid.initialize`, which Mermaid writes inline), connectors at 85% of `stroke_width` (at least 1 px) in `lineColor`, edge labels bold in `transitionLabelColor` on a `background` chip. Node fills, outlines and labels come only from this CSS, so `primaryColor`, `primaryBorderColor` and `primaryTextColor` overrides do not reach flowchart, state, class or ER nodes. `mermaid-render.ts` tags stores and decisions by geometry after insertion, because Mermaid emits no shape class.

- [x] Diagram panel in `styles.css`, on the svg: 12 px padding and a 1 px `--color-border` border (`CANVAS_INSET` 13 in `mermaid-render.ts`, which widens the svg's inline `max-width` by twice that), 10 px radius, `--color-background` with an 18 px dot grid in `--color-border`, `overflow: visible` so shadows paint into the padding. The `.mermaid-diagram` wrapper keeps room for the shadows and scrolls horizontally when the diagram is wider. Inside `.md` the panel is left-aligned with the prose column. `.md` rules for `p`, lists and headings never reach Mermaid labels: the wrapper resets `p` margins inside it. The raw source is hidden until the SVG replaces it, so the source never flashes.
- [x] `mergeTheme` keeps `stroke_width` in 0-8, `radius` in 0-32, a boolean `shadow`, and `node_fills` of 1-12 `#rrggbb` colours. In `theme.mermaid.dark` / `.light` it keeps only numbers and strings that match `/^[\d "#%(),.;A-Za-z-]+$/`. That is Mermaid's directive pattern plus `-` for generic font families. Mermaid writes `initialize()` theme values into the SVG `<style>` unsanitized, so anything else could inject CSS. Any other value, and a non-object block, is dropped; the dropped key paths are recorded on `ThemeConfig.invalidMermaidKeys`, and `validateModel` emits one Tier A warning `config.mermaid_theme_invalid` per path (entity id `ignatius.yml`), so `ignatius validate` prints it and still exits 0.
- [x] `generateApp` inlines `mermaid.js` (escaped like the app JS) before the app script only when a `mermaid-diagram` div occurs in any entity, group, flow node, cluster or change-note body. `test/checks/test-export-mermaid.ts` asserts presence for a model with a fence and absence for one without.
- [x] Mermaid SVG fits its container (`max-width: 100%`, centred, horizontal scroll when wider) and inherits the `.md` block spacing.
- [x] Screenshots: a flowchart and a sequence diagram in a process body, dark and light, plus one with a `theme.mermaid` override (`test/visual/screenshot-mermaid.ts`).
- [x] `useScrollMemory` keeps re-applying the saved position as content grows after a restore. It holds until the user scrolls (wheel, touch, keydown or pointerdown on the container), a scroll it did not make moves the container (a deep link), or about 2 s pass; reaching the position early does not end the hold, because diagrams above it keep growing. No intermediate clamped value is saved. `test-scroll-memory.ts` adds a case with Mermaid diagrams above the saved position: reload, and assert it lands within 4 px. The case is proven by a mutation that removes the continuous restore.

**Export as seen**

- [x] `POST /api/export`, guarded by `isLocalHost` and `isSameOrigin` (403 otherwise). It accepts JSON `{ storage: Record<string, string>, hash: string }`; only keys starting with `ignatius-` and string values are kept, and the body is capped at 5 MB (413). It parses and validates the served model and flows as `ignatius export` does, calls `generateApp` with `viewState`, and responds `text/html` with `Content-Disposition: attachment; filename="<slug of model name or 'model'>.html"`.
- [x] `generateApp` accepts `opts.viewState` and emits `window.__VIEW_STATE__` with it (through `escapeScriptClose`). Without it, output is byte-identical to today's.
- [x] `src/app/logic/view-state.ts`: `collectViewState()` snapshots `ignatius-*` localStorage keys (excluding `ignatius-view-state-applied`) and `location.hash`. `applyViewState()` runs in static mode from `src/app/apply-view-state.ts`, which `main.tsx` imports first, because `useSettings` reads localStorage when its module loads. The server scopes the snapshot before `generateApp`. `ignatius-layout-positions` and `ignatius-flow-layout-positions` keep only the entries for this model's `layoutFingerprint` and flow layout keys, because those stores hold every model served on the same origin. A test asserts a foreign layout key never reaches the export. On the recipient, `applyViewState` runs when `__VIEW_STATE__` is present and its digest differs from the one recorded for this model's `__LAYOUT_KEY__` in `ignatius-view-state-applied`. It then:
    - merges the layout-store entries into the recipient's existing stores, never replacing other models' entries
    - writes every other snapshot key
    - removes preference keys (non-layout `ignatius-*` keys) the snapshot omits, so the file opens as seen
    - records the digest under that layout key
    - sets `location.hash` when the hash is empty

  Whenever `__VIEW_STATE__` is present, the stored `ignatius-theme` wins over the baked `__THEME_MODE__` on every load, so a recipient's theme choice survives reload.
- [x] FAB item "Export HTML" in live mode, in every view. It posts the snapshot and downloads the response via a Blob link; a failure shows the server's error text in the existing banner/toast pattern.
- [x] `test/checks/test-export-view-state.ts`: `generateApp` with and without `viewState`. `test/checks/test-export-as-seen.ts`: hide an entity, switch the lens and layout, export, open the file in a fresh context, and assert the entity is hidden and the lens and layout match.

**Shortcuts and group hide**

- [x] `resolveShortcut` (`src/app/logic/shortcuts.ts`) resolves: `Shift+L` → `prevLayout` on the graph and `toggleFlowView` on the flow view; bare `l` → `toggleFlowView` on the flow view (`toggleLayout` on the graph is unchanged); bare `r` → `resetLayout` on graph and flow, null on dict; `Cmd`/`Ctrl`+`C` without Shift or Alt → `copyLink` on every view; `Shift+H` → `hideSelectionGroups` on the graph. Shift chords resolve after the editable guard and before the modifier guard; all of them are null while typing, and `Shift+L`/`Shift+H` are null with ctrl/meta/alt. Covered by `test-shortcuts.ts` T4, T33–T36.
- [x] `prevLayoutMode` in `graph-edits.ts` steps the layout cycle backwards (`test-graph-edits.ts` 6).
- [x] `useKeyboardShortcuts` lets `copyLink` through to the browser, without `preventDefault`, while `window.getSelection()` is not collapsed, so copying selected text still works.
- [x] Copy link has one implementation: `FabMenu`'s `copyLink`, exposed on `FabMenuHandle` and called by both the menu item and the shortcut; both show the "Copied!" toast.
- [x] `R` runs the same reset as the FAB "Reset layout"; `L` / `Shift+L` on the flow view run the same toggle as the FAB per-process / connected item. The FAB shows `R` on both Reset layout items and `L` on the flow view toggle.
- [x] `GraphViewHandle` gains `hideGroups(groups)`, `showGroups(groups)` and `hideSelectionGroups()`. All three go through the existing `hideNodes` / `showNodes` path, so each is one undo step, the hidden set persists, shows in the crossed-eye list and reaches Export HTML. Entities with no group are never matched; nothing selected is a no-op.
- [x] Each Groups modal card has a button: "Show" when every entity of the group is hidden, "Hide" otherwise.
- [x] `HelpModal` renders each key in the Keyboard section as its own `<kbd>` keycap, `+` between keys of a chord and a muted `·` between alternatives. `.kbd-hint` and the help keycaps share one keycap rule in `styles.css`. Screenshots: `test/visual/screenshot-help-keyboard.ts` (graph and flow, light and dark).
- [x] `test/checks/test-shortcut-actions.ts` (Playwright, models/key-inherited): `Shift+L` steps to the previous layout; `R` puts a moved node back; flow `L` / `Shift+L` flip the flow view and `R` re-renders it; `Ctrl+C` with no selection copies the URL and shows the toast, and with text selected leaves the clipboard to the browser; Groups modal Hide / Show; `Shift+H` hides the selected entity's group and `Ctrl+Z` restores it.

**Surfaces**

- [x] `docs/guides/themes-and-branding.md` gains a Mermaid section (YAML example, defaults table, link to Mermaid's theming docs). `docs/guides/folder-format.md` documents mermaid fences next to "Code in the body". `docs/guides/commands.md` documents Export HTML, Settings and the sidebar tab. `docs/spec/ignatius-project-config.md` lists `theme.mermaid`.
- [x] `skills/ignatius-modeling`: `references/dfd-authoring.md` (step F7) and `references/flow-templates.md` (process template) teach an optional `## Logic` section with a Mermaid flowchart naming the process's inputs, outputs and stores. `references/conventions.md` lists `mermaid` as a fence language that renders as a diagram. `references/entity-flow.md` notes a logic flow may show how an application function touches the table. Each says the logic flow complements the DFD and never replaces a flow, store or process.
- [x] `models/key-inherited` gains one process with a `## Logic` Mermaid flowchart as the worked example.
- [x] `docs/wiki/feature-map.md` gains rows: Markdown typography, Settings, Sidebar tab + scroll memory, Mermaid logic flows, Export as seen, Modal focus trap.


## Approach


Shared class and shared primitives in place of per-site fixes; Mermaid as a lazily loaded sidecar bundle. See [`docs/design/viewer-qol.md`](../design/viewer-qol.md).


## Change tree


```
package.json ........................................ M  (mermaid ~12.2.0, build:bundle builds mermaid.js)
bun.lock ............................................ M  (mermaid)
src/
├── cli/cli.ts ...................................... M  (export calls exportModel)
├── router/agents.ts ................................ M  (export slugify)
├── app/
│   ├── App.tsx ..................................... M  (Settings modal state, dictNavOpen persistence, useMermaid, export action, md class on groups modal, Hide/Show per group, shortcut wiring)
│   ├── main.tsx .................................... M  (imports apply-view-state first)
│   ├── apply-view-state.ts ......................... A  (side-effect module: applyViewState in static mode)
│   ├── globals.d.ts ................................ M  (__VIEW_STATE__, __IGNATIUS_MERMAID__)
│   ├── mermaid-entry.ts ............................ A
│   ├── styles.css .................................. M  (.md, .dict-nav-tab, mermaid, settings modal, .fab-toast, shared keycap, .group-card-toggle)
│   ├── components/
│   │   ├── ui/Modal.tsx ............................ M  (focus trap, dialog roles, focus restore)
│   │   ├── ui/FabMenu.tsx .......................... M  (Settings, Export HTML items, FabMenuHandle.copyLink, R/L hints)
│   │   ├── ui/HelpModal.tsx ........................ M  (keycap Keyboard section, new keys)
│   │   ├── ui/SettingsModal.tsx .................... A
│   │   ├── entity/ExamplesAccordion.tsx ............ M  (alwaysOpenExamples)
│   │   ├── entity/EntityCard.tsx ................... M  (md class)
│   │   ├── entity/EntityModal.tsx .................. M  (md class)
│   │   ├── entity/SpotlightOverlay.tsx ............. M  (--font-mono on chip text)
│   │   ├── process/ProcessExamples.tsx ............. M  (alwaysOpenExamples)
│   │   ├── process/ProcessCard.tsx ................. M  (md class)
│   │   ├── flow-node/FlowNodeModal.tsx ............. M  (md class)
│   │   ├── flow-node/FlowDocModal.tsx .............. M  (md class)
│   │   ├── flow-node/StackDialog.tsx ............... M  (md class)
│   │   └── changes/ChangesPanel.tsx ................ M  (md class)
│   ├── hooks/
│   │   ├── useKeyboardShortcuts.ts ................. M  (new actions, copyLink selection check)
│   │   ├── useThemeMode.ts ......................... M  (setTheme)
│   │   ├── useSettings.ts .......................... A
│   │   ├── useScrollMemory.ts ...................... A
│   │   └── useMermaid.ts ........................... A
│   ├── logic/
│   │   ├── shortcuts.ts ............................ M  (prevLayout, toggleFlowView, resetLayout, copyLink, hideSelectionGroups)
│   │   ├── settings.ts ............................. A
│   │   ├── storage-keys.ts ......................... A  (layout store key constants, DOM-free)
│   │   ├── mermaid-render.ts ....................... A
│   │   └── view-state.ts ........................... A
│   ├── views/graph/layout-store.ts ................. M  (merge)
│   ├── views/graph/graph-edits.ts .................. M  (prevLayoutMode)
│   ├── views/graph/GraphView.tsx ................... M  (hideGroups, showGroups, hideSelectionGroups)
│   ├── views/flow/FlowsView.tsx .................... M  (shared flow store key)
│   └── views/dict/DictionaryView.tsx ............... M  (md class, sidebar tab + close, scroll memory)
├── model/parse.ts .................................. M  (mermaid fence rule)
├── flows/flow-markdown.ts .......................... M  (mermaid fence rule)
├── flow-view/FlowChrome.tsx ........................ M  (header comment: theme lives in Settings)
├── model/markdown-mermaid.ts ....................... A  (shared fence rule plugin)
├── model/validate.ts ............................... M  (config.mermaid_theme_invalid)
├── theme/theme-defaults.ts ......................... M  (ThemeConfig.mermaid, mergeTheme, mermaidKeyMessage)
├── theme/mermaid-theme.ts .......................... A
├── generators/app.ts ............................... M  (viewState, conditional mermaid inline)
├── generators/export-model.ts ...................... A  (parse → validate → flows → review → generateApp, shared by CLI and server)
├── generators/embedded-bundle.ts ................... M  (mermaidJs)
└── server/server.ts ................................ M  (/static/mermaid.js, POST /api/export)
test/checks/
├── test-modal-focus-trap.ts ........................ A
├── test-settings.ts ................................ A
├── test-settings-always-open.ts .................... A
├── test-sidebar-tab.ts ............................. A
├── test-scroll-memory.ts ........................... A
├── test-mermaid-fence.ts ........................... A
├── test-mermaid-theme.ts ........................... A
├── test-export-mermaid.ts .......................... A
├── test-export-view-state.ts ....................... A
├── test-export-as-seen.ts .......................... A
├── test-shortcut-actions.ts ........................ A
├── test-shortcuts.ts ............................... M  (T4, T33–T36)
├── test-graph-edits.ts ............................. M  (prevLayoutMode)
├── test-graph-fit-clear.ts ......................... M  (help toggle corner)
├── test-dict-search-branding-overlap.ts ............ M  (help toggle corner)
├── test-viewer-search-branding-overlap.ts .......... M  (help toggle corner)
├── test-app-gen-zero-diagrams.ts ................... M  (stub bundle gains mermaidJs)
├── test-app-title.ts ............................... M  (stub bundle gains mermaidJs)
├── test-graph-branding.ts .......................... M  (stub bundle gains mermaidJs)
├── test-layout-key-injection.ts .................... M  (stub bundle gains mermaidJs)
└── test-router-index.ts ............................ M  (digests follow the Collect-Payment edit)
test/visual/
├── screenshot-md-typography.ts ..................... A
├── screenshot-mermaid.ts ........................... A
├── screenshot-help-keyboard.ts ..................... A
├── screenshot-settings.ts .......................... A
├── theme.ts ........................................ A  (setTheme, toggleTheme through Settings)
└── theme-switching scripts ......................... M  (switch theme through theme.ts)
models/key-inherited/ ............................... M  (Collect-Payment ## Logic, regenerated routers)
README.md ........................................... M
docs/design/viewer-qol.md ........................... A
docs/guides/{themes-and-branding,folder-format,commands,validation,flows,modeling-skill,building-from-source}.md  M
docs/spec/help-overlay.md ........................... M  (help button corner)
docs/spec/ignatius-project-config.md ................ M
docs/wiki/{feature-map,validate}.md ................. M
skills/ignatius-modeling/references/{dfd-authoring,flow-templates,conventions,entity-flow,verification}.md  M
```


## Outline


```
src/app/components/ui/Modal.tsx
  Modal — adds dialog roles, Tab trap while top of stack, focus restore on unmount
  focusableIn — focusable descendants of the modal in DOM order

src/app/logic/settings.ts
  Settings — persisted viewer preferences
  DEFAULT_SETTINGS — alwaysOpenExamples: false
  parseSettings — raw localStorage string → Settings, per-field fallback
  SETTINGS_STORAGE_KEY — 'ignatius-settings'

src/app/hooks/useSettings.ts
  settings store — module-level value + subscriber set, seeded from localStorage
  useSettings — useSyncExternalStore read; update merges, writes, notifies

src/app/components/ui/SettingsModal.tsx
  SettingsModal — Modal of titled sections: Appearance (Theme segmented control), Content (Always open examples switch)

src/app/hooks/useThemeMode.ts
  setTheme — stores and applies the chosen mode

src/app/hooks/useScrollMemory.ts
  useScrollMemory — save scrollTop per frame, restore on deps change

src/app/views/dict/DictionaryView.tsx
  nav tab button — inline edge tab shown while the sidebar is closed
  nav close button — closes the sidebar from inside the panel

src/app/logic/shortcuts.ts
  ShortcutAction — gains prevLayout, toggleFlowView, resetLayout, copyLink, hideSelectionGroups

src/app/views/graph/graph-edits.ts
  prevLayoutMode — the mode before this one in the layout cycle

src/app/views/graph/GraphView.tsx
  GraphViewHandle — gains hideGroups, showGroups, hideSelectionGroups
  groupMembers — entity ids whose group is in the given set

src/app/components/ui/FabMenu.tsx
  FabMenuHandle — copyLink, shared by the menu item and the shortcut

src/app/components/ui/HelpModal.tsx
  ShortcutRow — chords and a description
  Keys — keycaps joined by + within a chord and · between chords
  ShortcutSection — the Keyboard section

src/model/markdown-mermaid.ts
  mermaidFencePlugin — markdown-it fence override for info string 'mermaid'

src/theme/mermaid-theme.ts
  MermaidThemeConfig — node style keys plus per-mode Mermaid themeVariables overrides
  DEFAULT_MERMAID_FILLS — entity colours at full strength
  resolveMermaidThemeVariables — palette and fill defaults merged with overrides
  themeCSS — outlines, radius, shadow, fill cycle, label colours and weight
  safePalette — palette colours that pass SAFE_MERMAID_VALUE, else defaults
  resolveMermaidStyle — both halves for mermaid.initialize

src/theme/theme-defaults.ts
  readMermaidTheme — keep valid style keys and mode values, list the rest
  readNumberInRange — range check for stroke_width and radius
  mermaidKeyMessage — the finding text per invalid key path
  DIAGRAM_PALETTE_KEYS — palette colours diagrams use, checked in mergeTheme

src/app/logic/mermaid-render.ts
  loadMermaid — global or one-time script injection
  renderMermaidIn — render pending diagrams, error fallback
  rerenderAll — clear data-rendered and render again

src/app/hooks/useMermaid.ts
  useMermaid — observer on app root, initialise per theme mode

src/app/views/graph/layout-store.ts
  merge — fold imported entries into the store, stamp savedAt, prune to the newest, drop malformed entries

src/app/logic/view-state.ts
  collectViewState — snapshot ignatius-* keys and hash
  applyViewState — runs seedOnce, then sets __THEME_MODE__ from the stored ignatius-theme on every load
    seedOnce — one-time seed per model by digest; merges layout stores, clears omitted preference keys
  downloadExport — POST snapshot, Blob download, server error text on failure

src/app/apply-view-state.ts
  (side effect) — applyViewState in static mode, imported first by main.tsx

src/generators/app.ts
  ViewState — { storage, hash }
  generateApp — opts.viewState, mermaid inlined when the injected JSON holds a mermaid-diagram div

src/generators/export-model.ts
  exportModel — parse → validate → flows → review → generateApp, shared by CLI export and POST /api/export
  scopeViewState — reduce layout stores to this model's layout keys

src/server/server.ts
  GET /static/mermaid.js — serves the sidecar bundle
  POST /api/export — guarded, builds HTML with view state, attachment response

skills/ignatius-modeling/references/dfd-authoring.md
  F7 Bodies — Logic subsection: when and how to add a Mermaid logic flow
skills/ignatius-modeling/references/flow-templates.md
  Process template — optional ## Logic block
skills/ignatius-modeling/references/conventions.md
  Code fences — mermaid renders as a diagram
skills/ignatius-modeling/references/entity-flow.md
  E9 narrative — logic flow of an application function against the table
```


## Flows


**Tab inside a modal**

1. User opens an entity modal → `Modal` mounts, records `document.activeElement`, focuses close button.
2. User presses Tab on the last focusable element → `keydown` handler (top of stack only) prevents default, focuses the first.
3. User presses Escape → `onClose` → unmount → focus returns to the recorded element.

**Turn on "Always open examples"**

1. User opens FAB → Settings → `SettingsModal`.
2. Checks "Always open examples" → `update({ alwaysOpenExamples: true })` → localStorage `ignatius-settings` written.
3. Store notifies subscribers → `ExamplesAccordion` / `ProcessExamples` in every React root re-render → every `<details>` open.
4. Reload → `useSettings` reads the key → still open.

**Open the sidebar from the tab**

1. User hovers the right edge in the Dictionary → `.dict-nav-tab` slides fully in.
2. Click → `setDictNavOpen(true)` → `ignatius-dict-nav-open` = `'true'`; tab unmounts; panel slides in and restores its scroll.
3. Close button → panel closes, key removed, tab returns.

**Model reload keeps scroll**

1. Author saves a model file → SSE `model-changed` → `setModel`.
2. `useScrollMemory` deps change → layout effect sets `.dict-view.scrollTop` to the saved value; one rAF retry if clamped.

**Render a Mermaid logic flow**

1. Parser renders the process body; the fence becomes `div.mermaid-diagram`.
2. Dictionary renders the body → `MutationObserver` sees an unrendered diagram.
3. `loadMermaid` injects `/static/mermaid.js` once → `mermaid.initialize` with the resolved `MermaidStyle` (`themeVariables` and `themeCSS`) → `mermaid.render` → SVG replaces the source → `widenForPadding` and `tagFlowchartShapes`.
4. User toggles theme → `rerenderAll` with the other mode's `MermaidStyle`.

**Hide a group**

1. User opens FAB → Groups and clicks Hide on a card → `GraphViewHandle.hideGroups([name])` → `hideNodes` pushes one undo step and hides every entity of the group.
2. The card's button reads Show; clicking it → `showGroups([name])` → `showNodes`.
3. Or: user selects an entity and presses `Shift+H` → `hideSelectionGroups()` hides every entity sharing a group with the selection; `Cmd`/`Ctrl`+`Z` restores them in one step.

**Copy link from the keyboard**

1. User presses `Cmd`/`Ctrl`+`C` outside a text field → resolver returns `copyLink`.
2. Text is selected → the hook returns without `preventDefault`; the browser copies the text.
3. Nothing selected → `FabMenuHandle.copyLink()` writes `location.href` and shows "Copied!".

**Export as seen**

1. User hides an entity, sets the lens, clicks FAB → Export HTML.
2. App posts `collectViewState()` to `/api/export`.
3. Server checks the guards and reads the body under a 5 MB cap. `exportModel` parses and validates, then `scopeViewState` cuts the layout stores to this model's keys. `generateApp({ viewState })` inlines mermaid.js only if a body has a diagram → attachment.
4. Recipient opens the file → `apply-view-state.ts` runs before any other module → on a new digest for this model's layout key, it clears omitted preference keys, merges the layout stores, writes the other keys and sets an empty hash → on every load, `__THEME_MODE__` takes the stored `ignatius-theme` → app mounts with the entity hidden, the same lens and the recipient's theme.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Modal focus trap | `Modal.tsx`, test | atomic-implementer (mode: surgical) | 2 | `test-modal-focus-trap.ts`, Playwright Tab cycle |
| 2 | Markdown typography | `styles.css`, 11 markdown sites, screenshot script | atomic-implementer (mode: feature) | 13 | `screenshot-md-typography.ts` both themes |
| 3 | Settings store + modal + always-open examples | `settings.ts`, `useSettings.ts`, `SettingsModal.tsx`, `FabMenu.tsx`, `App.tsx`, accordions | atomic-implementer (mode: feature) | 8 | `test-settings.ts`, reload persists |
| 4 | Sidebar tab, close button, open-state persistence | `DictionaryView.tsx`, `App.tsx`, `styles.css`, visual test | atomic-implementer (mode: feature) | 4 | `test-sidebar-tab.ts` + screenshots |
| 5 | Scroll memory | `useScrollMemory.ts`, `DictionaryView.tsx`, visual test | atomic-implementer (mode: feature) | 3 | `test-scroll-memory.ts` |
| 6 | Mermaid parse, bundle, render, theme config; restore under async growth | parse, theme, generators, server, app hooks, `useScrollMemory.ts`, build scripts, tests | atomic-implementer (mode: feature) | 19 | mermaid checks, `screenshot-mermaid.ts`, `test-scroll-memory.ts` growth case |
| 7 | Export as seen | `server.ts`, `app.ts`, `view-state.ts`, entry, `FabMenu.tsx`, tests | atomic-implementer (mode: feature) | 8 | `test-export-view-state.ts`, `test-export-as-seen.ts` |
| 8 | Guides, config spec, skill, example model, feature map | `docs/`, `skills/`, `models/key-inherited` | atomic-implementer (mode: feature) | 10 | surfaces agree |
| 9 | Shortcuts, group hide, help keycaps | `shortcuts.ts`, `useKeyboardShortcuts.ts`, `graph-edits.ts`, `GraphView.tsx`, `FabMenu.tsx`, `HelpModal.tsx`, `App.tsx`, `styles.css`, tests, docs | atomic-implementer (mode: feature) | 14 | `test-shortcuts.ts`, `test-shortcut-actions.ts`, `screenshot-help-keyboard.ts` |


## Risks


- Mermaid render races a view switch: the observer renders into a `display:none` subtree, where Mermaid can measure 0 widths. Render only diagrams whose `offsetParent` is non-null, and render the rest when they become visible.
- The `/static/mermaid.js` script tag fails offline or behind a proxy that strips it. The error fallback shows the source, so the body stays readable.
- `scroll` restore fights the existing `scrollIntoView` deep links (pending process scroll). The deep link wins by effect order: App's process scroll runs in a rAF registered from a passive effect, after the Dictionary's layout-effect restore and its retry. `test-scroll-memory.ts` asserts a process deep link lands on the process.
- Mermaid diagrams render asynchronously and grow bodies over several frames after a restore. The hold re-applies the saved position as content grows, from the restore until user input, a scroll the hook did not make, or about 2 s; reaching the target does not end it.
- The export route rebuilds the model on each request. This is acceptable for a click-driven action.


## Change log


### 2026-10-27 — Initial spec

**What changed:** Spec created from the model owner's seven requests.

**Why:** Daily-use feedback on the viewer.

### 2026-10-27 — Mermaid styling scope

**What changed:** Theme defaults cover every Mermaid diagram family, and the diagram frame, node borders and interiors get explicit CSS, ported from atomic's serve frontend.

**Why:** Model owner, at contract approval: "style the insides and borders too, like how noorm and atomic are styled".

### 2026-10-27 — Settings as a module store

**What changed:** Settings are a module-level store read through `useSyncExternalStore`, with no React context or provider.

**Why:** Flow dialogs render in their own React root. A context needed a second provider plus register/seed/effect plumbing in `FlowsView`, and any future root that renders an examples table without a provider would crash. CP3 review.

**Superseded:** `useSettings` re-rendered consumers through a `SettingsContext` provided at the app shell.

### 2026-10-27 — Correction: deep-link precedence by effect order

**What changed:** Correction. Scroll restore no longer checks a pending deep-link flag. The process deep link wins because its rAF runs after the restore.

**Why:** CP5 review. The skip could not be observed, and it stayed set after an `onNavigateToProcess` call that did not change the view, which silently disabled later restores.

**Superseded:** Restore was skipped while `pendingScrollProcessIdRef` was set.

### 2026-10-27 — Correction: restore hold and badge palette

**What changed:** Correction. The growth restore holds until user input, a scroll it did not make, or about 2 s. Reaching the target does not end it. Categorical Mermaid series use five badge backgrounds plus `link`.

**Why:** CP6 build. Ending the hold on first reach let the growth case land 4000 px off, because diagrams above the target were still rendering. The palette has five badge backgrounds, not six.

**Superseded:** The restore stopped when the position was reached, and series cycled six badge backgrounds.

### 2026-10-27 — Mermaid contrast, shape accents, warning channel

**What changed:** The diagram frame uses `--color-background` so `surface` nodes stand off it. Diagram borders blend 35% toward `textMuted`. Decisions and stores take badge tints. `config.mermaid_theme_invalid` travels as a `validateModel` warning through `ThemeConfig.invalidMermaidKeys`.

**Why:** Orchestrator visual review of CP6: nodes blended into the frame and every shape was the same grey. The finding went through `globalErrors`, so a theme typo made `ignatius validate` exit 1.

**Superseded:** Frame on `--color-surface-alt`, plain palette borders, untinted shapes, finding emitted from `parseModels`.

### 2026-10-27 — Mermaid theme value filter

**What changed:** `theme.mermaid` strings must match `/^[\d "#%(),.;A-Za-z-]+$/`, otherwise they are dropped with the warning.

**Why:** CP6 review reproduced CSS injection into the diagram SVG and an external fetch from an opened export, because `mermaid.initialize()` does not sanitize `themeVariables`.

**Superseded:** Any string value was kept.

### 2026-10-27 — Correction: view-state apply site and test locations

**What changed:** Correction. `applyViewState` runs from `src/app/apply-view-state.ts`, which `main.tsx` imports first. The export pipeline lives in `src/generators/export-model.ts` and is shared by the CLI and the server. The Playwright checks live in `test/checks/`, so `bun run test` runs them. The change tree lists the files that were actually built.

**Why:** CP7 build. ES imports evaluate before `main.tsx`'s body, so applying there lost settings that `useSettings` had already read at module load. The as-seen test caught it.

**Superseded:** `applyViewState` in `main.tsx` before mount, and the Playwright checks under `test/visual/`.

### 2026-10-27 — Export scoped to the exported model

**What changed:** The export snapshot keeps only the exported model's layout-store entries. The recipient merges them in rather than overwriting. The applied digest is recorded per model. Preference keys the snapshot omits are cleared on first apply.

**Why:** CP7 review. The layout stores are shared by every model served on `localhost:3000`, so exports leaked other models' entity names and hidden sets. On the recipient, applying an export wiped the arrangements of other exports.

**Superseded:** The whole `ignatius-*` snapshot was written as-is, under one global applied digest.

### 2026-10-27 — Post-audit corrections

**What changed:**
- Whenever an export carries view state, the stored theme wins over the baked `__THEME_MODE__` on every load.
- Dialogs opened from the FAB return focus to the FAB.
- The criteria are ticked.
- The change tree and outline match the delivered files.
- The scroll-hold risk states the current hold.

**Why:** Final audit. A recipient's theme toggle was lost on reload, focus fell to `<body>` after a FAB dialog closed, and several spec sections lagged the build.

**Superseded:** The snapshot theme won only on first apply.

### 2026-10-27 — Bold diagrams, sidebar lip, prose width

**What changed:**
- Mermaid diagrams use a bold look with ignatius's entity colours: full-strength cycled node fills, 3 px black outlines, 8 px radius, dark drop shadows, bold labels, thicker connectors, and a dotted panel on the svg.
- `theme.mermaid` gains `stroke_width`, `radius`, `shadow` and `node_fills`, validated and reported through `config.mermaid_theme_invalid`. `resolveMermaidStyle` passes a `themeCSS` alongside the variables.
- Mermaid is initialised with `look: 'classic'` and `flowchart.wrappingWidth: 200`.
- The sidebar tab rests as a 10-16 px lip with an accent edge and grip; the icon and label show only on hover or focus.
- `.md` prose is capped at `72ch`.

**Why:** The requester reviewed the shipped build: the tab never looked hidden, and the diagrams looked unstyled. An independent review found the palette had been copied from an older atomic viewer than the bold theme the requester meant, and that the half-hidden tab showed a clipped "Side" at rest. The same review's captures showed prose running about 160 characters per line. Mermaid 12 wraps flowchart labels at 120 px, which split the bold labels mid-word, and its default `neo` look painted gradient strokes over the outlines.

**Superseded:** Surface-coloured nodes with 1 px borders on a bordered frame; decisions and stores on pale badge colours set with `!important` page CSS; a tab resting half off-screen.

### 2026-10-27 — Diagram theme safety and label surfaces

**What changed:**
- Palette `background`, `surface`, `text` and `textMuted` pass `SAFE_MERMAID_VALUE` before reaching `themeVariables` or `themeCSS`; an unsafe one falls back to the default and is reported.
- Labels are coloured against the surface they sit on (composite titles, ER attribute rows, single-colour gantt and pie slots).
- Unknown `theme.mermaid` keys are reported, and each invalid key's finding states its own rule.
- `themeCSS` reads connector and label colours from the resolved variables, so a mode-block `lineColor` reaches every connector.
- The end-state dot moves from page CSS into `themeCSS`, the svg widening counts the panel border, and diagrams inside `.md` are left-aligned with the prose.

**Why:** Final audit of the rework. A palette colour containing CSS made diagrams fetch an outside URL; composite-state titles were black on the dark page; a dark node fill turned ER attribute rows white-on-white.

**Superseded:** Palette colours reached the diagram stylesheet unfiltered; composite titles and ER attribute labels took the first fill's label colour.

### 2026-10-27 — Shortcuts and group hide

**What changed:** `Shift+L` steps the graph layout back; `L` and `Shift+L` flip the flow view; `R` resets the layout on graph and flow; `Cmd`/`Ctrl`+`C` copies the page link when no text is selected, through the same code and toast as the FAB item; each Groups modal card has Hide / Show; `Shift+H` hides the groups of the selected entities. The help overlay shows every key as a keycap, sharing its style with the FAB hints.

**Why:** Requester asked for these keyboard and group-hide controls during review of the branch.

### 2026-10-27 — Settings sections and theme

**What changed:** Settings is redesigned into titled sections of bordered cards with a segmented control and a switch. The light/dark theme moves from the header button into Settings → Appearance; `useThemeMode` returns `setTheme(mode)`.

**Why:** The requester found the one-checkbox modal unfinished, and asked for the theme toggle to live in Settings.

**Superseded:** A plain list of labelled checkboxes; a round `.theme-toggle` button in the header beside the help button.

### 2026-10-27 — Correction: change tree and outline

**What changed:** The Change tree and Outline list the files the theme move touched (`useThemeMode.setTheme`, the header-corner checks, `test/visual/theme.ts` and the scripts that switch theme through it, README and guides), and the `SettingsModal` outline line describes its sections.

**Why:** Review found the tree and outline still describing the one-checkbox modal and missing those files.

## Implementation log

### built — 2026-10-27

Built across 19 iterations of /autopilot (8 checkpoints, a post-audit iteration). Commits on the branch before squash (chronological):

- `37047de` — CP-1 modal focus trap
- `299260c` — CP-2 shared markdown typography, `--font-mono`
- `cf59513` — CP-3 settings module store, Settings modal, always-open examples
- `de5f6fb` — CP-4 sidebar edge tab, close button, persisted open state
- `96a09ab` — CP-5 Dictionary and sidebar scroll memory
- `029219c` — CP-6 Mermaid diagrams, theme config, sidecar bundle, restore hold
- `995d467` — CP-7 export as seen, scoped to the exported model
- `bd7021b` — CP-8 guides, config spec, skill logic flows, worked example
- `ee64a6a` — post-audit: FAB focus return, recipient theme on reload, spec currency

**Out-of-scope work performed during this build:**

- `--font-mono` with SF Mono/Menlo/Consolas fallbacks and ligatures off on code: Chromium fell back to a Courier-like serif in markdown code.
- The export pipeline moved into `exportModel`, which CLI export and the server route share.

**Unforeseens — surprises that emerged during implementation:**

- React 19 resets a body's innerHTML on card re-render; `mermaid-render.ts` keeps a per-source SVG cache.
- `mermaid.initialize()` does not sanitize `themeVariables`; values are filtered by `SAFE_MERMAID_VALUE`.
- Layout stores hold every model on the origin; exports scope them to the exported model.
- `useSettings` reads storage at import time, so view state applies from a module imported first.

**Deferred items still open:**

- `viewer-qol-f-1` (`.claude/project/followups/viewer-qol-f-1.md`): bundle may ship React dev build and StrictMode double effects.
