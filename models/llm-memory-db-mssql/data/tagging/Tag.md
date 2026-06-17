---
entity: Tag
group: tagging
pk:
  - tag_id
columns:
  tag_id: { type: integer, desc: "IDENTITY surrogate primary key" }
  provenance_id: { type: integer, desc: "Project that originated this tag (sentinel 0 for system-wide tags)" }
  agent_id: { type: integer, desc: "Agent that created this tag (sentinel 0 for manually created tags)" }
  name: { type: text, desc: "Unique human-readable label for the tag" }
  description: { type: text, desc: "Optional longer explanation of what this tag means" }
  reason: { type: text, desc: "Why this tag was created or applied in this context" }
  created_at: { type: datetime, default: now, desc: "When the tag was created" }
  updated_at: { type: datetime, default: now, desc: "When the tag was last modified" }
ak:
  - rule: unique tag name
    columns: [name]
relationships:
  - target: Project
    on: { provenance_id: project_id }
    predicate: { fwd: is the provenance of, rev: originates from }
  - target: Agent
    on: { agent_id: agent_id }
    predicate: { fwd: records, rev: is recorded by }
examples:
  - { tag_id: 42, provenance_id: 100, agent_id: 1, name: "performance", description: "Relates to runtime or query performance", reason: "Claude flagged during ignatius perf work", created_at: "2025-01-10T09:00:00", updated_at: "2025-01-10T09:00:00" }
  - { tag_id: 43, provenance_id: 0, agent_id: 0, name: "security", description: "Security-sensitive code or data", reason: "Manual classification", created_at: "2025-01-11T10:30:00", updated_at: "2025-01-11T10:30:00" }
  - { tag_id: 44, provenance_id: 100, agent_id: 1, name: "bun", description: "Relates to the Bun runtime", reason: "Claude applied during ignatius toolchain audit", created_at: "2025-01-12T14:00:00", updated_at: "2025-01-12T14:00:00" }
---

# Tag

A reusable, uniquely-named label that an [[Agent]] applies across the system to classify memories, artifacts, milestones, tasks, and projects. Tags are created with an optional provenance [[Project]] and merged via `sp_Tag_Merge` when duplicates accumulate.
