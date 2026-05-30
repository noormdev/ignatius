---
entity: SOL_Subscription
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
  subscription_id:
    type: integer
    desc: "Subscription sold on this line — foreign key to Subscription."
relationships:
  - target: SO_Line
    on:
      party_id: party_id
      sales_order_id: sales_order_id
      line_seq: line_seq
    predicate: { fwd: is realized as, rev: is a }
  - target: Subscription
    on:
      subscription_id: subscription_id
    predicate: { fwd: is sold via, rev: sells }
---

# SOL_Subscription

A **SOL_Subscription** is a SalesOrder line that resolves to a specific `Subscription`. It is the subscription-flavored specialization of `SO_Line`, present only when that line's `type` is a subscription.

It carries the link to the exact catalog subscription being ordered — the detail that distinguishes it from a product line sharing the same parent.
