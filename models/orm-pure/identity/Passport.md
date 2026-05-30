---
entity: Passport
group: identity
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  identity_id:
    type: integer
    desc: "Owning party's Identity container — foreign key to Identity."
  passport_number:
    type: text
    desc: "Passport number."
  issuing_country:
    type: text
    desc: "Country that issued the passport."
  issued_on:
    type: date
    desc: "Date the passport was issued."
  expires_on:
    type: date
    desc: "Date the passport expires."
ak:
  - rule: one Passport per Identity
    columns:
      - identity_id
relationships:
  - target: Identity
    on:
      identity_id: id
    predicate: is a
---

# Passport

A **Passport** is a passport held by a Party, recorded under its `Identity` container. It captures the passport number, the issuing country, and the validity window.

It is its own document type because issuing authority is a country (not a state) and because a Party may hold a passport independently of any other identity document.
