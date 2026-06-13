---
entity: Task_StateTransition
group: audit
pk:
  - transition_id
columns:
  transition_id: { type: integer, desc: "Shared PK — FK to StateTransition." }
  milestone_id: { type: integer, desc: "Composite FK to Task — milestone component." }
  task_no: { type: integer, desc: "Composite FK to Task — task number component." }
  created_at: { type: datetime, default: now, desc: "When this subtype row was written." }
relationships:
  - target: StateTransition
    on: { transition_id: transition_id }
    predicate: { fwd: is realized as, rev: is a }
  - target: Task
    on: { milestone_id: milestone_id, task_no: task_no }
    predicate: { fwd: is journaled by, rev: journals }
examples:
  - { transition_id: 8002, milestone_id: 9001, task_no: 1 }
---

# Task_StateTransition

[[Task_StateTransition]] pins a [[StateTransition]] journal entry to the specific [[Task]] whose tracking status changed, using the composite FK `(milestone_id, task_no)` to identify the task.
