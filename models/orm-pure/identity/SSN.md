---
entity: SSN
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
  ssn:
    type: text
    desc: "US Social Security Number."
ak:
  - rule: one SSN per Identity
    columns:
      - identity_id
examples:
  - id: 1
    identity_id: 1
    ssn: "***-**-4471"
  - id: 2
    identity_id: 2
    ssn: "***-**-8830"
relationships:
  - target: Identity
    on:
      identity_id: id
    predicate: is a
---

# SSN

An **SSN** is a US Social Security Number held by a Party, recorded under its `Identity` container. It is the tax and identity number for most US persons.

It is kept as a distinct, single-field document so it can be present or absent on its own — a party may have an SSN, an ITIN, both, or neither — and so this sensitive value lives in one clearly-scoped place.
