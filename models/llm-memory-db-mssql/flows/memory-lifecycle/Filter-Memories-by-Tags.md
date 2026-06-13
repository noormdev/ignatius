---
process: Filter Memories by Tags
number: 6
inputs:
  - from: ext:LLM-Agent
    data: tag filter set (one or more tag_ids to intersect)
  - from: db:Memory_Tag
    data: [tag_id, memory_id]
  - from: db:Memory
    data: [memory_id, content]
outputs:
  - to: ext:LLM-Agent
    data: ranked list of matching memory_id and content
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent retrieves all memories tagged both performance and bun
      rows:
        - { tag_ids: [42, 44] }
    - from: db:Memory_Tag
      label: Tag membership rows for the candidate memories
      rows:
        - { tag_id: 42, memory_id: 5001 }
        - { tag_id: 44, memory_id: 5001 }
        - { tag_id: 44, memory_id: 5002 }
    - from: db:Memory
      label: Content for memories that pass the intersection filter
      rows:
        - { memory_id: 5001, content: "Bun fs.watch coalesces events — debounce 200ms" }
  out:
    - to: ext:LLM-Agent
      label: Memories carrying ALL requested tags, newest-first
      rows:
        - { memory_id: 5001, content: "Bun fs.watch coalesces events — debounce 200ms" }
---

Returns every active [[Memory]] that carries all of the supplied tags simultaneously, ranked by recency of last access.

The core operation is relational division: a memory qualifies only if its set of `tag_id` values is a superset of the requested filter set. Memories that carry some but not all of the requested tags are excluded. This makes the filter useful for precise retrieval — the agent can narrow results by combining orthogonal tags (e.g. `performance` ∩ `bun`) without getting every memory that happens to share one of them.

Only memories with `relevance_status = 'active'` are returned. Archived, deleted, and superseded memories are silently excluded — the agent should never be distracted by obsolete knowledge during active retrieval.

Results are ordered by `last_accessed_at DESC` (recency-ranked), so the most recently recalled memory appears first. This is a read-only process — no [[Memory]] rows are written or updated, and `access_count` / `last_accessed_at` are not bumped here. Access tracking is a separate concern handled outside this DFD.

This process is the agent's primary retrieval path when it knows the conceptual area it wants to recall but needs to surface the specific facts without a full-text scan.
