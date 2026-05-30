---
entity: SOL_Product
group: transactional
pk:
  - id
columns:
  id:
    type: integer
  so_line_id:
    type: integer
  product_id:
    type: integer
relationships:
  - target: SO_Line
    on:
      so_line_id: id
    predicate: is a
  - target: Product
    on:
      product_id: id
    predicate: sells
---

# SOL_Product

A SalesOrder line for a Product
