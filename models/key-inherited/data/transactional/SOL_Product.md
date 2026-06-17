---
entity: SOL_Product
group: transactional
pk:
  - party_id
  - sales_order_id
  - line_seq
columns:
  party_id:
    type: integer
    desc: "Ordering party — foreign key."
  sales_order_id:
    type: integer
    desc: "Parent order — foreign key."
  line_seq:
    type: integer
    desc: "Sequence number within the order."
  product_id:
    type: integer
    desc: "Product sold on this line — foreign key to Product."
examples:
  - party_id: 2
    sales_order_id: 1001
    line_seq: 1
    product_id: 10
  - party_id: 3
    sales_order_id: 1003
    line_seq: 1
    product_id: 11
relationships:
  - target: SO_Line
    on:
      party_id: party_id
      sales_order_id: sales_order_id
      line_seq: line_seq
    predicate: { fwd: is realized as, rev: is a }
  - target: Product
    on:
      product_id: product_id
    predicate: { fwd: is sold via, rev: sells }
---

# SOL_Product

A **SOL_Product** is a SalesOrder line that resolves to a specific `Product`. It is the product-flavored specialization of `SO_Line` — present only when that line's `type` is a product.

It exists so a product line can carry the one thing a subscription line cannot: a foreign key to the exact catalog product being ordered.
