---
entity: NoteType
group: reference
pk:
  - note_type
columns:
  note_type:
    type: text
    desc: "Code classifying the structural role of a note within the memory system"
reference: true
examples:
  - { note_type: project }
  - { note_type: milestone }
  - { note_type: task }
---

# NoteType

Controlled vocabulary that classifies notes by their structural role — whether a note belongs to a project, milestone, or task context.
