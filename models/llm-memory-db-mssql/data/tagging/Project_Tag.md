---
entity: Project_Tag
group: tagging
pk:
  - tag_id
  - project_id
columns:
  tag_id: { type: integer, desc: "FK to Tag — the label being applied" }
  project_id: { type: integer, desc: "FK to Project — the project being tagged" }
  created_at: { type: datetime, default: now, desc: "When this tag was attached to the project" }
relationships:
  - target: Tag
    on: { tag_id: tag_id }
    predicate: { fwd: classifies, rev: is classified by }
  - target: Project
    on: { project_id: project_id }
    predicate: { fwd: is tagged via, rev: tags }
examples:
  - { tag_id: 44, project_id: 100, created_at: "2025-01-12T14:05:00" }
  - { tag_id: 43, project_id: 100, created_at: "2025-01-13T08:00:00" }
  - { tag_id: 42, project_id: 100, created_at: "2025-01-14T11:00:00" }
---

# Project_Tag

Junction that attaches a [[Tag]] to a [[Project]], forming one edge in the system-wide tagging fabric. Deleting a tag cascades to remove all its Project_Tag rows.
