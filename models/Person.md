---
entity: Person
classification: Subtype
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
  first_name:
    type: text
  last_name:
    type: text
  birthdate:
    type: date
relationships:
  - target: Party
    identifying: true
    on:
      party_id: party_id
    predicate: is a
---

# Person

Party that is a natural person

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → Party | No |  |
| 2 | first_name | text | — | No |  |
| 3 | last_name | text | — | No |  |
| 4 | birthdate | date | — | No |  |
