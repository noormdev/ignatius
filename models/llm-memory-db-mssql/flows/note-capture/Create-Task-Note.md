---
process: Create Task Note
number: 3
inputs:
  - from: ext:LLM-Agent
    data: content, reason, milestone_id, task_no
outputs:
  - to: db:Note
    data: [note_type, relevance_status, provenance_id, agent_id, content, reason]
  - to: db:Task_Note
    data: [note_id, milestone_id, task_no]
  - to: ext:LLM-Agent
    data: new note_id
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent annotates a specific task with an implementation decision
      rows:
        - { agent_id: 1, provenance_id: "msg-117", milestone_id: 9001, task_no: 1, content: "Decided to use ResizeObserver for spotlight overlay redraws — avoids polling.", reason: "Decision log for the spotlight grid task." }
  out:
    - to: db:Note
      label: Base note row inserted
      rows:
        - { note_id: 7003, note_type: "task", relevance_status: "active", provenance_id: "msg-117", agent_id: 1, content: "Decided to use ResizeObserver for spotlight overlay redraws — avoids polling.", reason: "Decision log for the spotlight grid task." }
    - to: db:Task_Note
      label: Subtype discriminator row inserted
      rows:
        - { note_id: 7003, milestone_id: 9001, task_no: 1 }
---

Atomically creates a base [[Note]] row (note_type='task', relevance_status='active') and the matching [[Task_Note]] subtype row that pins the note to a specific task within a milestone.

The [[LLM-Agent]] supplies the free-form content, an optional reason, and the composite task address (milestone_id + task_no). The process fixes note_type to 'task' and initialises relevance_status to 'active'.

Both inserts execute inside a single transaction. If either fails the operation rolls back completely, leaving no orphaned row in [[Note]].

Task notes share the same lifecycle as project and milestone notes — the [[LLM-Agent]] receives the new note_id and may later archive, restore, or delete the note via [[Set-Note-Relevance]].
