---
entity: SO_Line
group: transactional
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  sales_order_id:
    type: integer
    desc: "Parent sales order — foreign key to SalesOrder."
  line_seq:
    type: integer
    desc: "Sequence number of the line within its order."
  type:
    type: text
    desc: "Line kind — foreign key to LineItemType.code (product or subscription)."
  qty:
    type: integer
    desc: "Quantity ordered; at least 1."
  unit_price:
    type: decimal
    desc: "Price per unit at order time; non-negative."
subtypes:
  - exclusive: true
    desc: "Each line is exactly one of: subscription or product"
    members:
      SOL_Subscription:
        type: LineItemType.code.SUBSCRIPTION
      SOL_Product:
        type: LineItemType.code.PRODUCT
relationships:
  - target: SalesOrder
    on:
      sales_order_id: id
    predicate: is part of
  - target: LineItemType
    on:
      type: code
    predicate: is classified by
---

# SO_Line

A **SO_Line** is a single line item on a SalesOrder — one product or one subscription, with a quantity and a unit price captured at order time. An order is its header plus its lines; the line is where the actual goods and amounts live.

Unit price is recorded on the line rather than read live from the catalog so the order preserves what was agreed, even if the catalog list price later changes.

## Subtypes

Each line is **exclusively** one kind, set by its `type`:

- **SOL_Subscription** — a subscription line (`LineItemType.code.SUBSCRIPTION`).
- **SOL_Product** — a product line (`LineItemType.code.PRODUCT`).

## Business rules

- **Quantity is at least 1** — a line orders a positive number of units.
- **Unit price is non-negative** — price may be zero (a free line) but never negative.
