---
process: Set Artifact Relevance
number: 4
inputs:
  - from: ext:LLM-Agent
    data: artifact_id, target status, reason
  - from: db:Artifact
    data: [artifact_id, relevance_status]
  - from: db:RelevanceStatus_Allowed
    data: [from_status, to_status]
outputs:
  - to: db:Artifact
    data: [relevance_status, updated_at]
  - to: db:StateTransition
    data: [state_transition_type, agent_id, from_status, to_status, reason, occurred_at]
  - to: db:Artifact_StateTransition
    data: [transition_id, artifact_id]
  - to: ext:LLM-Agent
    data: transition confirmation
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent archives a stale perf report
      rows:
        - { artifact_id: 3002, target_status: "archived", reason: "Superseded by updated benchmark run" }
    - from: db:Artifact
      label: Current relevance status of the artifact
      rows:
        - { artifact_id: 3002, relevance_status: "active" }
    - from: db:RelevanceStatus_Allowed
      label: Gate check — active→archived is permitted
      rows:
        - { from_status: "active", to_status: "archived" }
  out:
    - to: db:Artifact
      label: Relevance status updated on the artifact row
      rows:
        - { relevance_status: "archived", updated_at: "2026-06-13T14:00:00Z" }
    - to: db:StateTransition
      label: Transition event journaled
      rows:
        - { transition_id: 8005, state_transition_type: "artifact-relevance", agent_id: 1, from_status: "active", to_status: "archived", reason: "Superseded by updated benchmark run", occurred_at: "2026-06-13T14:00:00Z" }
    - to: db:Artifact_StateTransition
      label: Cross-reference between artifact and transition
      rows:
        - { transition_id: 8005, artifact_id: 3002 }
    - to: ext:LLM-Agent
      label: Confirmation with new status
      rows:
        - { artifact_id: 3002, relevance_status: "archived", transition_id: 8005 }
---

The [[LLM-Agent]] requests a relevance change for an [[Artifact]] — archiving a file no longer current, restoring one that was archived, or soft-deleting one that is obsolete. Before any mutation the process reads the artifact's current `relevance_status` from [[Artifact]] and validates the `(from_status, to_status)` pair against [[RelevanceStatus_Allowed]]. If the pair is not present the transition is rejected without writing anything.

On a valid transition the process updates `relevance_status` and `updated_at` on [[Artifact]], then writes a [[StateTransition]] row (`state_transition_type = 'artifact-relevance'`) capturing who changed what and why. A corresponding [[Artifact_StateTransition]] row cross-references the new transition to the artifact, providing a full audit trail queryable from either side.

This same process covers soft-delete (`active → deleted`) and restore (`archived → active` or `deleted → active`) — the gate table [[RelevanceStatus_Allowed]] is the single source of truth for which transitions are legal, keeping the process logic transition-agnostic.
