---
entity: License
group: identity
pk:
  - id
columns:
  id:
    type: integer
  identity_id:
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
      identity_id: id
    predicate: is a
---

# License

Driver's license held by the Party
