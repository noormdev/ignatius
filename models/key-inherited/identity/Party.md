---
entity: Party
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
  type:
    type: text
subtypes:
  - exclusive: true
    desc: Every Party is exactly one of Business or Person
    members:
      Business:
        type: PartyType.code.BUSINESS
      Person:
        type: PartyType.code.PERSON
relationships:
  - target: PartyType
    on:
      type: code
    predicate: is classified by
---

# Party

Anyone the system transacts with — every customer, vendor, employee is a Party

## Subtypes

Every Party is exactly one of Business or Person
- **Exclusive:** Yes
- **Business:** type = PartyType.code.BUSINESS
- **Person:** type = PartyType.code.PERSON
