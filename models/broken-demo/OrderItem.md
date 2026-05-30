---
entity: OrderItem
group: core
pk: []
columns:
  order_id:
    type: integer
    desc: "Order this line belongs to."
  product_id:
    type: integer
    desc: "Product on the line."
  qty:
    type: integer
    desc: "Units ordered."
relationships:
  - target: Order
    on:
      order_id: order_id
      not_a_column_here: order_id
    predicate: is part of
---

**OrderItem** — triggers two rules at once.

`entity.missing_pk` (Class A) — `pk: []` is empty. The entity still renders, but with a ⚠ triangle whose detail explains that the primary key is missing.

`edge.dangling_fk_column` (Class A) — the `on` mapping on the `Order` relationship references `not_a_column_here`, a column that does not exist on this entity. The edge stays in `cleanedModel`, but the source entity is decorated with another finding.
