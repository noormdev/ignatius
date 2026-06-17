---
entity: Milestone_Artifact
group: artifact
pk:
  - milestone_id
  - artifact_id
columns:
  milestone_id: { type: integer, desc: "FK to Milestone; part of composite PK" }
  artifact_id: { type: integer, desc: "FK to Artifact; part of composite PK" }
  created_at: { type: datetime, default: now, desc: "Row creation timestamp" }
relationships:
  - target: Milestone
    on: { milestone_id: milestone_id }
    predicate: { fwd: produces, rev: is produced under }
  - target: Artifact
    on: { artifact_id: artifact_id }
    predicate: { fwd: is attached via, rev: attaches }
examples:
  - { milestone_id: 9001, artifact_id: 3001, created_at: "2026-06-01T10:05:00" }
  - { milestone_id: 9001, artifact_id: 3002, created_at: "2026-06-02T14:35:00" }
  - { milestone_id: 9001, artifact_id: 3003, created_at: "2026-05-15T09:10:00" }
---

# Milestone_Artifact

Junction linking a [[Milestone]] to the [[Artifact]] objects produced under it. Cascades on the milestone side so that retiring a milestone removes all attachment rows.
