---
entity: SSN
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
    desc: "Owning party's Identity container — foreign key."
  ssn:
    type: text
    desc: "US Social Security Number."
relationships:
  - target: Identity
    on:
      party_id: party_id
    predicate: { fwd: is realized as, rev: is a }
---

# SSN

An **SSN** is a US Social Security Number held by a Party, recorded under its `Identity` container. It is the tax and identity number for most US persons.

It is kept as a distinct, single-field document so it can be present or absent on its own — a party may have an SSN, an ITIN, both, or neither — and so this sensitive value lives in one clearly-scoped place.
