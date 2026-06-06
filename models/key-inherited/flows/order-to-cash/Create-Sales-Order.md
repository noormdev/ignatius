---
process: Create Sales Order
number: 1
inputs:
  - from: ext:Customer
    data: order request
  - from: db:Party
    data: [party_id, type]
outputs:
  - to: db:SalesOrder
    data: [party_id, sales_order_id, ordered_at, total]
  - to: db:SO_Line
    data: [party_id, sales_order_id, line_seq, type]
---

Turns a customer's order request into a persisted `SalesOrder` and its
`SO_Line` items.

The process reads the ordering `Party` to confirm the customer exists and
to learn whether they are a `BUSINESS` or `PERSON` (`type`) — billing and
credit rules downstream differ by party kind. It then writes the order
header (`ordered_at` defaults to now, `total` reconciles to the sum of the
lines) and one `SO_Line` per item.

**Demand-list note:** this flow declares it needs `party_id` and `type`
from `Party`. Because the DFD validates against the live schema, if either
column were renamed or dropped, `ignatius` would surface a
`flow.unknown_attribute` warning here — the order process telling the data
model what it depends on.
