---
entity: Party
group: identity
pk:
  - id
columns:
  id:
    type: integer
  type:
    type: text
relationships:
  - target: PartyType
    on:
      type: code
    predicate: is classified by
---

# Party

Anyone the system transacts with
