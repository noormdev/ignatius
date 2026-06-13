---
process: Set Task Tracking
number: 3
inputs:
  - from: ext:LLM-Agent
    data: status transition request (milestone_id, task_no, target status, reason)
  - from: db:Task
    data: [milestone_id, task_no, tracking_status]
  - from: db:TrackingStatus_Allowed
    data: [from_status, to_status]
outputs:
  - to: db:Task
    data: [tracking_status, updated_at]
  - to: db:StateTransition
    data: [state_transition_type, agent_id, from_status, to_status, reason, occurred_at]
  - to: db:Task_StateTransition
    data: [transition_id, milestone_id, task_no]
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent marks task 1 of milestone 9001 in-progress
      rows:
        - { milestone_id: 9001, task_no: 1, to_status: in_progress, reason: "Starting implementation of SpotlightOverlay — all prereqs confirmed." }
    - from: db:Task
      label: Current task state
      rows:
        - { milestone_id: 9001, task_no: 1, tracking_status: not-started }
    - from: db:TrackingStatus_Allowed
      label: Gate rows checked for this transition
      rows:
        - { from_status: not-started, to_status: in_progress }
  out:
    - to: db:Task
      label: Updated task row
      rows:
        - { tracking_status: in_progress, updated_at: "2026-06-13T14:00:00Z" }
    - to: db:StateTransition
      label: Audit journal entry
      rows:
        - { state_transition_type: task-tracking, agent_id: 1, from_status: not-started, to_status: in_progress, reason: "Starting implementation of SpotlightOverlay — all prereqs confirmed.", occurred_at: "2026-06-13T14:00:00Z" }
    - to: db:Task_StateTransition
      label: Task-scoped audit link
      rows:
        - { transition_id: 8002, milestone_id: 9001, task_no: 1 }
---

Advances or regresses a [[Task]]'s `tracking_status` through the gated state machine defined by [[TrackingStatus_Allowed]].

Before applying the transition, the process reads the task's current `tracking_status` from [[Task]] and checks whether the `(from_status, to_status)` pair is present in [[TrackingStatus_Allowed]]. A missing row in that table means the transition is forbidden — the process rejects the request and no data is written.

On success, the task's `tracking_status` and `updated_at` are updated in place. A [[StateTransition]] row is written with `state_transition_type = 'task-tracking'`, capturing the full before/after state, the acting agent, the reason, and the timestamp. A [[Task_StateTransition]] row links the new transition back to the specific task, forming a queryable audit trail.

This process does not cascade to the parent [[Milestone]]; milestone status is managed independently via [[Close-Milestone]].
