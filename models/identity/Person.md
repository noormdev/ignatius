---
entity: Person
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
    on:
      party_id: party_id
    predicate: is a
---

# Person

Party that is a natural person
