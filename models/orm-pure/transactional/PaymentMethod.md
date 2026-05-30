---
entity: PaymentMethod
group: transactional
pk:
  - id
columns:
  id:
    type: integer
  party_id:
    type: integer
  type:
    type: text
  label:
    type: text
relationships:
  - target: Party
    on:
      party_id: id
    predicate: is held by
  - target: PaymentMethodType
    on:
      type: code
    predicate: is classified by
---

# PaymentMethod

A means by which a Party can pay — card, bank account, check
