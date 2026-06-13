---
process: Create Memory
number: 1
inputs:
  - from: ext:LLM-Agent
    data: new memory fact (content, domain, category, reason, was_inferred, was_observed, was_evidenced, was_user_provided)
  - from: db:MemoryDomain
    data: [domain]
  - from: db:MemoryCategory
    data: [category]
outputs:
  - to: db:Memory
    data: [domain, category, relevance_status, provenance_id, agent_id, content, reason, was_inferred, was_observed, was_evidenced, was_user_provided, last_accessed_at, access_count]
  - to: ext:LLM-Agent
    data: newly assigned memory_id
examples:
  in:
    - from: ext:LLM-Agent
      label: New gotcha fact about Bun file watching
      rows:
        - { content: "Bun fs.watch coalesces events — debounce 200ms", domain: coding, category: gotcha, reason: "Observed duplicate SSE triggers in dev server without debounce", was_inferred: false, was_observed: true, was_evidenced: false, was_user_provided: false }
    - from: db:MemoryDomain
      label: Validate domain exists
      rows:
        - { domain: coding }
    - from: db:MemoryCategory
      label: Validate category exists
      rows:
        - { category: gotcha }
  out:
    - to: db:Memory
      label: Persisted memory row
      rows:
        - { domain: coding, category: gotcha, relevance_status: active, provenance_id: null, agent_id: 1, content: "Bun fs.watch coalesces events — debounce 200ms", reason: "Observed duplicate SSE triggers in dev server without debounce", was_inferred: false, was_observed: true, was_evidenced: false, was_user_provided: false, last_accessed_at: null, access_count: 0 }
    - to: ext:LLM-Agent
      label: Confirmation with new identity
      rows:
        - { memory_id: 5001 }
---

Persists a new long-term [[Memory]] fact supplied by the [[LLM-Agent]].

Before inserting, the process validates that the requested `domain` exists in [[MemoryDomain]] and the requested `category` exists in [[MemoryCategory]]. Either missing → error returned, no row written.

The row is created with `relevance_status = 'active'`, `access_count = 0`, and `last_accessed_at = NULL`. The four `was_*` columns encode the provenance of the fact: how the agent came to know it (observed in session, inferred from other memories, evidenced by a source, or directly provided by the user). At least one should be true; the process does not enforce this constraint but the agent is expected to honour it.

The newly generated `memory_id` is returned to the agent so it can immediately relate, tag, or attach the memory to a project without a round-trip lookup.
