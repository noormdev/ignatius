---
entity: SIL_Subscription
classification: Subtype
group: transactional
pk:
  - party_id
  - sales_invoice_id
  - line_seq
columns:
  party_id:
    type: integer
  sales_invoice_id:
    type: integer
  line_seq:
    type: integer
  subscription_id:
    type: integer
relationships:
  - target: SI_Line
    identifying: true
    on:
      party_id: party_id
      sales_invoice_id: sales_invoice_id
      line_seq: line_seq
    predicate: is a
  - target: Subscription
    identifying: false
    on:
      subscription_id: subscription_id
    predicate: bills
---

# SIL Subscription

A SalesInvoice line for a Subscription
