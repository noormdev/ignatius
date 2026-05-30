---
entity: PaymentAllocation
group: transactional
pk:
  - party_id
  - payment_method_id
  - payment_id
  - sales_invoice_id
  - line_seq
columns:
  party_id:
    type: integer
    desc: "Paying party — foreign key."
  payment_method_id:
    type: integer
    desc: "Payment method — foreign key."
  payment_id:
    type: integer
    desc: "Payment being allocated — foreign key to Payment."
  sales_invoice_id:
    type: integer
    desc: "Invoice being settled — foreign key."
  line_seq:
    type: integer
    desc: "Invoice line sequence number."
  amount:
    type: decimal
    desc: "Portion of the payment applied to this line; positive."
relationships:
  - target: Payment
    on:
      party_id: party_id
      payment_method_id: payment_method_id
      payment_id: payment_id
    predicate: is paid by
  - target: SI_Line
    on:
      party_id: party_id
      sales_invoice_id: sales_invoice_id
      line_seq: line_seq
    predicate: settles
---

# PaymentAllocation

A **PaymentAllocation** is the record of part or all of a Payment being applied to a specific invoice line. It resolves the many-to-many between payments and invoice lines: one payment can settle several lines, and one line can be settled by several payments over time.

It exists because real settlement is rarely one-to-one. Splitting allocation into its own entity makes partial payments, overpayment, and line-level reconciliation expressible — the model knows not just that money arrived, but exactly what it paid for.

## Business rules

- **Amount is positive** — every allocation moves a positive sum.
- **Cannot exceed the payment** — total allocations against a `Payment` may not exceed the payment's amount.
- **Cannot exceed the line** — total allocations against an `SI_Line` may not exceed that line's value.
