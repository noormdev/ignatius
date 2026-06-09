---
id: dfd-polish-round3-cytoscape-typing
title: Type the cytoscape cy binding (retire the TS2339 Core defect)
created: "2026-06-09"
origin: |
    docs/spec/dfd-polish-round3.md, CP22 reviewer
kind: finding
severity: risk
review_by: "2026-08-08"
status: open
file: src/App.tsx
---

The cytoscape `cy` binding in src/App.tsx is untyped — `cy.zoom()`/`cy.fit()`/`cy.on()`/`cy.minZoom()`/`cy.maxZoom()`/`cy.pan()` etc. all raise TS2339 "Property does not exist on type 'Core'" (87+ pre-existing instances; CP22 added 16 more new call-sites of the same defect). Root cause: the cytoscape/cytoscape-elk import is not properly typed against @types/cytoscape's Core. Fix by typing the cy binding correctly (install/align @types/cytoscape, or a precise local ambient type) — NOT with `as`/`any`. This would retire the whole TS2339 class and make typecheck meaningful for the graph code again.

Origin: dfd-polish-round3 CP22 reviewer adjudication (accepted as pre-existing defect, deferred).
