---
entity: Party
classification: Basetype
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
  type:
    type: text
relationships:
  - target: PartyType
    identifying: false
    on:
      type: code
    predicate: is classified by
---

# Party

Anyone the system transacts with — every customer, vendor, employee is a Party

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK | No |  |
| 2 | type | text | FK → PartyType | No |  |

## Subtypes

Every Party is exactly one of Business or Person
- **Exclusive:** Yes
- **Business:** type = PartyType.code.BUSINESS
- **Person:** type = PartyType.code.PERSON
