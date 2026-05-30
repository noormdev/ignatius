---
entity: Payment
group: transactional
pk:
  - id
columns:
  id:
    type: integer
  payment_method_id:
    type: integer
  amount:
    type: decimal
  paid_at:
    type: datetime
relationships:
  - target: PaymentMethod
    on:
      payment_method_id: id
    predicate: is settled by
---

# Payment

A confirmed payment made via a PaymentMethod
