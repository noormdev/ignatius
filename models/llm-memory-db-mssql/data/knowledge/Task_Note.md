---
entity: Task_Note
group: knowledge
pk:
  - note_id
columns:
  note_id: { type: integer, desc: "Shared key — foreign key to Note.note_id." }
  milestone_id: { type: integer, desc: "Milestone component of the composite FK to Task." }
  task_no: { type: integer, desc: "Task number component of the composite FK to Task." }
  created_at: { type: datetime, default: now, desc: "Creation timestamp." }
relationships:
  - target: Note
    on: { note_id: note_id }
    predicate: { fwd: is realized as, rev: is a }
  - target: Task
    on: { milestone_id: milestone_id, task_no: task_no }
    predicate: { fwd: is annotated by, rev: annotates }
examples:
  - { note_id: 7003, milestone_id: 9001, task_no: 1 }
---

# Task_Note

A Task_Note is the subtype record that attaches a [[Note]] to a specific [[Task]], carrying the composite FK (`milestone_id` + `task_no`) that the base [[Note]] table does not hold.
