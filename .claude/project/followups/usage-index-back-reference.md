---
id: usage-index-back-reference
title: 'Usage index: derived back-reference of store/entity touchpoints'
created: "2026-06-05"
origin: |
    pressure-test of process-flows spec, 2026-06-05
kind: plan
review_by: "2026-08-04"
status: open
file: docs/spec/process-flows.md
---

Derived back-reference view across all flows: for any store or entity, list every process/flow that reads or writes it — the reverse of the demand list ("what needs this entity?" vs the demand list's "what does this flow need?").

- Covers both `db:` entities and non-`db:` stores (cache/queue/file/doc/manual).
- Not authored — scanned by walking every `FlowDiagram`'s edges and collecting (store/entity) → {process, flow, direction} touchpoints.
- Surfaces naturally in the dict (a "used by" section per entity/store) and/or as click-through on a store node in the flow graph.

Deferred deliberately during the process-flows pressure-test so it doesn't get half-built as a side effect of the `_stores/` descriptive-file feature — they are different things:
- `_stores/<name>.md` = author a *description* of a non-db store.
- Usage index = *derive* where any store/entity is used.

Pairs with the demand-list keystone (`flow.unknown_attribute`): demand list = forward (flow → required attrs); usage index = reverse (entity → consuming flows).
