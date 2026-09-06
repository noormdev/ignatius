---
entity: RelevanceStatus
group: reference
description: Controlled vocabulary for lifecycle relevance states (active, archived, deleted) of memories, artifacts, and notes.
pk:
  - relevance_status
columns:
  relevance_status:
    type: text
    desc: "Code identifying the lifecycle relevance state of a memory or artifact"
reference: true
examples:
  - { relevance_status: active }
  - { relevance_status: archived }
  - { relevance_status: deleted }
---

# RelevanceStatus

Controlled vocabulary for relevance lifecycle states used by memory, artifact, and note entities. Legal transitions between states are enforced by [[RelevanceStatus_Allowed]].
