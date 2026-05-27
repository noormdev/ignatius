---
entity: Passport
classification: Subtype
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
  passport_number:
    type: text
  issuing_country:
    type: text
  issued_on:
    type: date
  expires_on:
    type: date
relationships:
  - target: Identity
    identifying: true
    on:
      party_id: party_id
    predicate: is a
---

# Passport

Passport held by the Party

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → Identity | No |  |
| 2 | passport_number | text | — | No |  |
| 3 | issuing_country | text | — | No |  |
| 4 | issued_on | date | — | No |  |
| 5 | expires_on | date | — | No |  |
