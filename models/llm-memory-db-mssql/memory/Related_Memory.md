---
entity: Related_Memory
group: memory
pk:
  - memory_id
  - related_memory_id
columns:
  memory_id:
    type: integer
    desc: "Source memory in the directed relationship (FK to Memory)"
  related_memory_id:
    type: integer
    desc: "Target memory in the directed relationship (FK to Memory)"
  relation_verb:
    type: text
    desc: "Forward verb describing how the source relates to the target (supersedes, supports, contradicts)"
  reason:
    type: text
    nullable: true
    desc: "Explanation of why this relationship was asserted"
  created_at:
    type: datetime
    default: now
    desc: "Timestamp when the relationship was recorded"
relationships:
  - target: Memory
    on: { memory_id: memory_id }
    predicate: { fwd: is the source of, rev: relates from }
  - target: Memory
    on: { related_memory_id: memory_id }
    predicate: { fwd: is the target of, rev: relates to }
  - target: MemoryRelationVerb
    on: { relation_verb: verb_forward }
    predicate: { fwd: labels, rev: is labeled by }
examples:
  - { memory_id: 5002, related_memory_id: 5001, relation_verb: supersedes, reason: "The architectural decision to use a unified SPA supersedes the earlier per-view gotcha about debounce timing" }
  - { memory_id: 5001, related_memory_id: 5003, relation_verb: supports, reason: "The fs.watch debounce gotcha supports the convention of always running validate after file writes" }
---

# Related_Memory

A directed edge in the [[Memory]] graph, asserting that one memory (the source) stands in a named relationship — supersedes, supports, or contradicts — to another memory (the target), with the relationship verb drawn from [[MemoryRelationVerb]]. Together these edges let an [[Agent]] reason about the evolution and consistency of its knowledge over time.
