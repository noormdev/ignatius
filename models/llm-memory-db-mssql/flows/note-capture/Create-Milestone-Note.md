---
process: Create Milestone Note
number: 2
inputs:
  - from: ext:LLM-Agent
    data: content, reason, milestone_id
outputs:
  - to: db:Note
    data: [note_type, relevance_status, provenance_id, agent_id, content, reason]
  - to: db:Milestone_Note
    data: [note_id, milestone_id]
  - to: ext:LLM-Agent
    data: new note_id
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent records a progress observation against a milestone
      rows:
        - { agent_id: 1, provenance_id: "msg-042", milestone_id: 9001, content: "CP26 shipped; DD card now shows per-process sample-data tables.", reason: "Milestone completion context for future retrospectives." }
  out:
    - to: db:Note
      label: Base note row inserted
      rows:
        - { note_id: 7002, note_type: "milestone", relevance_status: "active", provenance_id: "msg-042", agent_id: 1, content: "CP26 shipped; DD card now shows per-process sample-data tables.", reason: "Milestone completion context for future retrospectives." }
    - to: db:Milestone_Note
      label: Subtype discriminator row inserted
      rows:
        - { note_id: 7002, milestone_id: 9001 }
---

Atomically creates a base [[Note]] row (note_type='milestone', relevance_status='active') and the matching [[Milestone_Note]] subtype row that binds the note to its parent milestone.

The [[LLM-Agent]] supplies the free-form content, an optional reason, and the target milestone_id. The process fixes note_type to 'milestone' and initialises relevance_status to 'active'.

Both inserts execute inside a single transaction; failure of either rolls back the whole operation, preventing orphaned [[Note]] rows with no subtype parent.

The new note_id is returned to the calling [[LLM-Agent]] so it can track, update, or later archive the note via [[Set-Note-Relevance]].
