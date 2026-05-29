---
id: graph-minimap
title: 'Graph: minimap with viewport indicator + click-to-pan'
created: "2026-05-29"
origin: |
    user request, session 2026-05-29
severity: risk
review_by: "2026-07-28"
status: open
---

In graph mode, add a minimap (bottom-right or bottom-left corner) showing the full canvas with a viewport rectangle indicating the current visible area. Click/drag in the minimap pans the main view.

Cytoscape.js has cytoscape-navigator plugin (https://github.com/cytoscape/cytoscape.js-navigator) — evaluate vs hand-rolled implementation. Plugin is small, well-maintained.

Files: src/App.tsx (mount the navigator), src/styles.css (positioning), possibly bun.lock if adding the dep.
