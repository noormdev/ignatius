---
id: dfd-store-clusters-f-15
title: test-graph-search.ts intermittent stall in page.evaluate
created: "2026-09-08"
origin: |
    docs/spec/dfd-store-clusters.md, iter 9 implementer and reviewer (polish)
kind: finding
severity: risk
review_by: "2026-11-07"
status: open
file: test/checks/test-graph-search.ts
---

test-graph-search.ts stalled inside a page.evaluate on the graph mouseout handler in 2 of 20 instrumented back-to-back runs, after all three Enter cycles completed normally. The handler is synchronous and bounded; no code defect was found, and the stall did not reproduce in the reviewer's 8 runs. The check now carries bounded timeouts, a 55s watchdog, and a forced server stop, so it fails fast with a message instead of hanging. Left: find whether the stall is a CDP/GC hiccup under load or a real race in GraphView search, and remove the watchdog if the cause is fixed.
