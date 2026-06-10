---
id: render-perf-flow-index
title: Index flow validate/parse O(n^2) lookups (findings must stay identical)
created: "2026-06-10"
origin: |
    docs/spec/render-perf-indexing.md, CP7 (deprioritized)
kind: finding
severity: nit
review_by: "2026-08-09"
status: open
file: src/flow-validate.ts:71
---

The flow validators/parsers still scan arrays inside loops (O(n^2) at scale): flow-validate.ts:71 (entity-by-id .find inside the edge loop), :345 (process in/out edges .filter per process), :549 / flow-parse.ts:549 (storeRef-by-token .find per edge), :603 (process-by-id .find). Build per-diagram maps (entityNodeById via buildModelIndex(entityModel).nodeById; storeRefByToken keyed 'kind:name'; processById; processEdgesIn/Out) once and look up O(1).

**Hard gate:** validateFlows findings must stay BYTE-IDENTICAL on the baselines — key-inherited (clean) and broken-demo (12 findings). test-validate-flows / test-validate-refs pin this.

**Why deprioritized:** flow validation isn't on the graph render-critical path that was crashing; the user explicitly moved this to last. Low risk, low urgency. The entity-side ModelIndex (src/model-index.ts, CP3) already exists to reuse for the entity-by-id lookup.

**How to apply:** atomic-builder, 2 files (flow-validate.ts, flow-parse.ts); run test-validate-flows + test-validate-refs to confirm identical findings.
