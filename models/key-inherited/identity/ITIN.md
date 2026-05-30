---
entity: ITIN
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
    desc: "Owning party's Identity container — foreign key."
  itin:
    type: text
    desc: "US Individual Taxpayer Identification Number."
relationships:
  - target: Identity
    on:
      party_id: party_id
    predicate: { fwd: is realized as, rev: is a }
---

# ITIN

An **ITIN** is a US Individual Taxpayer Identification Number held by a Party, recorded under its `Identity` container. It is the tax identifier the IRS issues to people who are not eligible for an SSN.

It exists alongside SSN rather than merged with it because the two are issued by different processes and a party may legitimately hold one without the other.
