---
process: Set Note Relevance
number: 4
inputs:
  - from: ext:LLM-Agent
    data: note_id, to_status, reason
  - from: db:Note
    data: [note_id, relevance_status]
  - from: db:RelevanceStatus_Allowed
    data: [from_status, to_status]
outputs:
  - to: db:Note
    data: [relevance_status, updated_at]
  - to: db:StateTransition
    data: [state_transition_type, agent_id, from_status, to_status, reason, occurred_at]
  - to: db:Note_StateTransition
    data: [transition_id, note_id]
  - to: ext:LLM-Agent
    data: transition_id, occurred_at
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent archives a note that is no longer actionable
      rows:
        - { agent_id: 1, note_id: 7001, to_status: "archived", reason: "Bun migration is complete; note no longer needs active visibility." }
    - from: db:Note
      label: Current note state read before transition
      rows:
        - { note_id: 7001, relevance_status: "active" }
    - from: db:RelevanceStatus_Allowed
      label: Gate confirms active → archived is a legal transition
      rows:
        - { from_status: "active", to_status: "archived" }
  out:
    - to: db:Note
      label: Relevance status updated in place
      rows:
        - { note_id: 7001, relevance_status: "archived", updated_at: "2026-06-13T14:00:00Z" }
    - to: db:StateTransition
      label: Audit record created
      rows:
        - { transition_id: 8004, state_transition_type: "note-relevance", agent_id: 1, from_status: "active", to_status: "archived", reason: "Bun migration is complete; note no longer needs active visibility.", occurred_at: "2026-06-13T14:00:00Z" }
    - to: db:Note_StateTransition
      label: Junction row linking note to its audit record
      rows:
        - { transition_id: 8004, note_id: 7001 }
---

Applies a gated relevance transition to an existing [[Note]], records the full audit trail in [[StateTransition]], and links both via [[Note_StateTransition]].

Before any write, the process reads the note's current relevance_status from [[Note]] and verifies that the (current → requested) pair exists in [[RelevanceStatus_Allowed]]. If the pair is absent the procedure raises an error and no data changes. This gate prevents illegal state jumps (e.g. jumping from 'deleted' back to 'active' when that transition is not permitted).

On a successful gate check, three writes occur in a single transaction:

1. [[Note]].relevance_status is updated to the requested status and updated_at is stamped with the current UTC time.
2. A [[StateTransition]] row is inserted with state_transition_type='note-relevance', capturing the agent identity, the before/after statuses, the agent-supplied reason, and the occurred_at timestamp.
3. A [[Note_StateTransition]] junction row links the new transition_id to the note_id, enabling full history queries against a note.

This process covers all three lifecycle transitions in a single stored procedure: active → archived (soft-hide), active → deleted (soft-delete), and archived → active (restore). The allowed set in [[RelevanceStatus_Allowed]] is the single source of truth for which moves are legal.

The new transition_id and occurred_at are returned to the [[LLM-Agent]] for confirmation.
