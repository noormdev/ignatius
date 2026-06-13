---
process: Attach Tag to Memory
number: 2
inputs:
  - from: ext:LLM-Agent
    data: tag and memory reference (tag_id, memory_id)
  - from: db:Memory_Tag
    data: [tag_id, memory_id]
outputs:
  - to: db:Memory_Tag
    data: [tag_id, memory_id]
  - to: ext:LLM-Agent
    data: attachment status (inserted or already present)
examples:
  in:
    - from: ext:LLM-Agent
      label: Attach the "performance" tag to a Bun layout memory
      rows:
        - { tag_id: 42, memory_id: 5001 }
    - from: db:Memory_Tag
      label: Idempotency check — no prior link
      rows: []
  out:
    - to: db:Memory_Tag
      label: New junction row
      rows:
        - { tag_id: 42, memory_id: 5001, created_at: "2026-06-13T10:00:00Z" }
    - to: ext:LLM-Agent
      label: Status confirmation
      rows:
        - { status: inserted }
---

Links a single [[Tag]] to a single [[Memory]] via the [[Memory_Tag]] junction.

The process is idempotent: before inserting it checks [[Memory_Tag]] for an existing row with the same `(tag_id, memory_id)` pair. If the pair already exists, no row is written and a status of `already present` is returned. If absent, a new row is inserted and `inserted` is returned. Either outcome is considered success — the caller can treat this as a fire-and-forget operation.

This is the single-row variant. When the agent needs to attach one tag to many memories in a single round trip, use **Bulk Attach Tag to Memories** instead.
