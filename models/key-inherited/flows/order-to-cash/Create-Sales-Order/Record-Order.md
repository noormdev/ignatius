---
process: Record Order
number: 2
inputs:
  - from: queue:OrderIntake
    data: validated order
outputs:
  - to: db:SalesOrder
    data: [party_id, sales_order_id, ordered_at, total]
  - to: db:SO_Line
    data: [party_id, sales_order_id, line_seq, type]
---

Second step inside *Create Sales Order*: take the validated order off the
`queue:OrderIntake` store and persist it as a `SalesOrder` header plus one
`SO_Line` per item.

**Balancing:** the columns this sub-DFD writes to `SalesOrder` and
`SO_Line`, plus the `Party` columns *Validate Customer* reads, are exactly
the `db:` columns the parent *Create Sales Order* box declares at its
edge. That is what keeps the decomposition balanced — zoom in and no
column appears or vanishes. Change one and ignatius raises
`flow.unbalanced_decomposition`.
