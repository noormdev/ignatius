---
entity: Project_Note
group: knowledge
pk:
  - note_id
columns:
  note_id: { type: integer, desc: "Shared key — foreign key to Note.note_id." }
  project_id: { type: integer, desc: "The project this note annotates — foreign key to Project.project_id." }
  created_at: { type: datetime, default: now, desc: "Creation timestamp." }
relationships:
  - target: Note
    on: { note_id: note_id }
    predicate: { fwd: is realized as, rev: is a }
  - target: Project
    on: { project_id: project_id }
    predicate: { fwd: is annotated by, rev: annotates }
examples:
  - { note_id: 7001, project_id: 100 }
---

# Project_Note

A Project_Note is the subtype record that attaches a [[Note]] to a specific [[Project]], carrying the project FK that the base [[Note]] table does not hold.
