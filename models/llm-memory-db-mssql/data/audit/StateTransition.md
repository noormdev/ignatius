---
entity: StateTransition
group: audit
pk:
  - transition_id
columns:
  transition_id: { type: integer, desc: "IDENTITY surrogate PK." }
  state_transition_type: { type: text, desc: "Discriminator — foreign key to StateTransitionType (e.g. milestone-tracking, task-tracking, memory-relevance)." }
  agent_id: { type: integer, desc: "Agent that caused the transition — foreign key to Agent (sentinel 0 = system)." }
  from_status: { type: text, desc: "Prior status value. Plain scalar — validated at the proc layer against TrackingStatus or RelevanceStatus per type; not an FK." }
  to_status: { type: text, desc: "New status value. Same proc-layer validation; not an FK." }
  reason: { type: text, desc: "Why the transition happened." }
  occurred_at: { type: datetime, default: now, desc: "When the change occurred." }
  created_at: { type: datetime, default: now, desc: "When the journal row was written." }
subtypes:
  - exclusive: true
    desc: Every StateTransition belongs to exactly one axis, selected by state_transition_type
    members:
      Milestone_StateTransition:
        state_transition_type: StateTransitionType.state_transition_type.milestone-tracking
      Task_StateTransition:
        state_transition_type: StateTransitionType.state_transition_type.task-tracking
      Memory_StateTransition:
        state_transition_type: StateTransitionType.state_transition_type.memory-relevance
      Note_StateTransition:
        state_transition_type: StateTransitionType.state_transition_type.note-relevance
      Artifact_StateTransition:
        state_transition_type: StateTransitionType.state_transition_type.artifact-relevance
relationships:
  - target: StateTransitionType
    on: { state_transition_type: state_transition_type }
    predicate: { fwd: classifies, rev: is classified by }
  - target: Agent
    on: { agent_id: agent_id }
    predicate: { fwd: causes, rev: is caused by }
examples:
  - { transition_id: 8001, state_transition_type: milestone-tracking, agent_id: 1, from_status: pending, to_status: in_progress, reason: "Work started." }
  - { transition_id: 8002, state_transition_type: task-tracking, agent_id: 1, from_status: in_progress, to_status: done, reason: "Task completed." }
  - { transition_id: 8003, state_transition_type: memory-relevance, agent_id: 1, from_status: active, to_status: archived, reason: "Superseded by newer memory." }
---

# StateTransition

[[StateTransition]] is the immutable audit journal of every relevance and tracking status change across the system — each row records the [[Agent]] who caused the change, the [[StateTransitionType]] axis, and the from→to status values.

## Subtypes

Each journal row belongs to exactly one axis, selected by `state_transition_type`. [[Milestone_StateTransition]] covers TWO type codes — both `milestone-tracking` AND `milestone-relevance` — because a [[Milestone]] has two independent status axes (tracking AND relevance); the SQL CHECK uses `fn_StateTransitionIsMilestoneAxis`. The other four members each cover a single relevance or tracking code: [[Task_StateTransition]] for task-tracking, [[Memory_StateTransition]] for memory-relevance, [[Note_StateTransition]] for note-relevance, and [[Artifact_StateTransition]] for artifact-relevance.

## Notes

- Rows are write-once (no `updated_at`) — the table is an immutable audit journal.
