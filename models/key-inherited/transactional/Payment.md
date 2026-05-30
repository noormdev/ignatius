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
    desc: "Paying party — foreign key."
  payment_method_id:
    type: integer
    desc: "Payment method used — foreign key to PaymentMethod."
  payment_id:
    type: integer
    desc: "Identifier of the payment within the method."
  amount:
    type: decimal
    desc: "Amount paid; must be positive."
  paid_at:
    type: datetime
    desc: "Timestamp the payment was confirmed."
relationships:
  - target: PaymentMethod
    on:
      party_id: party_id
      payment_method_id: payment_method_id
    predicate: { fwd: settles, rev: is settled by }
---

# Payment

A **Payment** records money actually received from a Party through one of its payment methods. It is the settlement event — distinct from an invoice, which only states what is owed. A single payment can be spread across several invoice lines through `PaymentAllocation`, so the model never assumes one payment settles exactly one invoice.

Capturing payments as first-class records — rather than a `paid` flag on the invoice — preserves the full money trail: when funds arrived, which method settled them, and exactly how they were applied. That history is what reconciliation, refunds, and audit depend on.

## Business rules

- **Amount is positive** — a payment must move a positive sum; a zero or negative payment is not a valid settlement event.
- **Allocations cannot exceed the payment** — the total of all `PaymentAllocation` rows against a payment may never exceed the payment's amount.
