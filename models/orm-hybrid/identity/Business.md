---
entity: Business
group: identity
pk:
  - id
columns:
  id:
    type: integer
  party_id:
    type: integer
  legal_name:
    type: text
  tax_id:
    type: text
ak:
  - rule: unique tax identifier
    columns:
      - tax_id
relationships:
  - target: Party
    on:
      party_id: id
    predicate: is a
---

# Business

Party that is a legal business entity
