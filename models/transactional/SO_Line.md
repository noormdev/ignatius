---
entity: SO_Line
group: transactional
pk:
  - party_id
  - sales_order_id
  - line_seq
columns:
  party_id:
    type: integer
  sales_order_id:
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
      SOL_Subscription:
        type: LineItemType.code.SUBSCRIPTION
      SOL_Product:
        type: LineItemType.code.PRODUCT
relationships:
  - target: SalesOrder
    on:
      party_id: party_id
      sales_order_id: sales_order_id
    predicate: is part of
  - target: LineItemType
    on:
      type: code
    predicate: is classified by
---

# SO Line

A line item on a SalesOrder — exclusively a subscription or a product

## Subtypes

Each line is exactly one of: subscription or product
- **Exclusive:** Yes
- **SOL_Subscription:** type = LineItemType.code.SUBSCRIPTION
- **SOL_Product:** type = LineItemType.code.PRODUCT

## Constraints

- **sales order line qty positive**: Line quantity must be at least 1
- **sales order line price non negative**: Unit price cannot be negative
