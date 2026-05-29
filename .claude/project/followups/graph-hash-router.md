---
id: graph-hash-router
title: 'Graph: hash-router state pinning (entity / pan / zoom)'
created: "2026-05-29"
origin: |
    user request, session 2026-05-29
severity: risk
review_by: "2026-07-28"
status: open
---

In the interactive graph viewer, pin the current selection / view state to the URL hash so the user can bookmark, share, or refresh without losing position. Likely encoding: `#entity=Party` (focused node), `#zoom=1.5&pan=120,80` (view transform), or combined.

Consider folding this with the legend button: turn the current legend-only button into a FAB that opens a menu — view mode toggle, legend, share-link copy, minimap toggle. See: viewer-mode-toggle, graph-minimap.
