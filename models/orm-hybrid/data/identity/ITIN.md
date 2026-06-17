---
entity: ITIN
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
  itin:
    type: text
    desc: "US Individual Taxpayer Identification Number."
examples:
  - id: 1
    identity_id: 3
    itin: "9XX-70-3241"
  - id: 2
    identity_id: 4
    itin: "9XX-72-8814"
relationships:
  - target: Identity
    on:
      identity_id: id
    predicate: is a
---

# ITIN

An **ITIN** is a US Individual Taxpayer Identification Number held by a Party, recorded under its `Identity` container. It is the tax identifier the IRS issues to people who are not eligible for an SSN.

It exists alongside SSN rather than merged with it because the two are issued by different processes and a party may legitimately hold one without the other.
