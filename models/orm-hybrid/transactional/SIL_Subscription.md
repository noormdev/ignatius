---
entity: SIL_Subscription
group: transactional
pk:
  - id
columns:
  id:
    type: integer
  si_line_id:
    type: integer
  subscription_id:
    type: integer
relationships:
  - target: SI_Line
    on:
      si_line_id: id
    predicate: is a
  - target: Subscription
    on:
      subscription_id: id
    predicate: bills
---

# SIL_Subscription

A SalesInvoice line for a Subscription
