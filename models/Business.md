---
entity: Business
classification: Subtype
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
  legal_name:
    type: text
  tax_id:
    type: text
ak:
  - rule: unique tax identifier
    columns:
      - tax_id
relationships:
  - target: Party
    identifying: true
    on:
      party_id: party_id
    predicate: is a
---

# Business

Party that is a legal business entity

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → Party | No |  |
| 2 | legal_name | text | — | No |  |
| 3 | tax_id | text |  | No |  |
