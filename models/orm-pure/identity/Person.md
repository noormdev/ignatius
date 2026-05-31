---
entity: Person
group: identity
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
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
ak:
  - rule: one Person per Party
    columns:
      - party_id
examples:
  - id: 1
    party_id: 2
    first_name: Elena
    last_name: Vasquez
    birthdate: "1988-03-14"
  - id: 2
    party_id: 3
    first_name: Marcus
    last_name: Okonkwo
    birthdate: "1975-11-02"
relationships:
  - target: Party
    on:
      party_id: id
    predicate: is a
---

# Person

A **Person** is the specialization of a Party that is a natural human. It holds the attributes that only apply to people — given name, family name, and date of birth.

Splitting Person from Business keeps each subtype honest: person-only fields never appear on an organization, and the shared Party record stays free of either side's specifics. A Person is the same identity as its Party, viewed through its human facet.
