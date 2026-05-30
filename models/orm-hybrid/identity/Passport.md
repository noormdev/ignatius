---
entity: Passport
group: identity
pk:
  - id
columns:
  id:
    type: integer
  identity_id:
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
    on:
      identity_id: id
    predicate: is a
---

# Passport

Passport held by the Party
