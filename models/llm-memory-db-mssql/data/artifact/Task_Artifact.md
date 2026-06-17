---
entity: Task_Artifact
group: artifact
pk:
  - milestone_id
  - task_no
  - artifact_id
columns:
  milestone_id: { type: integer, desc: "Part of composite FK to Task and composite PK" }
  task_no: { type: integer, desc: "Part of composite FK to Task and composite PK" }
  artifact_id: { type: integer, desc: "FK to Artifact; part of composite PK" }
  created_at: { type: datetime, default: now, desc: "Row creation timestamp" }
relationships:
  - target: Task
    on: { milestone_id: milestone_id, task_no: task_no }
    predicate: { fwd: produces, rev: is produced under }
  - target: Artifact
    on: { artifact_id: artifact_id }
    predicate: { fwd: is attached via, rev: attaches }
examples:
  - { milestone_id: 9001, task_no: 1, artifact_id: 3001, created_at: "2026-06-01T10:10:00" }
  - { milestone_id: 9001, task_no: 1, artifact_id: 3002, created_at: "2026-06-02T14:40:00" }
  - { milestone_id: 9001, task_no: 2, artifact_id: 3003, created_at: "2026-05-15T09:15:00" }
---

# Task_Artifact

Junction linking a [[Task]] (identified by its composite key `milestone_id + task_no`) to the [[Artifact]] objects produced under it. Provides finer-grained provenance than [[Milestone_Artifact]] when the producing task is known.
