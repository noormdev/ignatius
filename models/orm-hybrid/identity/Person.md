---
entity: Person
group: identity
pk:
  - id
columns:
  id:
    type: integer
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
      party_id: id
    predicate: is a
---

# Person

Party that is a natural person
