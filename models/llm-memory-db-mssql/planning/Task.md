---
entity: Task
group: planning
pk:
  - milestone_id
  - task_no
columns:
  milestone_id: { type: integer, desc: "FK to parent Milestone — part of the composite PK" }
  task_no: { type: integer, desc: "Sequential task number scoped within its milestone" }
  tracking_status: { type: text, desc: "Workflow status of this task" }
  agent_id: { type: integer, desc: "Agent assigned to or that recorded this task (sentinel 0 = system)" }
  title: { type: text, desc: "Short human-readable title" }
  content: { type: text, desc: "Full narrative body of the task" }
  reason: { type: text, desc: "Rationale for why this task exists" }
  created_at: { type: datetime, default: now, desc: "Row creation timestamp" }
  updated_at: { type: datetime, default: now, desc: "Row last-modified timestamp" }
relationships:
  - target: Milestone
    on: { milestone_id: milestone_id }
    predicate: { fwd: is broken down into, rev: advances }
  - target: TrackingStatus
    on: { tracking_status: tracking_status }
    predicate: { fwd: classifies, rev: is classified by }
  - target: Agent
    on: { agent_id: agent_id }
    predicate: { fwd: records, rev: is recorded by }
examples:
  - { milestone_id: 9001, task_no: 1, tracking_status: done, agent_id: 1, title: "Build SpotlightOverlay", content: "Implement the fixed SVG overlay component that draws bezier leader lines and off-screen chips.", reason: "Core visual layer for the spotlight grid feature." }
  - { milestone_id: 9001, task_no: 2, tracking_status: done, agent_id: 1, title: "Wire focus mode", content: "Filter the browse grid to the active card and its connected set when a card is clicked.", reason: "Reduce visual noise when exploring a specific entity's relationships." }
  - { milestone_id: 9002, task_no: 1, tracking_status: in_progress, agent_id: 1, title: "DD sidebar hierarchical nesting", content: "Sort and indent process entries in the DD sidebar by dotted number.", reason: "CP24 — improves DFD navigability in the dictionary." }
---

# Task

A Task is an atomic unit of work that advances a [[Milestone]], identified by a milestone-scoped `task_no` so the composite PK inherits the parent key.
Tasks are classified by [[TrackingStatus]] and optionally assigned to an [[Agent]].
