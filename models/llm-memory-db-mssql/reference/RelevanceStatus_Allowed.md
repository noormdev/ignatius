---
entity: RelevanceStatus_Allowed
group: reference
pk:
  - from_status
  - to_status
columns:
  from_status:
    type: text
    desc: "Relevance status code that is the source of this permitted transition"
  to_status:
    type: text
    desc: "Relevance status code that is the legal destination of this transition"
relationships:
  - target: RelevanceStatus
    on: { from_status: relevance_status }
    predicate: { fwd: "is the source of", rev: "starts from" }
  - target: RelevanceStatus
    on: { to_status: relevance_status }
    predicate: { fwd: "is the target of", rev: "ends at" }
examples:
  - { from_status: active, to_status: archived }
  - { from_status: archived, to_status: active }
  - { from_status: active, to_status: deleted }
---

# RelevanceStatus_Allowed

Encodes the legal edges of the [[RelevanceStatus]] transition graph. The stored-procedure layer checks this table before journaling a relevance-state change on memories, notes, and artifacts, preventing invalid status jumps.
