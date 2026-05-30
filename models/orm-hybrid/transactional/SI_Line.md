---
entity: SI_Line
group: transactional
pk:
  - id
columns:
  id:
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
    on:
      sales_invoice_id: id
    predicate: is part of
  - target: LineItemType
    on:
      type: code
    predicate: is classified by
---

# SI_Line

A line item on a SalesInvoice — exclusively a subscription or a product
