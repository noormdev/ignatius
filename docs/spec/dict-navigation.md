# Dict navigation — spec


## Goal

Add a toggleable side-panel nav with scrollspy entity highlighting and fix the fixed branding block overlapping body content in the static data dictionary output.


## Non-goals

- Search / filter within the nav outline.
- Sticky entity headings inside their sections.
- Multi-level nav (entity attributes as sub-items in the outline).
- Persisting nav scroll position independently of the document scroll.
- Side-nav reflow on mobile (< 768px: hide toggle entirely, rely on existing dict flow).
- Graph or interactive React viewer — this spec touches `src/generators/dict.ts` only.


## Success criteria

- Branding does not overlap the page header or first entity heading at any viewport size, and a translucent blurred backdrop applies on both desktop (top-left) and mobile (top-right) positions.
- Content that scrolls behind the branding block is legible — a blurred translucent backdrop is visible between the branding and the content beneath it.
- Print output is unaffected: branding is `position: static` in the print stylesheet.
- Side nav toggle button is pinned upper-right, sized and styled to match the interactive viewer's theme toggle (circular, same diameter, same hover treatment) so the two surfaces feel related.
- Clicking the toggle slides a side panel into view listing all entities grouped by their group, in the same sort order as the dict body.
- Subtypes appear visually indented under their basetype to reflect hierarchy.
- Clicking a nav entry jumps to that entity's section.
- Clicking the toggle again, clicking outside the panel, or pressing Esc collapses the panel.
- Open/closed state persists across page reloads.
- The highlighted nav entry updates smoothly as the user scrolls — no page interaction required to refresh.
- The toggle button is hidden on viewports narrower than 768px.


## Approach

All work is in `src/generators/dict.ts`. The generator already emits self-contained HTML with inline CSS and inline JS; this spec extends those three inline blocks with no new files and no runtime dependencies. A new layout CSS variable (`--dict-branding-height`) drives both the body top-padding and the nav's top offset so both stay in sync from a single source. The branding fix is a one-pass CSS change. The nav adds a `<button>` toggle and a `<nav>` panel to the emitted markup, plus a small inline `<script>` block for toggle state, outside-click/Esc handling, localStorage persistence, and the `IntersectionObserver` scrollspy.


## Checkpoints

| # | Checkpoint | Files / areas | Agent | Verifies |
|---|------------|---------------|-------|----------|
| 1 | Branding overlap fix | `src/generators/dict.ts` (CSS block) | atomic-surgeon | Branding no longer sits over first entity heading; content scrolling under branding is blurred behind the backdrop; print output unaffected |
| 2 | Side nav markup + toggle | `src/generators/dict.ts` (markup + CSS + JS toggle block) | atomic-builder | Panel renders (initially hidden); toggle button appears upper-right; click opens panel; click-outside, Esc, and second click close it; localStorage preference survives reload; toggle hidden below 768px |
| 3 | Scrollspy | `src/generators/dict.ts` (IntersectionObserver block) | atomic-surgeon | Scrolling through the dict updates the highlighted nav entry to the entity currently in view; clicking a nav entry jumps to that entity's section |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `--dict-branding-height` value requires measuring the rendered DOM height, which varies with content | Low | Set a fixed CSS value that matches the design-time height and document the assumption; revisit only if branding content changes significantly |
| `IntersectionObserver` threshold needs tuning to feel natural (entity highlighted too early / too late) | Medium | Design specifies "top crosses upper third of viewport" as the threshold; implementer adjusts rootMargin if the default feels off during visual smoke |
| Outside-click handler conflicts with nav entry clicks (panel closes before navigation fires) | Low | Guard the outside-click listener to ignore clicks that originate inside the panel element |
| Long entity lists make the side panel overflow its height | Low | Panel is scrollable (`overflow-y: auto`); verify with the reference `models/` set which has 24 entities across 4 groups |
| Mobile backdrop omission | Low | Mobile relocation is already in dict-polish; backdrop must follow the relocated branding |
| `backdrop-filter` browser compatibility | Medium | Safari < 16.4 requires `-webkit-backdrop-filter`; static dict output is consumed cross-browser. Mitigation: emit both prefixed and unprefixed properties; degrade gracefully (solid bg) when unsupported |
| `--dict-branding-height` body padding may leak into print | Low | Print rule must explicitly reset `padding-top` so the extra desktop offset doesn't carry into paper output. Mitigation: spec the print stylesheet's body padding override |


## Change log

<!-- empty during drafting; first entry on first post-approval amendment -->
