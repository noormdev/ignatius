---
entity: PaymentAllocation
group: transactional
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  payment_id:
    type: integer
    desc: "Payment being allocated — foreign key to Payment."
  si_line_id:
    type: integer
    desc: "Invoice line being settled — foreign key to SI_Line."
  amount:
    type: decimal
    desc: "Portion of the payment applied to this line; positive."
examples:
  - id: 1
    payment_id: 1
    si_line_id: 1
    amount: 49.00
  - id: 2
    payment_id: 1
    si_line_id: 2
    amount: 89.00
  - id: 3
    payment_id: 2
    si_line_id: 3
    amount: 4999.00
relationships:
  - target: Payment
    on:
      payment_id: id
    predicate: is paid by
  - target: SI_Line
    on:
      si_line_id: id
    predicate: settles
---

# PaymentAllocation

A **PaymentAllocation** is the record of part or all of a Payment being applied to a specific invoice line. It resolves the many-to-many between payments and invoice lines: one payment can settle several lines, and one line can be settled by several payments over time.

It exists because real settlement is rarely one-to-one. Splitting allocation into its own entity makes partial payments, overpayment, and line-level reconciliation expressible — the model knows not just that money arrived, but exactly what it paid for.

## Business rules

- **Amount is positive** — every allocation moves a positive sum.
- **Cannot exceed the payment** — total allocations against a `Payment` may not exceed the payment's amount.
- **Cannot exceed the line** — total allocations against an `SI_Line` may not exceed that line's value.
