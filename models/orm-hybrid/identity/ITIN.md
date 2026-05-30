---
entity: ITIN
group: identity
pk:
  - id
columns:
  id:
    type: integer
  identity_id:
    type: integer
  itin:
    type: text
relationships:
  - target: Identity
    on:
      identity_id: id
    predicate: is a
---

# ITIN

US Individual Taxpayer Identification Number held by the Party
