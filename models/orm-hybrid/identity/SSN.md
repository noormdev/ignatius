---
entity: SSN
group: identity
pk:
  - id
columns:
  id:
    type: integer
  identity_id:
    type: integer
  ssn:
    type: text
relationships:
  - target: Identity
    on:
      identity_id: id
    predicate: is a
---

# SSN

US Social Security Number held by the Party
