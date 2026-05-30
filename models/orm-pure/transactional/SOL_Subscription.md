---
entity: SOL_Subscription
group: transactional
pk:
  - id
columns:
  id:
    type: integer
  so_line_id:
    type: integer
  subscription_id:
    type: integer
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

A SalesOrder line for a Subscription
