---
entity: Payment
group: transactional
pk:
  - party_id
  - payment_method_id
  - payment_id
columns:
  party_id:
    type: integer
  payment_method_id:
    type: integer
  payment_id:
    type: integer
  amount:
    type: decimal
  paid_at:
    type: datetime
relationships:
  - target: PaymentMethod
    on:
      party_id: party_id
      payment_method_id: payment_method_id
    predicate: is settled by
---

# Payment

A confirmed payment made via a PaymentMethod

## Constraints

- **payment amount positive**: Payment amount must be greater than zero
