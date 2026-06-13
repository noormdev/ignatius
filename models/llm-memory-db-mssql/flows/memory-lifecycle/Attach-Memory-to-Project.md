---
process: Attach Memory to Project
number: 5
inputs:
  - from: ext:LLM-Agent
    data: attachment request (memory_id, project_id)
  - from: db:Project_Memory
    data: [project_id, memory_id]
outputs:
  - to: db:Project_Memory
    data: [project_id, memory_id]
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent scopes the debounce gotcha to the ignatius project
      rows:
        - { memory_id: 5001, project_id: 100 }
    - from: db:Project_Memory
      label: Idempotency check — link does not yet exist
      rows: []
  out:
    - to: db:Project_Memory
      label: Project-memory link written
      rows:
        - { project_id: 100, memory_id: 5001 }
---

Associates a [[Memory]] with a project context by writing a row into [[Project_Memory]].

The process first checks whether the `(project_id, memory_id)` pair already exists. If it does, the call is a no-op — the link is idempotent and the agent can re-assert the association without creating duplicates. This makes it safe to call unconditionally at the start of a project session when the agent re-scopes its active memories.

No validation is performed on the `project_id` itself — project identity is managed outside this subsystem. The operation is intentionally lightweight: a single existence check followed by a conditional insert. There is no cascade or state change on the [[Memory]] row.

To remove a memory from a project scope, or to move it from one project to another, the calling agent must issue a separate delete and re-attach sequence.
