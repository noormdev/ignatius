---
entity: Order
group: core
pk:
  - order_id
columns:
  order_id:
    type: integer
    desc: "Order surrogate key."
  customer_id:
    type: integer
    desc: "Customer who placed the order."
  cart_id:
    type: integer
    desc: "Cart this order came from."
relationships:
  - target: Customer
    on:
      customer_id: customer_id
    predicate: was placed by
  - target: Cart
    on:
      cart_id: cart_id
    predicate: came from
---

**Order** — triggers `edge.unknown_target` (Class B).

The relationship to `Cart` references an entity that does not exist anywhere in the model. The validator strips the dangling edge from `cleanedModel.edges` and adds a `GlobalError` to the banner. In the dict the `Cart` FK link renders with `dict-link-missing` and points at a `#missing-Cart` placeholder section at page bottom.

The relationship to [[Customer]] is clean and survives — but the narrative below links to [[Cart]], an entity that does not exist, which trips `body.unknown_link`.
