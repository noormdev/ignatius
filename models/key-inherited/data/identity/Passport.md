---
entity: Passport
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
    desc: "Owning party's Identity container — foreign key."
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
examples:
  - party_id: 2
    passport_number: "A09284731"
    issuing_country: US
    issued_on: "2018-09-22"
    expires_on: "2028-09-22"
  - party_id: 3
    passport_number: "B54017662"
    issuing_country: NG
    issued_on: "2020-04-10"
    expires_on: "2030-04-10"
relationships:
  - target: Identity
    on:
      party_id: party_id
    predicate: { fwd: is realized as, rev: is a }
---

# Passport

A **Passport** is a passport held by a Party, recorded under its `Identity` container. It captures the passport number, the issuing country, and the validity window.

It is its own document type because issuing authority is a country (not a state) and because a Party may hold a passport independently of any other identity document.
