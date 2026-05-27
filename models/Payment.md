---
entity: Payment
classification: Dependent
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
    identifying: true
    on:
      party_id: party_id
      payment_method_id: payment_method_id
    predicate: is settled by
---

# Payment

A confirmed payment made via a PaymentMethod

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → PaymentMethod | No |  |
| 2 | payment_method_id | integer | PK, FK → PaymentMethod | No |  |
| 3 | payment_id | integer | PK | No |  |
| 4 | amount | decimal | — | No |  |
| 5 | paid_at | datetime | — | No |  |

## Constraints

- **payment amount positive**: Payment amount must be greater than zero
