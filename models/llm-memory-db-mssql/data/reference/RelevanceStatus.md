---
entity: RelevanceStatus
group: reference
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
