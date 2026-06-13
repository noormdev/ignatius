---
entity: Milestone_Note
group: knowledge
pk:
  - note_id
columns:
  note_id: { type: integer, desc: "Shared key — foreign key to Note.note_id." }
  milestone_id: { type: integer, desc: "The milestone this note annotates — foreign key to Milestone.milestone_id." }
  created_at: { type: datetime, default: now, desc: "Creation timestamp." }
relationships:
  - target: Note
    on: { note_id: note_id }
    predicate: { fwd: is realized as, rev: is a }
  - target: Milestone
    on: { milestone_id: milestone_id }
    predicate: { fwd: is annotated by, rev: annotates }
examples:
  - { note_id: 7002, milestone_id: 9001 }
---

# Milestone_Note

A Milestone_Note is the subtype record that attaches a [[Note]] to a specific [[Milestone]], carrying the milestone FK that the base [[Note]] table does not hold.
