---
entity: PaymentMethod
group: transactional
pk:
  - party_id
  - payment_method_id
columns:
  party_id:
    type: integer
  payment_method_id:
    type: integer
  type:
    type: text
  label:
    type: text
relationships:
  - target: Party
    on:
      party_id: party_id
    predicate: is held by
  - target: PaymentMethodType
    on:
      type: code
    predicate: is classified by
---

# PaymentMethod

A means by which a Party can pay — card, bank account, check
