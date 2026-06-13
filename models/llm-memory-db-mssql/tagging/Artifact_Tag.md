---
entity: Artifact_Tag
group: tagging
pk:
  - tag_id
  - artifact_id
columns:
  tag_id: { type: integer, desc: "FK to Tag — the label being applied" }
  artifact_id: { type: integer, desc: "FK to Artifact — the artifact being tagged" }
  created_at: { type: datetime, default: now, desc: "When this tag was attached to the artifact" }
relationships:
  - target: Tag
    on: { tag_id: tag_id }
    predicate: { fwd: classifies, rev: is classified by }
  - target: Artifact
    on: { artifact_id: artifact_id }
    predicate: { fwd: is tagged via, rev: tags }
examples:
  - { tag_id: 42, artifact_id: 3001, created_at: "2025-01-10T10:00:00" }
  - { tag_id: 44, artifact_id: 3001, created_at: "2025-01-12T14:10:00" }
  - { tag_id: 43, artifact_id: 3002, created_at: "2025-01-13T09:30:00" }
---

# Artifact_Tag

Junction that attaches a [[Tag]] to an [[Artifact]], allowing agents to classify produced artifacts by topic or quality dimension. Deleting a tag cascades to remove all its Artifact_Tag rows.
