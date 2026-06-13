---
entity: Project_Memory
group: memory
pk:
  - project_id
  - memory_id
columns:
  project_id:
    type: integer
    desc: "Project that this memory is relevant to (FK to Project)"
  memory_id:
    type: integer
    desc: "Memory attached to the project (FK to Memory)"
  created_at:
    type: datetime
    default: now
    desc: "Timestamp when the memory was attached to the project"
relationships:
  - target: Project
    on: { project_id: project_id }
    predicate: { fwd: scopes, rev: is scoped to }
  - target: Memory
    on: { memory_id: memory_id }
    predicate: { fwd: is attached via, rev: attaches }
examples:
  - { project_id: 100, memory_id: 5001 }
  - { project_id: 100, memory_id: 5002 }
  - { project_id: 101, memory_id: 5002 }
---

# Project_Memory

A junction that attaches a [[Memory]] to a [[Project]], capturing which durable facts, decisions, and conventions are relevant to each project. A single memory can serve many projects, and a project accumulates memories over the course of an [[Agent]]'s work on it.
