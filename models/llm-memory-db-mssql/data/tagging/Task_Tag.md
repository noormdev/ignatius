---
entity: Task_Tag
group: tagging
pk:
  - tag_id
  - milestone_id
  - task_no
columns:
  tag_id: { type: integer, desc: "FK to Tag — the label being applied" }
  milestone_id: { type: integer, desc: "First column of the composite FK to Task" }
  task_no: { type: integer, desc: "Second column of the composite FK to Task" }
  created_at: { type: datetime, default: now, desc: "When this tag was attached to the task" }
relationships:
  - target: Tag
    on: { tag_id: tag_id }
    predicate: { fwd: classifies, rev: is classified by }
  - target: Task
    on: { milestone_id: milestone_id, task_no: task_no }
    predicate: { fwd: is tagged via, rev: tags }
examples:
  - { tag_id: 42, milestone_id: 9001, task_no: 1, created_at: "2025-01-10T11:30:00" }
  - { tag_id: 44, milestone_id: 9001, task_no: 1, created_at: "2025-01-12T14:20:00" }
  - { tag_id: 43, milestone_id: 9001, task_no: 2, created_at: "2025-01-13T10:00:00" }
---

# Task_Tag

Junction that attaches a [[Tag]] to a [[Task]] via its composite key (milestone_id + task_no), the only junction in the tagging fabric that carries a two-column FK. Deleting a tag cascades to remove all its Task_Tag rows.
