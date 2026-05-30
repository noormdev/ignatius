---
entity: SIL_Subscription
group: transactional
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  si_line_id:
    type: integer
    desc: "Parent invoice line — foreign key to SI_Line."
  subscription_id:
    type: integer
    desc: "Subscription billed on this line — foreign key to Subscription."
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

A **SIL_Subscription** is a SalesInvoice line that resolves to a specific `Subscription`. It is the subscription specialization of `SI_Line`, present only when the line bills a recurring plan.

It records which catalog subscription is being billed, distinguishing a recurring charge from a one-time product charge on the same invoice.
