---
entity: Identity
classification: Basetype
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
relationships:
  - target: Party
    identifying: true
    on:
      party_id: party_id
    predicate: identifies
---

# Identity

Container for the ID documents a Party holds — 1:1 with Party

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → Party | No |  |

## Subtypes

A Party may hold any combination of these — inclusive, existence-based
- **Exclusive:** No
- **Members:** License, Passport, SSN, ITIN
