# Dict polish — spec


## Goal

Make the generated data dictionary HTML readable on mobile and on print, and render entities in hierarchy order (grouped by group, basetype + subtypes contiguous) so the dict reads as a structured document instead of an alphabetical dump. Group ordering becomes user-controllable via a numeric `sort_key`.


## Non-goals

- Reordering entities in the interactive viewer or static graph output (graph is layout-driven, not list-driven)
- Mobile-responsive graph
- Print stylesheet for graph
- Pagination or collapsible sections in the dict
- Customizable per-entity sort overrides
- Theme changes (dict polish is structural + layout, not chromatic)


## Success criteria

- [ ] Dict HTML readable on a 375px-wide viewport: no horizontal scroll on the page body, attribute tables reflow or scroll within their container, no overlap between the branding block and entity content
- [ ] Dict HTML prints cleanly: branding block + footer suppressed or relocated so they don't repeat per page, entity sections don't split awkwardly across pages where avoidable, link URLs visible (either inline or as footnotes), background colors preserved where they convey meaning (group color, key markers) or gracefully degraded to borders/text
- [ ] Entities within a group render in hierarchy order: basetypes first (alphabetical among themselves), each followed immediately by its subtypes alphabetical
- [ ] Within hierarchy ordering, independent basetype-clusters (kernel / independent) precede dependent basetype-clusters
- [ ] Groups render in `sort_key` order (numeric ascending); groups without a `sort_key` render after sorted ones, alphabetical by group name
- [ ] `_groups/*.md` frontmatter accepts an optional `sort_key: <number>`; non-numeric values throw at parse time with the group name
- [ ] Dict ordering matches the example: a model containing Party (basetype) + Business, Person (subtypes) + Identity (basetype) + ITIN, License, Passport, SSN (subtypes) renders as `Party, Business, Person, Identity, ITIN, License, Passport, SSN` within their group
- [ ] Existing 12 test scripts still pass; new ordering covered by an assertion script
- [ ] Mobile + print verified by screenshot (Playwright at 375×667 viewport; print emulation via `page.emulateMedia({ media: 'print' })`)


## Approach

Single dict-polish slice. Ordering logic lives in `src/generators/dict.ts` (presentation concern — does not change `Model` shape). `sort_key` is a new optional field on `GroupConfig` in `src/parse.ts`. Mobile + print are scoped CSS additions to the dict's embedded `<style>` block.

Hierarchy classification uses existing parser-derived signals (cardinality, FK presence, subtype membership) — no new derivation pass required.


## Checkpoints

| # | Checkpoint | Files / areas | Agent | Est. | Verifies |
|---|------------|---------------|-------|------|----------|
| 1 | Group `sort_key` + entity hierarchy ordering in dict | `src/parse.ts` (GroupConfig schema + parse), `src/generators/dict.ts` (sort logic), `tmp/test-dict-ordering.ts` (new) | atomic-builder | ~3 | (1) `_groups/*.md` parses optional numeric `sort_key`; non-numeric throws; (2) dict generator emits groups in `sort_key` ascending, unset groups alphabetical after; (3) within a group, basetype-clusters ordered independent → dependent → alphabetical, each cluster = basetype + alphabetical subtypes; (4) assertion script proves the `Party, Business, Person, Identity, ITIN, …` example output |
| 2 | Mobile-responsive dict layout | `src/generators/dict.ts` (embedded `<style>`), `tmp/test-dict-mobile.ts` (new, Playwright 375×667 screenshot) | atomic-surgeon | 1-2 | (1) No horizontal scroll at 375px viewport (`document.documentElement.scrollWidth <= window.innerWidth`); (2) attribute tables remain readable (reflow, horizontal scroll within container, or column collapse — implementer chooses); (3) branding block does not occlude first entity heading; (4) screenshot saved to `tmp/dict-mobile.png` |
| 3 | Print stylesheet for dict | `src/generators/dict.ts` (embedded `<style>` `@media print` block), `tmp/test-dict-print.ts` (new, Playwright print emulation) | atomic-surgeon | 1-2 | (1) `@media print` rules present; (2) branding block + fixed footer do not repeat on every page (either suppressed in print or `position: static`); (3) entity section uses `break-inside: avoid` where the section fits on one page; (4) link `href`s either visible inline or rendered as printed URLs; (5) print-emulated screenshot saved to `tmp/dict-print.png` |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Hierarchy classification disagrees with user intent on edge cases (e.g. dependent kernel that's also a subtype parent) | Medium | Rule precedence is explicit in success criteria: independent clusters first, then dependent, alphabetical tiebreak. Edge cases that don't fit get reported as found, not pre-solved. |
| `sort_key` collisions between two groups | Low | Stable secondary sort by group name. Document in the change log when surfaced. |
| Mobile reflow breaks the existing desktop layout | Medium | All mobile rules scoped under `@media (max-width: <breakpoint>)`. Desktop screenshot smoke-tested unchanged. |
| Print stylesheet hides content the user wants to keep (e.g. footer copyright) | Low | Print copyright preserved by placing it at the document end with `position: static`, not hidden. |
| Subtype with no basetype reference (orphan) | Low | Treat as a basetype-cluster of one in the dependent tier. Document the rule. |


## Change log

<!-- empty during drafting; first entry on first post-approval amendment -->
