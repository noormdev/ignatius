---
entity: SI_Line
classification: Dependent
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
  type:
    type: text
  qty:
    type: integer
  unit_price:
    type: decimal
subtypes:
  - exclusive: true
    desc: "Each line is exactly one of: subscription or product"
    members:
      SIL_Subscription:
        type: LineItemType.code.SUBSCRIPTION
      SIL_Product:
        type: LineItemType.code.PRODUCT
relationships:
  - target: SalesInvoice
    identifying: true
    on:
      party_id: party_id
      sales_invoice_id: sales_invoice_id
    predicate: is part of
  - target: LineItemType
    identifying: false
    on:
      type: code
    predicate: is classified by
---

# SI Line

A line item on a SalesInvoice — exclusively a subscription or a product

## Subtypes

Each line is exactly one of: subscription or product
- **Exclusive:** Yes
- **SIL_Subscription:** type = LineItemType.code.SUBSCRIPTION
- **SIL_Product:** type = LineItemType.code.PRODUCT

## Constraints

- **sales invoice line qty positive**: Line quantity must be at least 1
- **sales invoice line price non negative**: Unit price cannot be negative
