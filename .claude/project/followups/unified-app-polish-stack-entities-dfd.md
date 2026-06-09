---
id: unified-app-polish-stack-entities-dfd
title: Stack entities in the DFD to reclaim visual real-estate
created: "2026-06-08"
origin: |
    docs/spec/unified-app-polish.md, user request 2026-06-07
kind: finding
severity: nit
review_by: "2026-08-07"
status: open
file: src/flow-view/FlowDiagramSvg.tsx
---

Entities in the DFD currently lay out one-per-node (hub-and-spoke to stores/externals). For models with many entities this wastes horizontal/vertical real estate. Investigate a way to "stack" entities in the DFD — e.g. grouping/collapsing related `db:` stores into a stacked card, or a denser packing of entity-store nodes — to reclaim canvas space without losing legibility or the Gane-Sarson semantics.

**Why:** dense DFDs spread entities too far apart, hurting overview.

**How to apply:** explore during a future DFD-layout pass; out of scope for the unified-app-polish batch (deferred deliberately by the user).
