---
entity: Agent
group: identity
pk:
  - agent_id
columns:
  agent_id:
    type: integer
    desc: "surrogate identity key assigned at registration"
  name:
    type: text
    desc: "display name for the AI coding agent (e.g. Claude, Cursor)"
  description:
    type: text
    nullable: true
    desc: "human-readable summary of the agent's role or capabilities"
  created_at:
    type: datetime
    default: now
    desc: "wall-clock timestamp when the agent record was first created"
  updated_at:
    type: datetime
    default: now
    desc: "wall-clock timestamp of the most recent update to this record"
examples:
  - { agent_id: 1, name: "Claude", description: "Anthropic's AI coding assistant", created_at: "2025-01-01T00:00:00", updated_at: "2025-01-01T00:00:00" }
  - { agent_id: 2, name: "Cursor", description: "AI-powered code editor agent", created_at: "2025-02-15T08:30:00", updated_at: "2025-06-01T12:00:00" }
---

# Agent

An Agent is an AI coding assistant (such as Claude or Cursor) whose identity anchors every memory, note, task, and artifact it creates in this database. Because rows in other tables default their `agent_id` to a sentinel value of `0`, memories created before an agent record existed — or after one is deleted — remain intact rather than becoming orphaned.
