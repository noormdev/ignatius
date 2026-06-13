---
process: Create Agent
number: 1
inputs:
  - from: ext:LLM-Agent
    data: agent name and description
outputs:
  - to: db:Agent
    data: [name, description]
  - to: ext:LLM-Agent
    data: newly assigned agent_id
examples:
  in:
    - from: ext:LLM-Agent
      label: Registration request from a new LLM agent
      rows:
        - { name: "Claude", description: "Anthropic Claude — general-purpose reasoning and coding agent" }
  out:
    - to: db:Agent
      label: New agent row persisted
      rows:
        - { name: "Claude", description: "Anthropic Claude — general-purpose reasoning and coding agent" }
    - to: ext:LLM-Agent
      label: Confirmed identity token returned to caller
      rows:
        - { agent_id: 1 }
---

An [[LLM-Agent]] announces itself to the system by supplying a human-readable name and an optional description. This process inserts a new row into [[Agent]], letting the database assign a surrogate `agent_id` via identity column. The returned `agent_id` is the durable identity token the agent must supply in every subsequent call — it scopes [[Project]] workspaces, memories, notes, milestones, tasks, and artifacts.

No validation beyond uniqueness is imposed at this layer; the stored procedure trusts that the caller is an authorized agent process. `created_at` and `updated_at` are set by the database at insert time and are not supplied by the caller.
