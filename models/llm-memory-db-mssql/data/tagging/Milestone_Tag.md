---
entity: Milestone_Tag
group: tagging
pk:
  - tag_id
  - milestone_id
columns:
  tag_id: { type: integer, desc: "FK to Tag — the label being applied" }
  milestone_id: { type: integer, desc: "FK to Milestone — the milestone being tagged" }
  created_at: { type: datetime, default: now, desc: "When this tag was attached to the milestone" }
relationships:
  - target: Tag
    on: { tag_id: tag_id }
    predicate: { fwd: classifies, rev: is classified by }
  - target: Milestone
    on: { milestone_id: milestone_id }
    predicate: { fwd: is tagged via, rev: tags }
examples:
  - { tag_id: 42, milestone_id: 9001, created_at: "2025-01-10T11:00:00" }
  - { tag_id: 43, milestone_id: 9001, created_at: "2025-01-11T08:45:00" }
  - { tag_id: 44, milestone_id: 9002, created_at: "2025-01-12T15:00:00" }
---

# Milestone_Tag

Junction that attaches a [[Tag]] to a [[Milestone]], enabling classification of planning milestones by theme or concern. Deleting a tag cascades to remove all its Milestone_Tag rows.
