---
entity: SOL_Product
group: transactional
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  so_line_id:
    type: integer
    desc: "Parent order line — foreign key to SO_Line."
  product_id:
    type: integer
    desc: "Product sold on this line — foreign key to Product."
ak:
  - rule: one SOL_Product per SO_Line
    columns:
      - so_line_id
examples:
  - id: 1
    so_line_id: 1
    product_id: 10
  - id: 2
    so_line_id: 4
    product_id: 11
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

A **SOL_Product** is a SalesOrder line that resolves to a specific `Product`. It is the product-flavored specialization of `SO_Line` — present only when that line's `type` is a product.

It exists so a product line can carry the one thing a subscription line cannot: a foreign key to the exact catalog product being ordered.
