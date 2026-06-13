---
entity: Note
group: knowledge
pk:
  - note_id
columns:
  note_id: { type: integer, desc: "IDENTITY surrogate PK." }
  note_type: { type: text, desc: "Discriminator — foreign key to NoteType.note_type (project | milestone | task)." }
  relevance_status: { type: text, desc: "Lifecycle state — foreign key to RelevanceStatus." }
  provenance_id: { type: integer, desc: "Originating project — foreign key to Project.project_id (sentinel 0 = none)." }
  agent_id: { type: integer, desc: "Recording agent — foreign key to Agent.agent_id (sentinel 0 = none)." }
  content: { type: text, desc: "Note body." }
  reason: { type: text, desc: "Why the note was recorded." }
  created_at: { type: datetime, default: now, desc: "Creation timestamp." }
  updated_at: { type: datetime, default: now, desc: "Last update timestamp." }
subtypes:
  - exclusive: true
    desc: Every Note is exactly one of project / milestone / task note, selected by note_type
    members:
      Project_Note:
        note_type: NoteType.note_type.project
      Milestone_Note:
        note_type: NoteType.note_type.milestone
      Task_Note:
        note_type: NoteType.note_type.task
relationships:
  - target: NoteType
    on: { note_type: note_type }
    predicate: { fwd: classifies, rev: is classified by }
  - target: RelevanceStatus
    on: { relevance_status: relevance_status }
    predicate: { fwd: classifies, rev: is classified by }
  - target: Project
    on: { provenance_id: project_id }
    predicate: { fwd: is the provenance of, rev: originates from }
  - target: Agent
    on: { agent_id: agent_id }
    predicate: { fwd: records, rev: is recorded by }
examples:
  - { note_id: 7001, note_type: project, relevance_status: active, provenance_id: 100, agent_id: 1, content: "Repo uses Bun, not Node — never reach for npm/vite." }
  - { note_id: 7002, note_type: milestone, relevance_status: active, provenance_id: 100, agent_id: 1, content: "Spotlight grid shipped; revisit deep-linking next." }
  - { note_id: 7003, note_type: task, relevance_status: archived, provenance_id: 100, agent_id: 1, content: "Wire ZoomControl to Flows view." }
---

# Note

A Note is free-form text recorded by an [[Agent]] capturing a factual observation, instruction, or context item — attached to exactly one [[Project]], [[Milestone]], or [[Task]] and governed by a [[RelevanceStatus]] lifecycle.

## Subtypes

A Note attaches to exactly one parent entity, discriminated by `note_type` and enforced via `fn_NoteIsOfType`: a [[Project]] (via [[Project_Note]]), a [[Milestone]] (via [[Milestone_Note]]), or a [[Task]] (via [[Task_Note]]). The three subtypes are mutually exclusive — a given `note_id` appears in exactly one subtype table, never more.
