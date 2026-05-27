---
entity: PartyType
classification: Classifier
group: reference
pk:
  - code
columns:
  code:
    type: text
  description:
    type: text
---

# PartyType

Whether a Party is a Business or a Person

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | code | text | PK | No |  |
| 2 | description | text | — | No |  |

## Values

- `BUSINESS` — Legal business entity (corp, LLC, partnership)
- `PERSON` — Natural person
