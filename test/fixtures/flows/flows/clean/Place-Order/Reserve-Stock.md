---
process: Reserve Stock
number: 1
inputs:
  - from: db:Party
    data: [party_id]
outputs:
  - to: db:Party
    data: [party_id]
---

Reserves available stock for the placed order.
