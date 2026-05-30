---
entity: Identity
group: identity
pk:
  - id
columns:
  id:
    type: integer
  party_id:
    type: integer
ak:
  - rule: one identity container per party
    columns:
      - party_id
relationships:
  - target: Party
    on:
      party_id: id
    predicate: identifies
---

# Identity

Container for the ID documents a Party holds — 1:1 with Party
