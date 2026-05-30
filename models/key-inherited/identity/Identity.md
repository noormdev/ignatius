---
entity: Identity
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
subtypes:
  - exclusive: false
    desc: A Party may hold any combination of these — inclusive, existence-based
    members:
      - License
      - Passport
      - SSN
      - ITIN
relationships:
  - target: Party
    on:
      party_id: party_id
    predicate: identifies
---

# Identity

Container for the ID documents a Party holds — 1:1 with Party

## Subtypes

A Party may hold any combination of these — inclusive, existence-based
- **Exclusive:** No
- **Members:** License, Passport, SSN, ITIN
