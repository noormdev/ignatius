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
relationships:
  - target: Identity
    on:
      party_id: party_id
    predicate: { fwd: is realized as, rev: is a }
---

# Passport

A **Passport** is a passport held by a Party, recorded under its `Identity` container. It captures the passport number, the issuing country, and the validity window.

It is its own document type because issuing authority is a country (not a state) and because a Party may hold a passport independently of any other identity document.
