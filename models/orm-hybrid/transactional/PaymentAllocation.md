---
entity: PaymentAllocation
group: transactional
pk:
  - id
columns:
  id:
    type: integer
  payment_id:
    type: integer
  si_line_id:
    type: integer
  amount:
    type: decimal
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

Allocation of part or all of a confirmed Payment to a specific SalesInvoice line
