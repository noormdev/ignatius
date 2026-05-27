---
entity: License
classification: Subtype
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
  license_number:
    type: text
  issuing_state:
    type: text
  issued_on:
    type: date
  expires_on:
    type: date
ak:
  - rule: license number unique within state
    columns:
      - license_number
      - issuing_state
relationships:
  - target: Identity
    identifying: true
    on:
      party_id: party_id
    predicate: is a
---

# License

Driver's license held by the Party

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → Identity | No |  |
| 2 | license_number | text |  | No |  |
| 3 | issuing_state | text |  | No |  |
| 4 | issued_on | date | — | No |  |
| 5 | expires_on | date | — | No |  |

## Constraints

- **license expires after issued**: Expiration date must fall after the issue date
