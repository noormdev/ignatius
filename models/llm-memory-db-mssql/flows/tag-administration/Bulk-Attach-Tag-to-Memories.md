---
process: Bulk Attach Tag to Memories
number: 3
inputs:
  - from: ext:LLM-Agent
    data: tag and memory set (tag_id, memory_ids[ ])
  - from: db:Memory_Tag
    data: [tag_id, memory_id]
outputs:
  - to: db:Memory_Tag
    data: [tag_id, memory_id]
  - to: ext:LLM-Agent
    data: inserted count and skipped count
examples:
  in:
    - from: ext:LLM-Agent
      label: Tag multiple ELK-related memories "performance" in one call
      rows:
        - { tag_id: 42, memory_ids: [5001, 5002] }
    - from: db:Memory_Tag
      label: Anti-join baseline — memory 5001 already tagged, 5002 is new
      rows:
        - { tag_id: 42, memory_id: 5001 }
  out:
    - to: db:Memory_Tag
      label: Net-new junction rows (only the un-tagged memory)
      rows:
        - { tag_id: 42, memory_id: 5002, created_at: "2026-06-13T10:05:00Z" }
    - to: ext:LLM-Agent
      label: Summary of what changed
      rows:
        - { inserted: 1, skipped: 1 }
---

Attaches one [[Tag]] to an arbitrary set of [[Memory]] rows in a single database round trip using a table-valued parameter.

The agent passes `tag_id` and a list of `memory_id` values. The procedure loads the list into a table-valued parameter, then anti-joins it against existing [[Memory_Tag]] rows for that `tag_id` to isolate the subset that is not yet linked. Only the net-new pairs are inserted; already-linked pairs are silently skipped. The returned counts let the agent distinguish a no-op call from a partial or full insert without inspecting the junction table itself.

Use this process in preference to repeated single calls to **Attach Tag to Memory** whenever the agent is labelling a batch of retrieved memories — for example, after a search sweep identifies a cluster of memories all related to the same theme.
