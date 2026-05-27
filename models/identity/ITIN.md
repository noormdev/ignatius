---
entity: ITIN
classification: Subtype
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
    identifying: true
    on:
      party_id: party_id
    predicate: is a
---

# ITIN

US Individual Taxpayer Identification Number held by the Party
