---
entity: SSN
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
    on:
      party_id: party_id
    predicate: is a
---

# SSN

US Social Security Number held by the Party
