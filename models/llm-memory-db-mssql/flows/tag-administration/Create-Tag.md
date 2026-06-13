---
process: Create Tag
number: 1
inputs:
  - from: ext:LLM-Agent
    data: new tag (name, description, reason, provenance_id)
  - from: db:Tag
    data: [name]
outputs:
  - to: db:Tag
    data: [provenance_id, agent_id, name, description, reason]
  - to: ext:LLM-Agent
    data: newly assigned tag_id
examples:
  in:
    - from: ext:LLM-Agent
      label: Create a "performance" label for the ignatius project
      rows:
        - { name: performance, description: "Relates to render speed, ELK layout cost, or benchmark work", reason: "Repeatedly tagging graph-perf memories by hand; needs a canonical label", provenance_id: 100 }
    - from: db:Tag
      label: Uniqueness guard — no existing tag named "performance"
      rows: []
  out:
    - to: db:Tag
      label: Persisted tag row
      rows:
        - { tag_id: 42, provenance_id: 100, agent_id: 1, name: performance, description: "Relates to render speed, ELK layout cost, or benchmark work", reason: "Repeatedly tagging graph-perf memories by hand; needs a canonical label" }
    - to: ext:LLM-Agent
      label: Confirmation with new identity
      rows:
        - { tag_id: 42 }
---

Mints a new [[Tag]] and returns its identity to the [[LLM-Agent]].

Before inserting, the process checks [[Tag]] for an existing row with the same `name` (case-sensitive unique constraint). A duplicate name → error returned, no row written. The agent should resolve the collision — either reuse the existing `tag_id` or choose a distinct name — before retrying.

`agent_id` is resolved from the calling session context, not supplied by the agent. `provenance_id` pins the tag to the [[Project]] that originated it, giving the agent a namespace anchor when the same concept appears across multiple projects.

The new `tag_id` is returned immediately so the agent can begin attaching the tag to [[Memory]], [[Project]], [[Artifact]], [[Milestone]], or [[Task]] rows without an extra lookup round-trip.
