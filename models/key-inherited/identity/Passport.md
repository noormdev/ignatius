---
entity: Passport
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
    on:
      party_id: party_id
    predicate: is a
---

# Passport

Passport held by the Party
