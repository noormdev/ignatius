---
entity: Project_Milestone
group: planning
pk:
  - project_id
  - milestone_id
columns:
  project_id: { type: integer, desc: "FK to the owning Project" }
  milestone_id: { type: integer, desc: "FK to the attached Milestone" }
  created_at: { type: datetime, default: now, desc: "Row creation timestamp" }
relationships:
  - target: Project
    on: { project_id: project_id }
    predicate: { fwd: scopes, rev: is scoped to }
  - target: Milestone
    on: { milestone_id: milestone_id }
    predicate: { fwd: is attached via, rev: attaches }
examples:
  - { project_id: 100, milestone_id: 9001, created_at: "2026-05-01T00:00:00" }
  - { project_id: 100, milestone_id: 9002, created_at: "2026-05-15T00:00:00" }
  - { project_id: 100, milestone_id: 9003, created_at: "2026-06-01T00:00:00" }
---

# Project_Milestone

A Project_Milestone is the associative junction that attaches a [[Milestone]] to a [[Project]], allowing a milestone to be scoped under one or more projects.
