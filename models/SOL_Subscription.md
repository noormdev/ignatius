---
entity: SOL_Subscription
classification: Subtype
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
  subscription_id:
    type: integer
relationships:
  - target: SO_Line
    identifying: true
    on:
      party_id: party_id
      sales_order_id: sales_order_id
      line_seq: line_seq
    predicate: is a
  - target: Subscription
    identifying: false
    on:
      subscription_id: subscription_id
    predicate: sells
---

# SOL Subscription

A SalesOrder line for a Subscription
