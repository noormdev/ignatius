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
examples:
  - id: 1
    identity_id: 1
    passport_number: "A09284731"
    issuing_country: US
    issued_on: "2018-09-22"
    expires_on: "2028-09-22"
  - id: 2
    identity_id: 2
    passport_number: "B54017662"
    issuing_country: NG
    issued_on: "2020-04-10"
    expires_on: "2030-04-10"
relationships:
  - target: Identity
    on:
      identity_id: id
    predicate: is a
---

# Passport

A **Passport** is a passport held by a Party, recorded under its `Identity` container. It captures the passport number, the issuing country, and the validity window.

It is its own document type because issuing authority is a country (not a state) and because a Party may hold a passport independently of any other identity document.
