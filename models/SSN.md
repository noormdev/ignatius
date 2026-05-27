---
entity: SSN
classification: Subtype
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
  ssn:
    type: text
relationships:
  - target: Identity
    identifying: true
    on:
      party_id: party_id
    predicate: is a
---

# SSN

US Social Security Number held by the Party

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → Identity | No |  |
| 2 | ssn | text | — | No |  |
