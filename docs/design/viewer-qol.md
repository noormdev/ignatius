# Viewer quality of life


## Problem


Requests from the model owner after daily use of the viewer:

1. Rendered markdown looks compressed. The global reset zeroes every margin, and the four wrapper classes (`.doc-body`, `.dict-entity-body`, `.flow-node-body`, `.dict-group-desc`) each restore a different, partial set of rules. `.doc-body` has no rule for `h1`, `h3`–`h6`, `pre`, `blockquote` or `hr`, and its `h2` borrows the uppercase section-label style.
2. View preferences are scattered across seven `ignatius-*` localStorage keys with no place to change them, and the open rule for example tables (`rows <= 3`) cannot be overridden.
3. The dictionary sidebar opens only from the FAB menu ("Toggle sidebar"). There is no affordance on screen and no close control in the panel.
4. Bodies cannot carry diagrams. A process body that explains how the process transforms its inputs has only prose and tables to do it with.
5. `ignatius export` writes the model with default view state. What the user arranged (hidden entities, positions, layout mode, lens, theme) is lost.
6. The dictionary scroll position resets when the model reloads over SSE, when the view is shown again after a detour, and on page refresh. The sidebar scroll position has the same problem.
7. `Modal` focuses its close button on mount but does not keep focus inside, so Tab walks into the page behind it.
8. Reviewing the branch, the requester asked for keys for the previous layout, layout reset, copy link and hiding a whole group, and a Hide / Show button per group in the Groups dialog.


## Goals / Non-goals


Goals:

- Each item fixed in the existing structure: `Modal.tsx` for every modal, one shared markdown class for every markdown site, one settings store.
- Mermaid diagrams render in every markdown body, themed from the model's palette by default and overridable in `ignatius.yml`.
- Models without a mermaid fence pay nothing for Mermaid: no download in live mode, no bytes in an export.
- The modeling skill teaches logic flows inside a process body as a complement to the DFD, not a replacement.

Non-goals:

- Migrating the existing `ignatius-*` localStorage keys into the settings store. They keep working as they are.
- Per-column hiding. The only hide the viewer has is graph entity hide; export carries that.
- Exporting from an already-exported static file. Export needs the server's bundle and model.
- Mermaid in the DFD canvas or the graph. Diagrams live in markdown bodies only.


## Approach


### Markdown typography

Every markdown site adds the class `md` next to its existing wrapper class. One `.md` block in `styles.css` owns vertical rhythm: line height, paragraph and list spacing, a heading scale, `pre`, `blockquote`, `hr`, `img`, tables, and first/last-child margin trimming. Wrapper classes keep only what is specific to their place (font size, border, colour). Per-wrapper `p`/`ul`/`h*` rules that `.md` replaces are removed so one rule decides each element.

### Settings

`ignatius-settings` holds one JSON object. A module-level store in `useSettings.ts` reads it once when the module loads and merges it over defaults (unknown or wrong-typed fields fall back to the default). `useSettings()` reads the store through `useSyncExternalStore`; an update merges, writes, and notifies subscribers. No provider is needed, so the flow dialogs, which render in their own React root, see the same settings as the app shell. A Settings modal, opened from a FAB item present in every view, lists the toggles. First setting: `alwaysOpenExamples` (default `false`): when on, every example `<details>` renders open regardless of row count. The theme lives here too, under Appearance, so the header loses its theme button and the viewer has one place for preferences; it keeps its own `ignatius-theme` key.

### Sidebar tab

A tab fixed to the right edge, visible in the Dictionary view while the sidebar is closed. At rest only a narrow lip shows: an accent edge with a grip. The reader sees something is there, with no clipped label. On hover or keyboard focus the tab slides fully in and the icon and label appear. It holds a three-line icon over the word "Sidebar" and opens the sidebar on click. The panel gains a close button in its header. Open state persists in `ignatius-dict-nav-open`. Like the panel, the tab is hidden at `max-width: 768px` and in print.

### Scroll memory

`.dict-view` and `.dict-nav-panel` save `scrollTop` to sessionStorage on scroll (one write per animation frame). They restore it on mount, when the Dictionary view is shown again, and after a model reload replaces the content. sessionStorage, because the ask is "across refreshes" of one tab; a second tab on another model starts at the top.

Mermaid diagrams render asynchronously and keep growing the page after a restore, so the restore holds: it re-applies the saved position as content grows until the user scrolls, a scroll it did not make moves the container, or about 2 s pass. A process deep link wins by effect order: App's process scroll runs in a `requestAnimationFrame` registered from a passive effect, after the Dictionary's layout-effect restore, and its scroll ends the hold.

### Mermaid

```mermaid
flowchart LR
    F["```mermaid fence"] --> P["markdown-it fence rule<br/>(server / CLI)"]
    P --> D["div.mermaid-diagram<br/>escaped source"]
    D --> O["MutationObserver<br/>at app root"]
    O --> L{"mermaid loaded?"}
    L -->|no| S["load mermaid.js<br/>(live: script src; export: inlined)"]
    L -->|yes| R["mermaid.render"]
    S --> R
    R --> V["inline SVG"]
```

- **Parse side.** Both markdown-it instances (`src/model/parse.ts`, `src/flows/flow-markdown.ts`) emit a ```` ```mermaid ```` fence as `<div class="mermaid-diagram">` holding the HTML-escaped source. Every body type gets it with no per-site work.
- **Browser side.** One `MutationObserver` on the app root finds unrendered `.mermaid-diagram` nodes in any view or modal and renders them. Mermaid is initialised with `startOnLoad: false`, `securityLevel: 'strict'`, `theme: 'base'`, `look: 'classic'`, `flowchart.wrappingWidth: 200` (Mermaid 12's 120 px splits short bold labels), and the resolved `themeVariables` and `themeCSS` for the current mode; a theme-mode switch re-renders. A render error replaces the diagram with the source in a `pre` plus the error message, styled as a warning.
- **Bundle.** Mermaid minified is 5.3 MB against the app's 4.5 MB. It builds as a separate `dist/static/mermaid.js` that sets `window.__IGNATIUS_MERMAID__`. Live mode loads it with a `<script>` tag from `/static/mermaid.js` the first time a diagram appears. `generateApp` inlines it only when a body in the model or flows contains a mermaid diagram.
- **Theme.** The look is bold: full-strength fills cycled per node, thick black outlines, rounded corners, dark soft shadows, bold labels, on a dotted panel. Its fills are ignatius's entity colours, so diagrams read as part of the model. Outline width, radius, shadow and fills are `theme.mermaid` keys that build a Mermaid `themeCSS`, because Mermaid has no theme variable for them. Connector and canvas colours derive from the palette per mode. `theme.mermaid.dark` / `theme.mermaid.light` in `ignatius.yml` are passed as Mermaid `themeVariables` on top of the defaults, after `mergeTheme` drops any value outside `SAFE_MERMAID_VALUE` and records it for the `config.mermaid_theme_invalid` warning. Keys are Mermaid's own names, so the guide links to Mermaid's theming reference rather than restating it.

### Logic flows in the skill

A DFD answers *what data moves where*. A logic flow answers *what this process does to the data it received*: the branches, the reads and writes against one table, the failure path. The skill teaches a `## Logic` section in a process body with a Mermaid `flowchart` (or `sequenceDiagram` when the actors matter), naming the process's own inputs, outputs and stores so the diagram reads against the DFD. Entity bodies may use a logic flow to show how an application function touches that table.

### Export as seen

A FAB item "Export HTML" in live mode calls `POST /api/export` with a view-state snapshot: every `ignatius-*` localStorage key and the current hash. The server runs `exportModel`, the same path as `ignatius export`. `scopeViewState` cuts the two layout stores down to this model's entries, because those stores hold every model served on the same origin. `generateApp` then adds `window.__VIEW_STATE__`, and the response downloads as `<model-name>.html`.

On boot, `apply-view-state.ts`, imported first by `main.tsx`, applies the snapshot before any module reads localStorage. It clears preference keys the snapshot omits, merges the layout entries into the recipient's stores beside other models' entries, writes the other keys, and sets the hash when the URL has none. It does this once per snapshot and model: a digest is recorded per `__LAYOUT_KEY__` in `ignatius-view-state-applied`, so the recipient's later changes are not overwritten on reload. The export bakes the snapshot's theme into `__THEME_MODE__`, which `useThemeMode` reads before localStorage. On every load the module therefore sets `__THEME_MODE__` from the stored `ignatius-theme`, so a theme the recipient toggled survives a reload. The route uses the same `isLocalHost` and `isSameOrigin` guards as `/api/approve`.

### Focus trap

`Modal` handles Tab and Shift+Tab while it is the top of `modalStack`. Focus cycles through the modal's focusable elements and never leaves it. The modal gets `role="dialog"`, `aria-modal="true"` and `aria-labelledby` pointing at its title. On unmount, focus returns to the element that was focused when the modal opened, if that element is still in the document.


## Risks


- **Mermaid output is HTML injected into the page.** `securityLevel: 'strict'` disables click callbacks and sanitizes label HTML with DOMPurify; source goes through markdown-it escaping first. Mermaid writes `themeVariables` and `themeCSS` into the SVG `<style>` unsanitized. Every `ignatius.yml` value that reaches either one is checked first: mode-block values and the palette's diagram colours must match Mermaid's own directive pattern plus `-`, style keys are numbers in a range or a boolean, and fills are six-digit hex.
- **Restoring scroll before content has height** clamps to 0. Restore runs after layout (`useLayoutEffect`, then one `requestAnimationFrame` retry), then holds while diagrams grow.
- **View-state snapshot overwriting the recipient's state.** Bounded by the per-model applied-digest guard (the snapshot applies once per distinct export) and by merging layout entries rather than replacing the stores, so other models' arrangements survive.
