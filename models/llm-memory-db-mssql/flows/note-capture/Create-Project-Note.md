---
process: Create Project Note
number: 1
inputs:
  - from: ext:LLM-Agent
    data: content, reason, project_id
outputs:
  - to: db:Note
    data: [note_type, relevance_status, provenance_id, agent_id, content, reason]
  - to: db:Project_Note
    data: [note_id, project_id]
  - to: ext:LLM-Agent
    data: new note_id
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent attaches an observation to the ignatius project
      rows:
        - { agent_id: 1, provenance_id: "msg-001", project_id: 100, content: "Repo uses Bun, not Node — all scripts and tests run via bun.", reason: "Captured for future task planning context." }
  out:
    - to: db:Note
      label: Base note row inserted
      rows:
        - { note_id: 7001, note_type: "project", relevance_status: "active", provenance_id: "msg-001", agent_id: 1, content: "Repo uses Bun, not Node — all scripts and tests run via bun.", reason: "Captured for future task planning context." }
    - to: db:Project_Note
      label: Subtype discriminator row inserted
      rows:
        - { note_id: 7001, project_id: 100 }
---

Atomically creates a base [[Note]] row (note_type='project', relevance_status='active') and the matching [[Project_Note]] subtype row that binds the note to its parent project.

The [[LLM-Agent]] supplies the free-form content, an optional reason describing why the note is relevant, and the target project_id. The process derives note_type and sets the initial relevance_status to 'active' — the agent never supplies these directly.

Both inserts are wrapped in a single transaction. If either write fails the entire operation rolls back, leaving no orphaned rows in [[Note]].

The new note_id is returned to the [[LLM-Agent]] so it can reference the note in subsequent operations such as [[Set-Note-Relevance]].
