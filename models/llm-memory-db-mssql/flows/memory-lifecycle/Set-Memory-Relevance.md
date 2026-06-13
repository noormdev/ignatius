---
process: Set Memory Relevance
number: 3
inputs:
  - from: ext:LLM-Agent
    data: relevance change request (memory_id, target status, reason)
  - from: db:Memory
    data: [memory_id, relevance_status]
  - from: db:RelevanceStatus_Allowed
    data: [from_status, to_status]
outputs:
  - to: db:Memory
    data: [relevance_status, updated_at]
  - to: db:StateTransition
    data: [state_transition_type, agent_id, from_status, to_status, reason, occurred_at]
  - to: db:Memory_StateTransition
    data: [transition_id, memory_id]
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent archives a memory no longer relevant to current work
      rows:
        - { memory_id: 5001, to_status: archived, reason: "Bun fs.watch behaviour confirmed stable; debounce already in prod — no longer needs active recall" }
    - from: db:Memory
      label: Current state of the memory
      rows:
        - { memory_id: 5001, relevance_status: active }
    - from: db:RelevanceStatus_Allowed
      label: Gate — active → archived is a permitted transition
      rows:
        - { from_status: active, to_status: archived }
  out:
    - to: db:Memory
      label: Relevance status updated
      rows:
        - { relevance_status: archived, updated_at: "2026-06-13T14:22:00Z" }
    - to: db:StateTransition
      label: Audit record written
      rows:
        - { state_transition_type: "memory-relevance", agent_id: 1, from_status: active, to_status: archived, reason: "Bun fs.watch behaviour confirmed stable; debounce already in prod — no longer needs active recall", occurred_at: "2026-06-13T14:22:00Z" }
    - to: db:Memory_StateTransition
      label: Junction row linking transition to memory
      rows:
        - { transition_id: 8003, memory_id: 5001 }
---

Advances a [[Memory]] row through the relevance state machine and journals the transition atomically.

The process reads the memory's current `relevance_status` from [[Memory]], then checks [[RelevanceStatus_Allowed]] to verify that the `(from_status, to_status)` pair is a listed edge. If no matching row exists the transition is rejected — the gate prevents illegal jumps (e.g. `deleted → active` or `archived → superseded`) that would corrupt the lifecycle history.

When the gate passes, three writes occur inside a single transaction:

1. [[Memory]] — `relevance_status` updated to the target status and `updated_at` stamped.
2. [[StateTransition]] — an audit row is inserted with `state_transition_type = 'memory-relevance'`, recording who made the change, the before/after statuses, the agent's stated reason, and when it happened.
3. [[Memory_StateTransition]] — the junction row binds the new transition to the affected memory, making the full audit trail queryable from either side.

The `reason` field travels all the way into [[StateTransition]] so the journal reads as a human-understandable narrative of why each relevance change was made.
