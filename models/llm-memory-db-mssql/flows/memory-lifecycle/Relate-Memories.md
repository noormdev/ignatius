---
process: Relate Memories
number: 2
inputs:
  - from: ext:LLM-Agent
    data: semantic link request (source memory_id, target related_memory_id, relation_verb, reason)
  - from: db:MemoryRelationVerb
    data: [verb_forward]
  - from: db:Related_Memory
    data: [memory_id, related_memory_id]
outputs:
  - to: db:Related_Memory
    data: [memory_id, related_memory_id, relation_verb, reason]
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent links a gotcha to a supporting decision
      rows:
        - { memory_id: 5001, related_memory_id: 5002, relation_verb: supports, reason: "The debounce gotcha directly supports the 200ms coalesce decision in the architecture memory" }
    - from: db:MemoryRelationVerb
      label: Validate verb is registered
      rows:
        - { verb_forward: supports }
    - from: db:Related_Memory
      label: Idempotency check — edge does not yet exist
      rows: []
  out:
    - to: db:Related_Memory
      label: Directed semantic edge written
      rows:
        - { memory_id: 5001, related_memory_id: 5002, relation_verb: supports, reason: "The debounce gotcha directly supports the 200ms coalesce decision in the architecture memory" }
---

Creates a directed semantic edge between two [[Memory]] rows in the [[Related_Memory]] graph.

The process first validates the supplied `relation_verb` against [[MemoryRelationVerb]] (`verb_forward` column). An unrecognised verb is rejected — the agent must use a verb already in the controlled vocabulary (e.g. `supersedes`, `supports`, `contradicts`).

Before inserting, the process checks whether the exact `(memory_id, related_memory_id)` pair already exists. If it does, the operation is a no-op — idempotent by design so the agent can re-assert known relationships without creating duplicates.

The edge is directed: `memory_id → related_memory_id`. A reverse edge, if semantically warranted, must be created in a separate call. The `reason` field is free text and should explain the semantic justification for the link, not merely restate the verb.
