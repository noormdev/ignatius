---
entity: Person
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
    desc: "The Party this person is — foreign key to Party."
  first_name:
    type: text
    desc: "Person's given name."
  last_name:
    type: text
    desc: "Person's family name."
  birthdate:
    type: date
    desc: "Date of birth."
relationships:
  - target: Party
    on:
      party_id: party_id
    predicate: { fwd: is realized as, rev: is a }
---

# Person

A **Person** is the specialization of a Party that is a natural human. It holds the attributes that only apply to people — given name, family name, and date of birth.

Splitting Person from Business keeps each subtype honest: person-only fields never appear on an organization, and the shared Party record stays free of either side's specifics. A Person is the same identity as its Party, viewed through its human facet.
