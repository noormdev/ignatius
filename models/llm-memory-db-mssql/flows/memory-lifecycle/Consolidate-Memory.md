---
process: Consolidate Memory
number: 4
inputs:
  - from: ext:LLM-Agent
    data: consolidation request (duplicate memory_id, canonical memory_id)
  - from: db:Memory_Tag
    data: [tag_id, memory_id]
  - from: db:Project_Memory
    data: [project_id, memory_id]
outputs:
  - to: db:Related_Memory
    data: [memory_id, related_memory_id, relation_verb, reason]
  - to: db:Memory_Tag
    data: [tag_id, memory_id]
  - to: db:Project_Memory
    data: [project_id, memory_id]
  - to: db:Memory
    data: [relevance_status, updated_at]
  - to: db:StateTransition
    data: [state_transition_type, agent_id, from_status, to_status, reason, occurred_at]
  - to: db:Memory_StateTransition
    data: [transition_id, memory_id]
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent identifies a duplicate gotcha memory
      rows:
        - { memory_id: 5099, related_memory_id: 5001, reason: "Memory 5099 re-states the Bun debounce fact already captured in 5001 with more detail" }
    - from: db:Memory_Tag
      label: Tags currently attached to the duplicate
      rows:
        - { tag_id: 44, memory_id: 5099 }
    - from: db:Project_Memory
      label: Project links currently on the duplicate
      rows:
        - { project_id: 100, memory_id: 5099 }
  out:
    - to: db:Related_Memory
      label: Supersedes edge from duplicate to canonical
      rows:
        - { memory_id: 5099, related_memory_id: 5001, relation_verb: supersedes, reason: "Memory 5099 re-states the Bun debounce fact already captured in 5001 with more detail" }
    - to: db:Memory_Tag
      label: Tag transferred to canonical memory
      rows:
        - { tag_id: 44, memory_id: 5001 }
    - to: db:Project_Memory
      label: Project link transferred to canonical memory
      rows:
        - { project_id: 100, memory_id: 5001 }
    - to: db:Memory
      label: Duplicate marked superseded
      rows:
        - { relevance_status: superseded, updated_at: "2026-06-13T14:45:00Z" }
    - to: db:StateTransition
      label: Audit record for the status change
      rows:
        - { state_transition_type: "memory-relevance", agent_id: 1, from_status: active, to_status: superseded, reason: "Memory 5099 re-states the Bun debounce fact already captured in 5001 with more detail", occurred_at: "2026-06-13T14:45:00Z" }
    - to: db:Memory_StateTransition
      label: Junction row binding transition to duplicate memory
      rows:
        - { transition_id: 8004, memory_id: 5099 }
---

Folds a duplicate [[Memory]] row into a canonical one, repointing all associations and recording the consolidation in the semantic graph and the audit journal — all in a single transaction.

The process reads every [[Memory_Tag]] and [[Project_Memory]] row belonging to the duplicate. Tags and project links that do not already exist on the canonical memory are re-pointed (the `memory_id` foreign key updated to the canonical id). Rows that already exist on the canonical are dropped to avoid duplicates.

A `supersedes` edge is written into [[Related_Memory]] from the duplicate to the canonical, making the consolidation navigable from the graph view.

The duplicate's `relevance_status` is then set to `'superseded'` via the same gated mechanism as [[Set-Memory-Relevance]]: a [[StateTransition]] audit row is inserted with `state_transition_type = 'memory-relevance'` and a [[Memory_StateTransition]] junction row binds it to the duplicate.

The canonical memory is not modified — it continues its current lifecycle uninterrupted.
