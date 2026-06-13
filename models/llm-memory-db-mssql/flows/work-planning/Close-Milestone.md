---
process: Close Milestone
number: 5
inputs:
  - from: ext:LLM-Agent
    data: close request (milestone_id)
  - from: db:Task
    data: [milestone_id, task_no, tracking_status]
outputs:
  - to: db:Milestone
    data: [tracking_status, relevance_status, updated_at]
  - to: db:Task
    data: [tracking_status, updated_at]
  - to: db:StateTransition
    data: [state_transition_type, agent_id, from_status, to_status, reason, occurred_at]
  - to: db:Milestone_StateTransition
    data: [transition_id, milestone_id]
  - to: db:Task_StateTransition
    data: [transition_id, milestone_id, task_no]
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent closes the spotlight-grid milestone
      rows:
        - { milestone_id: 9001 }
    - from: db:Task
      label: Child tasks scanned for open status (task 2 still open)
      rows:
        - { milestone_id: 9001, task_no: 1, tracking_status: done }
        - { milestone_id: 9001, task_no: 2, tracking_status: in_progress }
  out:
    - to: db:Milestone
      label: Milestone marked done and superseded
      rows:
        - { tracking_status: done, relevance_status: superseded, updated_at: "2026-06-13T18:00:00Z" }
    - to: db:Task
      label: Open task cascade-abandoned
      rows:
        - { tracking_status: abandoned, updated_at: "2026-06-13T18:00:00Z" }
    - to: db:StateTransition
      label: Milestone audit entry
      rows:
        - { state_transition_type: milestone-tracking, agent_id: 1, from_status: in_progress, to_status: done, reason: "Milestone closed by agent — all deliverables shipped.", occurred_at: "2026-06-13T18:00:00Z" }
    - to: db:StateTransition
      label: Abandoned-task audit entry (one per open task)
      rows:
        - { state_transition_type: task-tracking, agent_id: 1, from_status: in_progress, to_status: abandoned, reason: "Parent milestone closed — task auto-abandoned.", occurred_at: "2026-06-13T18:00:00Z" }
    - to: db:Milestone_StateTransition
      label: Milestone-scoped audit link
      rows:
        - { transition_id: 8001, milestone_id: 9001 }
    - to: db:Task_StateTransition
      label: Task-scoped audit link for abandoned task
      rows:
        - { transition_id: 8002, milestone_id: 9001, task_no: 2 }
---

Atomically closes a [[Milestone]] and cascades abandonment to every still-open child [[Task]], journaling every status change.

The entire operation runs inside a single transaction. The sequence is:

1. **Scan open tasks** — read all [[Task]] rows for the milestone whose `tracking_status` is not `'done'` or `'abandoned'`.
2. **Close the milestone** — update [[Milestone]]: `tracking_status → 'done'`, `relevance_status → 'superseded'`, `updated_at` stamped. Write a [[StateTransition]] row (`state_transition_type = 'milestone-tracking'`) and link it via [[Milestone_StateTransition]].
3. **Abandon open tasks** — for each open task from step 1: update [[Task]] `tracking_status → 'abandoned'`, `updated_at` stamped; write a [[StateTransition]] row (`state_transition_type = 'task-tracking'`, `to_status = 'abandoned'`); link via [[Task_StateTransition]].

If there are no open tasks, steps 1 and 3 produce no rows — only the milestone transition is written. The process is idempotent with respect to already-done tasks; only tasks in an open state are touched.

Setting `relevance_status = 'superseded'` on the milestone signals to the [[LLM-Agent]] that this plan has been retired and should not be surfaced as active context in future sessions.
