---
entity: Memory_StateTransition
group: audit
pk:
  - transition_id
columns:
  transition_id: { type: integer, desc: "Shared PK — FK to StateTransition." }
  memory_id: { type: integer, desc: "FK to the Memory whose relevance status changed." }
  created_at: { type: datetime, default: now, desc: "When this subtype row was written." }
relationships:
  - target: StateTransition
    on: { transition_id: transition_id }
    predicate: { fwd: is realized as, rev: is a }
  - target: Memory
    on: { memory_id: memory_id }
    predicate: { fwd: is journaled by, rev: journals }
examples:
  - { transition_id: 8003, memory_id: 5001 }
---

# Memory_StateTransition

[[Memory_StateTransition]] pins a [[StateTransition]] journal entry to the specific [[Memory]] whose relevance status changed, covering the `memory-relevance` type code.
