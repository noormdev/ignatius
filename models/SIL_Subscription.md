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

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → SI_Line | No |  |
| 2 | sales_invoice_id | integer | PK, FK → SI_Line | No |  |
| 3 | line_seq | integer | PK, FK → SI_Line | No |  |
| 4 | subscription_id | integer | FK → Subscription | No |  |
