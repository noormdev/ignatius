---
entity: SOL_Subscription
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
  subscription_id:
    type: integer
    desc: "Subscription sold on this line — foreign key to Subscription."
ak:
  - rule: one SOL_Subscription per SO_Line
    columns:
      - so_line_id
relationships:
  - target: SO_Line
    on:
      so_line_id: id
    predicate: is a
  - target: Subscription
    on:
      subscription_id: id
    predicate: sells
---

# SOL_Subscription

A **SOL_Subscription** is a SalesOrder line that resolves to a specific `Subscription`. It is the subscription-flavored specialization of `SO_Line`, present only when that line's `type` is a subscription.

It carries the link to the exact catalog subscription being ordered — the detail that distinguishes it from a product line sharing the same parent.
