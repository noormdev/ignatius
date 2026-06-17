---
entity: Memory_Tag
group: tagging
pk:
  - tag_id
  - memory_id
columns:
  tag_id: { type: integer, desc: "FK to Tag — the label being applied" }
  memory_id: { type: integer, desc: "FK to Memory — the memory being tagged" }
  created_at: { type: datetime, default: now, desc: "When this tag was attached to the memory" }
relationships:
  - target: Tag
    on: { tag_id: tag_id }
    predicate: { fwd: classifies, rev: is classified by }
  - target: Memory
    on: { memory_id: memory_id }
    predicate: { fwd: is tagged via, rev: tags }
examples:
  - { tag_id: 42, memory_id: 5001, created_at: "2025-01-10T09:15:00" }
  - { tag_id: 43, memory_id: 5001, created_at: "2025-01-10T09:16:00" }
  - { tag_id: 44, memory_id: 5002, created_at: "2025-01-11T12:00:00" }
---

# Memory_Tag

Junction that attaches a [[Tag]] to a [[Memory]], enabling semantic labeling of stored agent memories. Deleting a tag cascades to remove all its Memory_Tag rows.
