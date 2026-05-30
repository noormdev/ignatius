---
entity: SIL_Subscription
group: transactional
pk:
  - party_id
  - sales_invoice_id
  - line_seq
columns:
  party_id:
    type: integer
    desc: "Billed party — foreign key."
  sales_invoice_id:
    type: integer
    desc: "Parent invoice — foreign key."
  line_seq:
    type: integer
    desc: "Sequence number within the invoice."
  subscription_id:
    type: integer
    desc: "Subscription billed on this line — foreign key to Subscription."
relationships:
  - target: SI_Line
    on:
      party_id: party_id
      sales_invoice_id: sales_invoice_id
      line_seq: line_seq
    predicate: is a
  - target: Subscription
    on:
      subscription_id: subscription_id
    predicate: bills
---

# SIL_Subscription

A **SIL_Subscription** is a SalesInvoice line that resolves to a specific `Subscription`. It is the subscription specialization of `SI_Line`, present only when the line bills a recurring plan.

It records which catalog subscription is being billed, distinguishing a recurring charge from a one-time product charge on the same invoice.
