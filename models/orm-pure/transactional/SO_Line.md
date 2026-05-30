---
entity: SO_Line
group: transactional
pk:
  - id
columns:
  id:
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

A line item on a SalesOrder — exclusively a subscription or a product
