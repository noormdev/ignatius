---
entity: Note_StateTransition
group: audit
pk:
  - transition_id
columns:
  transition_id: { type: integer, desc: "Shared PK — FK to StateTransition." }
  note_id: { type: integer, desc: "FK to the Note whose relevance status changed." }
  created_at: { type: datetime, default: now, desc: "When this subtype row was written." }
relationships:
  - target: StateTransition
    on: { transition_id: transition_id }
    predicate: { fwd: is realized as, rev: is a }
  - target: Note
    on: { note_id: note_id }
    predicate: { fwd: is journaled by, rev: journals }
examples:
  - { transition_id: 8004, note_id: 7003 }
---

# Note_StateTransition

[[Note_StateTransition]] pins a [[StateTransition]] journal entry to the specific [[Note]] whose relevance status changed, covering the `note-relevance` type code.
