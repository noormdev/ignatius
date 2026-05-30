---
entity: License
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
    on:
      party_id: party_id
    predicate: is a
---

# License

Driver's license held by the Party

## Constraints

- **license expires after issued**: Expiration date must fall after the issue date
