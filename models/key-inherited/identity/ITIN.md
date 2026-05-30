---
entity: ITIN
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
  itin:
    type: text
relationships:
  - target: Identity
    on:
      party_id: party_id
    predicate: is a
---

# ITIN

US Individual Taxpayer Identification Number held by the Party
