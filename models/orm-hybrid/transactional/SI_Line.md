---
entity: SI_Line
group: transactional
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  sales_invoice_id:
    type: integer
    desc: "Parent sales invoice — foreign key to SalesInvoice."
  line_seq:
    type: integer
    desc: "Sequence number of the line within its invoice."
  type:
    type: text
    desc: "Line kind — foreign key to LineItemType.code (product or subscription)."
  qty:
    type: integer
    desc: "Quantity billed; at least 1."
  unit_price:
    type: decimal
    desc: "Price per unit at invoice time; non-negative."
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

A **SI_Line** is a single line item on a SalesInvoice — one product or one subscription, with a quantity and a billed unit price. The invoice total is built from these lines, and each line is what a payment is ultimately allocated against.

Capturing price on the line freezes what was billed, independent of later catalog changes, and gives allocation a precise target to settle.

## Subtypes

Each line is **exclusively** one kind, set by its `type`:

- **SIL_Subscription** — a subscription line (`LineItemType.code.SUBSCRIPTION`).
- **SIL_Product** — a product line (`LineItemType.code.PRODUCT`).

## Business rules

- **Quantity is at least 1** — a line bills a positive number of units.
- **Unit price is non-negative** — price may be zero but never negative.
